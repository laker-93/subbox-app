import axios from 'axios';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import log from 'electron-log/main';

import { httpsAgent, PymixAuth, withPymixAuth } from '/@/main/features/core/sync/pymix-auth';

// ── What an upload run did, on disk and on the server ───────────────────────
//
// Before this, the file-transfer half of an upload was invisible from both ends.
// The sync code logged to `console`, which electron-log doesn't capture, so a
// packaged app kept nothing. pymix sees nothing between `storage_check` and the
// import, because the audio goes straight to filebrowser. A run that froze at 4 of
// 18 GB (2026-11-16) looked, from the server, like a user who had gone idle.
//
// Two outputs, both best-effort, neither allowed to fail an upload:
//
//   * `uploadLog` writes to electron-log's file, so a user can send it (macOS:
//     ~/Library/Logs/Subbox/main.log). The file keeps the `verbose` per-file lines
//     too, ~150 bytes each, so a run of a few thousand files fits in the 1 MB the
//     file holds before it rotates to main.old.log.
//   * `UploadRun` reports to pymix (POST /sync/upload_report): once at the start,
//     every minute while it runs, and once at the end. A run whose reports stop
//     without a `finished` is a client that died, quit or lost its network. That
//     is the case these reports exist to make visible.

export const uploadLog = log.scope('upload');

export type UploadFlow = 'rekordbox' | 'serato';

/** How a run ended. Mirrors pymix's `UploadOutcome`; keep the two in step. */
export type UploadOutcome = 'completed' | 'connection_lost' | 'failed';

const HEARTBEAT_MS = 60_000;
const REPORT_TIMEOUT_MS = 10_000;
/** The server truncates past these too. They only keep a report small. */
const MAX_ERRORS = 10;
const MAX_TEXT = 200;

const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);

const activeRuns = new Set<UploadRun>();

/**
 * One upload's file transfer, from the first byte to the queue draining. Tracks
 * the numbers pymix's report carries, and is what tus-upload and runUploadQueue
 * tell about retries, stalls, restarts and pauses.
 */
export class UploadRun {
    readonly runId = randomUUID();
    private bytesDone = 0;
    private readonly bytesInFlight = new Map<string, number>();
    private bytesTotal = 0;
    private readonly errors: Array<{ reason: string; track: string }> = [];
    private filesFailed = 0;
    private filesSent = 0;
    private filesSkipped = 0;
    private filesTotal = 0;
    private finished = false;
    private heartbeat: NodeJS.Timeout | null = null;
    private pausedAt: null | number = null;
    private pausedMs = 0;
    private pauses = 0;
    private reportFailures = 0;
    private restarts = 0;
    private retries = 0;
    private stalls = 0;
    private readonly startedAt = Date.now();

    private get bytesSent(): number {
        let inFlight = 0;
        for (const b of this.bytesInFlight.values()) inFlight += b;
        return this.bytesDone + inFlight;
    }

    private get tag(): string {
        return `${this.args.flow} ${this.runId.slice(0, 8)}`;
    }

    constructor(
        private readonly args: {
            flow: UploadFlow;
            pymixAuth: PymixAuth;
            pymixUrl: string;
        },
    ) {}

    /** Called on quit: the last thing the log says about a run the app abandoned. */
    abandon(): void {
        if (this.finished) return;
        uploadLog.warn(
            `[${this.tag}] app quitting with the upload still running — ${this.summary()}`,
        );
        // Fire and forget. It may not leave before the process does; the server
        // reads a run whose reports stop as abandoned either way.
        void this.report('progress', undefined, 'app quitting');
    }

    fileFailed(track: string, reason: string): void {
        this.filesFailed++;
        this.bytesInFlight.delete(track);
        this.noteError(track, reason);
        uploadLog.warn(`[${this.tag}] failed "${track}": ${reason}`);
    }

    fileProgress(track: string, bytesUploaded: number): void {
        this.bytesInFlight.set(track, bytesUploaded);
    }

    fileSent(track: string, bytes: number, ms: number): void {
        this.filesSent++;
        this.bytesDone += bytes;
        this.bytesInFlight.delete(track);
        uploadLog.verbose(
            `[${this.tag}] sent "${track}" (${mb(bytes)} in ${(ms / 1000).toFixed(1)}s)`,
        );
    }

    /** Ends the run and reports it. Safe to call more than once; the first wins. */
    finish(outcome: UploadOutcome, err?: unknown): void {
        if (this.finished) return;
        this.finished = true;
        if (this.pausedAt !== null) {
            this.pausedMs += Date.now() - this.pausedAt;
            this.pausedAt = null;
        }
        if (this.heartbeat) clearInterval(this.heartbeat);
        activeRuns.delete(this);
        const detail = err instanceof Error ? err.message : err ? String(err) : '';
        const line = `[${this.tag}] finished: ${outcome}${detail ? ` (${clip(detail)})` : ''} — ${this.summary()}`;
        if (outcome === 'completed' && this.filesFailed === 0) uploadLog.info(line);
        else uploadLog.warn(line);
        void this.report('finished', outcome, detail);
    }

    paused(): void {
        if (this.pausedAt !== null) return;
        this.pausedAt = Date.now();
        this.pauses++;
        uploadLog.warn(`[${this.tag}] server unreachable, queue paused — ${this.summary()}`);
    }

    restarted(track: string, status: number): void {
        this.restarts++;
        this.bytesInFlight.delete(track);
        uploadLog.warn(`[${this.tag}] "${track}" can't be resumed (${status}), restarting from 0`);
    }

    resumed(): void {
        if (this.pausedAt === null) return;
        const ms = Date.now() - this.pausedAt;
        this.pausedMs += ms;
        this.pausedAt = null;
        uploadLog.info(`[${this.tag}] server reachable again after ${Math.round(ms / 1000)}s`);
        // Say so now rather than at the next heartbeat: the reports sent while it
        // was paused never arrived.
        void this.report('progress');
    }

    retried(track: string, reason: string): void {
        this.retries++;
        this.noteError(track, reason);
        uploadLog.warn(`[${this.tag}] retrying "${track}": ${reason}`);
    }

    stalled(track: string, seconds: number): void {
        this.stalls++;
        uploadLog.warn(
            `[${this.tag}] "${track}": no data moved for ${seconds}s, aborting the request`,
        );
    }

    /** `filesSkipped` is what an earlier attempt already sent whole. */
    start(args: { bytesTotal: number; filesSkipped: number; filesTotal: number }): void {
        this.filesTotal = args.filesTotal;
        this.bytesTotal = args.bytesTotal;
        this.filesSkipped = args.filesSkipped;
        activeRuns.add(this);
        uploadLog.info(
            `[${this.tag}] started: ${args.filesTotal} file(s), ${mb(args.bytesTotal)} to send, ` +
                `${args.filesSkipped} already on the server (app ${app.getVersion()})`,
        );
        void this.report('started');
        this.heartbeat = setInterval(() => {
            uploadLog.info(`[${this.tag}] ${this.summary()}`);
            void this.report('progress');
        }, HEARTBEAT_MS);
        this.heartbeat.unref?.();
    }

    private noteError(track: string, reason: string): void {
        this.errors.push({ reason: clip(reason), track: clip(track) });
        if (this.errors.length > MAX_ERRORS) this.errors.shift();
    }

    private async report(
        event: 'finished' | 'progress' | 'started',
        outcome?: UploadOutcome,
        detail?: string,
    ): Promise<void> {
        const { flow, pymixAuth, pymixUrl } = this.args;
        const pausedMs = this.pausedMs + (this.pausedAt === null ? 0 : Date.now() - this.pausedAt);
        const body = {
            active: Array.from(this.bytesInFlight.keys()).slice(0, 5).map(clip),
            bytes_sent: this.bytesSent,
            bytes_total: this.bytesTotal,
            client_version: app.getVersion(),
            detail: detail ? clip(detail) : undefined,
            elapsed_seconds: (Date.now() - this.startedAt) / 1000,
            event,
            files_failed: this.filesFailed,
            files_sent: this.filesSent,
            files_skipped: this.filesSkipped,
            files_total: this.filesTotal,
            flow,
            outcome,
            paused: this.pausedAt !== null,
            paused_seconds: pausedMs / 1000,
            pauses: this.pauses,
            recent_errors: this.errors,
            restarts: this.restarts,
            retries: this.retries,
            run_id: this.runId,
            stalls: this.stalls,
        };
        try {
            // One attempt, short timeout, no network retry: a report that can't be
            // sent is superseded by the next one, which carries the same totals.
            await withPymixAuth(pymixAuth, (cookie) =>
                axios.post(`${pymixUrl}/sync/upload_report`, body, {
                    headers: { Cookie: cookie },
                    httpsAgent,
                    timeout: REPORT_TIMEOUT_MS,
                }),
            );
        } catch (err) {
            // Expected while the network is down. Log the first few so a server
            // that rejects them (an older pymix answers 404) shows up once, not
            // once a minute for hours.
            if (++this.reportFailures <= 3) {
                uploadLog.verbose(
                    `[${this.tag}] couldn't send the ${event} report: ${(err as Error).message}`,
                );
            }
        }
    }

    private summary(): string {
        const parts = [
            `${this.filesSent + this.filesFailed}/${this.filesTotal} files`,
            `${mb(this.bytesSent)} of ${mb(this.bytesTotal)}`,
        ];
        if (this.filesFailed) parts.push(`${this.filesFailed} failed`);
        if (this.retries) parts.push(`${this.retries} retries`);
        if (this.stalls) parts.push(`${this.stalls} stalls`);
        if (this.restarts) parts.push(`${this.restarts} restarts`);
        if (this.pauses)
            parts.push(`paused ${this.pauses}x for ${Math.round(this.pausedMs / 1000)}s`);
        parts.push(`${Math.round((Date.now() - this.startedAt) / 1000)}s elapsed`);
        return parts.join(', ');
    }
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

app.on('before-quit', () => {
    for (const run of activeRuns) run.abandon();
});
