/**
 * The job envelope: what /beets/import/progress reports, and what it means.
 *
 * Kept free of React so the invariants below can be checked outside a browser
 * (`pnpm run check:job-outcome`) — subbox-app has no unit-test runner, and the
 * rule these encode is one a screen must not be allowed to get wrong twice.
 */
export type ImportPhase = 'applying_metadata' | 'complete' | 'importing_audio' | 'mapping_ids';

/**
 * A finished or running import job, as /beets/import/progress reports it.
 *
 * One definition for every screen that polls a job. It was two identical copies,
 * one per sync screen, which is the shape laker-93/pymix#171 §4.5 is about: four
 * call sites complete jobs and each screen read the result its own way, so a
 * server-side improvement had to be re-landed on every screen to be seen.
 */
export interface ImportProgress {
    in_progress: boolean;
    n_tracks_processed: number;
    n_tracks_to_process: number;
    percentage_complete: number;
    /**
     * Which pass the server is on, and how far through it is. An import is three
     * passes, and only the first shows up in the track count the percentage used
     * to be derived from — so the bar read a frozen 100% for the whole tail
     * (laker-93/pymix#51). Optional: a server predating that fix sends neither.
     */
    phase?: ImportPhase | null;
    phase_n_processed?: number;
    phase_n_total?: number;
    /**
     * Per-pass counts, on a finished job. Absent means *not reported* — an older
     * server, a job row from before migration 019, or a path that still completes
     * its job with a bare boolean (the Serato import, the watch-dir handler). It
     * never means the job did no work, so nothing here may render a zero from it.
     */
    phases?: JobPhaseCounts[] | null;
    reason: string;
    result: boolean;
    /**
     * What a *successful* job could not do. `reason` only reaches the client on a
     * failed job, so a job that finished but left something out has nowhere else
     * to say so (laker-93/pymix#136).
     */
    warnings?: null | string;
}

/**
 * What one pass of a job attempted and how it went (pymix migration 019).
 *
 * These are counts of *outcomes*, not of progress: they are written once, when the
 * job finishes, and they deliberately disagree with `phase_n_processed` mid-run —
 * a track is "processed" when the slow part is done with it and "ok" only once its
 * write has landed.
 */
export interface JobPhaseCounts {
    failed: number;
    ok: number;
    phase: string;
    skipped: number;
    total: number;
}

export const IMPORT_PHASE_LABELS: Record<ImportPhase, string> = {
    applying_metadata: 'Applying cue points and metadata...',
    complete: 'Finishing up...',
    importing_audio: 'Importing into library...',
    mapping_ids: 'Linking tracks to your library...',
};

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * What a completed pass is worth telling the user, for the passes where that is
 * something they don't already know.
 *
 * Two phases are deliberately absent. `mapping_ids` links uploaded files to
 * library rows — plumbing the user has no model of, and its *failures* still
 * reach them through the server's `warnings`. `importing_audio` is the one count
 * every screen here already shows for itself, from its own upload result; a line
 * from the server saying it again would be the same number twice.
 *
 * An unrecognised phase — a newer server than this client — renders nothing,
 * rather than showing the user a raw phase name.
 */
const PHASE_WORK: Record<string, (n: number) => string> = {
    applying_metadata: (n) =>
        `Metadata updated on ${plural(n, 'track')} (BPM, ratings, cue points)`,
};

/**
 * The work a finished job did, one line per pass, in the user's terms.
 *
 * This is the count laker-93/subbox-app#50 was missing. A re-import of a library
 * that is already uploaded lands no audio, so both numbers that screen had —
 * `uploaded` and `n_tracks_processed` — correctly read 0, and the run that
 * rewrote BPM, ratings and cues on every track was reported as "Imported 0
 * tracks". Nothing was lying; the screen was measuring the wrong thing.
 */
export const describeJobWork = (progress?: ImportProgress | null): string[] => {
    if (!progress?.phases) return [];
    return progress.phases
        .filter((p) => p.ok > 0)
        .map((p) => PHASE_WORK[p.phase]?.(p.ok))
        .filter((line): line is string => Boolean(line));
};
