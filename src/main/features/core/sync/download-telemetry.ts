import axios from 'axios';
import { randomUUID } from 'crypto';
import { app, powerMonitor } from 'electron';
import log from 'electron-log/main';

import { httpsAgent, PymixAuth, withPymixAuth } from '/@/main/features/core/sync/pymix-auth';

// ── What a download run did, on disk and on the server ──────────────────────
//
// The download job (laker-93/pymix#346) has the server list the tracks and this
// process fetch each one with its own request: thousands over hours for a big
// library. pymix serves every one of them and still can't see the run: how far
// through it is, what was retried, skipped or given up on, or that the user
// cancelled or quit. The same two outputs as an upload's (upload-telemetry.ts),
// both best-effort, neither allowed to fail a download:
//
//   * `downloadLog` writes to electron-log's file, so a user can send it.
//   * `DownloadRun` reports to pymix (POST /sync/download_report): once at the
//     start, every minute while it runs, and once at the end. A run whose reports
//     stop without a `finished` is a client that died, quit or lost its network.

export const downloadLog = log.scope('download');

/** How a run ended. Mirrors pymix's `DownloadReport.outcome`; keep the two in step.
 *  `partial`: every track was tried and some failed for good. */
export type DownloadOutcome = 'cancelled' | 'completed' | 'failed' | 'partial';

/** Waiting on the server's job, fetching tracks, fetching the XML. */
export type DownloadRunPhase = 'preparing' | 'tracks' | 'xml';

const HEARTBEAT_MS = 60_000;
const REPORT_TIMEOUT_MS = 10_000;
const MAX_ERRORS = 10;
const MAX_TEXT = 200;

const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);

const activeRuns = new Set<DownloadRun>();

/**
 * One download, from starting the server's job to the last file written. Tracks
 * the numbers pymix's report carries; download-job.ts tells it about each track,
 * retry, stall and network wait.
 */
export class DownloadRun {
    readonly runId = randomUUID();
    private abandoned = false;
    private readonly active = new Set<string>();
    private bytesDone = 0;
    private bytesFetched = 0;
    private bytesTotal = 0;
    private readonly errors: Array<{ reason: string; track: string }> = [];
    private finished = false;
    private heartbeat: NodeJS.Timeout | null = null;
    private jobId: null | string = null;
    private networkWaits = 0;
    private phase: DownloadRunPhase = 'preparing';
    private preparedAt: null | number = null;
    private reportFailures = 0;
    private retries = 0;
    private sleeps = 0;
    private sleptAt: null | number = null;
    private sleptMs = 0;
    private stalls = 0;
    private readonly startedAt = Date.now();
    private tracksDownloaded = 0;
    private tracksFailed = 0;
    private tracksSkipped = 0;
    private tracksTotal = 0;

    private get tag(): string {
        return this.runId.slice(0, 8);
    }

    constructor(
        private readonly args: {
            pymixAuth: PymixAuth;
            pymixUrl: string;
        },
    ) {}

    /** Called on quit: the last thing the log says about a run the app abandoned. */
    abandon(): void {
        if (this.finished || this.abandoned) return;
        this.abandoned = true;
        downloadLog.warn(
            `[${this.tag}] app quitting with the download still running — ${this.summary()}`,
        );
        void this.report('progress', undefined, 'app quitting');
    }

    /** Ends the run and reports it. Safe to call more than once; the first wins. */
    finish(outcome: DownloadOutcome, err?: unknown): void {
        if (this.finished) return;
        this.finished = true;
        if (this.sleptAt !== null) {
            this.sleptMs += Date.now() - this.sleptAt;
            this.sleptAt = null;
        }
        if (this.heartbeat) clearInterval(this.heartbeat);
        activeRuns.delete(this);
        const detail = err instanceof Error ? err.message : err ? String(err) : '';
        const line = `[${this.tag}] finished: ${outcome}${detail ? ` (${clip(detail)})` : ''} — ${this.summary()}`;
        if (outcome === 'completed' || outcome === 'cancelled') downloadLog.info(line);
        else downloadLog.warn(line);
        void this.report('finished', outcome, detail);
    }

    /** A request waited out an unreachable server (withNetworkRetry). */
    networkWait(reason: string): void {
        this.networkWaits++;
        downloadLog.warn(`[${this.tag}] server unreachable (${clip(reason)}), retrying`);
    }

    /** The server's list is ready: what this run will fetch. */
    prepared(args: { bytesTotal: number; tracksTotal: number }): void {
        this.tracksTotal = args.tracksTotal;
        this.bytesTotal = args.bytesTotal;
        this.preparedAt = Date.now();
        this.phase = 'tracks';
        downloadLog.info(
            `[${this.tag}] prepared in ${Math.round((this.preparedAt - this.startedAt) / 1000)}s: ` +
                `${args.tracksTotal} track(s), ${mb(args.bytesTotal)}`,
        );
        void this.report('progress');
    }

    /** The running bytes figure fetchTracks shows on screen, skipped tracks included. */
    progress(bytesDone: number): void {
        this.bytesDone = bytesDone;
    }

    /** Bytes that arrived over the network, kept or not. */
    received(n: number): void {
        if (n > 0) this.bytesFetched += n;
    }

    retried(track: string, reason: string): void {
        this.retries++;
        this.noteError(track, reason);
        downloadLog.warn(`[${this.tag}] retrying "${track}": ${reason}`);
    }

    slept(): void {
        if (this.sleptAt !== null) return;
        this.sleptAt = Date.now();
        this.sleeps++;
        downloadLog.warn(`[${this.tag}] system going to sleep mid-download — ${this.summary()}`);
    }

    stalled(track: string): void {
        this.stalls++;
        downloadLog.warn(`[${this.tag}] "${track}": no data for 60s, aborting the request`);
    }

    start(jobId: string): void {
        this.jobId = jobId;
        activeRuns.add(this);
        downloadLog.info(
            `[${this.tag}] started: job ${jobId.slice(0, 8)} (app ${app.getVersion()})`,
        );
        void this.report('started');
        this.heartbeat = setInterval(() => {
            downloadLog.info(`[${this.tag}] ${this.summary()}`);
            void this.report('progress');
        }, HEARTBEAT_MS);
        this.heartbeat.unref?.();
    }

    trackActive(track: string, on: boolean): void {
        if (on) this.active.add(track);
        else this.active.delete(track);
    }

    trackDownloaded(track: string, bytes: number, ms: number): void {
        this.tracksDownloaded++;
        downloadLog.verbose(
            `[${this.tag}] got "${track}" (${mb(bytes)} in ${(ms / 1000).toFixed(1)}s)`,
        );
    }

    trackFailed(track: string, reason: string): void {
        this.tracksFailed++;
        this.noteError(track, reason);
        downloadLog.warn(`[${this.tag}] failed "${track}": ${reason}`);
    }

    trackSkipped(): void {
        this.tracksSkipped++;
    }

    woke(): void {
        if (this.sleptAt === null) return;
        const ms = Date.now() - this.sleptAt;
        this.sleptMs += ms;
        this.sleptAt = null;
        downloadLog.warn(`[${this.tag}] system woke after ${Math.round(ms / 1000)}s asleep`);
        void this.report('progress', undefined, `woke after ${Math.round(ms / 1000)}s asleep`);
    }

    /** Fetching the Rekordbox XML, after the tracks. */
    xml(): void {
        this.phase = 'xml';
    }

    private noteError(track: string, reason: string): void {
        this.errors.push({ reason: clip(reason), track: clip(track) });
        if (this.errors.length > MAX_ERRORS) this.errors.shift();
    }

    private async report(
        event: 'finished' | 'progress' | 'started',
        outcome?: DownloadOutcome,
        detail?: string,
    ): Promise<void> {
        const { pymixAuth, pymixUrl } = this.args;
        const body = {
            active: Array.from(this.active).slice(0, 5).map(clip),
            bytes_done: this.bytesDone,
            bytes_fetched: this.bytesFetched,
            bytes_total: this.bytesTotal,
            client_version: app.getVersion(),
            detail: detail ? clip(detail) : undefined,
            elapsed_seconds: (Date.now() - this.startedAt) / 1000,
            event,
            job_id: this.jobId ?? undefined,
            network_waits: this.networkWaits,
            outcome,
            phase: this.phase,
            prepare_seconds:
                ((this.preparedAt ?? (this.phase === 'preparing' ? Date.now() : this.startedAt)) -
                    this.startedAt) /
                1000,
            recent_errors: this.errors,
            retries: this.retries,
            run_id: this.runId,
            sleeps: this.sleeps,
            slept_seconds: this.sleptMs / 1000,
            stalls: this.stalls,
            tracks_downloaded: this.tracksDownloaded,
            tracks_failed: this.tracksFailed,
            tracks_skipped: this.tracksSkipped,
            tracks_total: this.tracksTotal,
        };
        try {
            // One attempt, short timeout, no network retry: a report that can't be
            // sent is superseded by the next one, which carries the same totals.
            await withPymixAuth(pymixAuth, (cookie) =>
                axios.post(`${pymixUrl}/sync/download_report`, body, {
                    headers: { Cookie: cookie },
                    httpsAgent,
                    timeout: REPORT_TIMEOUT_MS,
                }),
            );
        } catch (err) {
            // Log the first few only, so an older pymix (404) shows up once.
            if (++this.reportFailures <= 3) {
                downloadLog.verbose(
                    `[${this.tag}] couldn't send the ${event} report: ${(err as Error).message}`,
                );
            }
        }
    }

    private summary(): string {
        const parts = [
            `${this.tracksDownloaded + this.tracksSkipped + this.tracksFailed}/${this.tracksTotal} tracks`,
            `${mb(this.bytesDone)} of ${mb(this.bytesTotal)}`,
            `${mb(this.bytesFetched)} fetched`,
        ];
        if (this.phase !== 'tracks') parts.push(this.phase);
        if (this.tracksSkipped) parts.push(`${this.tracksSkipped} already here`);
        if (this.tracksFailed) parts.push(`${this.tracksFailed} failed`);
        if (this.retries) parts.push(`${this.retries} retries`);
        if (this.stalls) parts.push(`${this.stalls} stalls`);
        if (this.networkWaits) parts.push(`${this.networkWaits} network waits`);
        if (this.sleeps)
            parts.push(`slept ${this.sleeps}x for ${Math.round(this.sleptMs / 1000)}s`);
        parts.push(`${Math.round((Date.now() - this.startedAt) / 1000)}s elapsed`);
        return parts.join(', ');
    }
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Called once the user has chosen to quit, from upload-quit-guard's exit check.
 * Not on closing the window: a download carries on without it.
 */
export const abandonActiveDownloads = (): void => {
    for (const run of activeRuns) run.abandon();
};

void app.whenReady().then(() => {
    powerMonitor.on('suspend', () => {
        for (const run of activeRuns) run.slept();
    });
    powerMonitor.on('resume', () => {
        for (const run of activeRuns) run.woke();
    });
});
