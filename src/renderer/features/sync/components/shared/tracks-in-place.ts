/**
 * Whether a download uses the tracks still where the user uploaded them from,
 * rather than downloading them (#214 stage 1).
 *
 * Desktop only: the web build can't look at the user's disk. Rekordbox only, with
 * no Serato crates written alongside (point 9): a crate needs every track under
 * the music folder, and its cues and grids are written into the track files, which
 * here would be the user's own.
 */
export const usesTracksInPlace = (args: {
    electron: boolean;
    includeRekordboxXml: boolean;
    includeSeratoCrates: boolean;
}): boolean => args.electron && args.includeRekordboxXml && !args.includeSeratoCrates;

/**
 * How many of a plan's missing tracks an XML-only download leaves pointing at
 * files that don't exist (#230). Nothing is downloaded, so the XML sends each one
 * into the app's music folder, where it isn't, and Rekordbox reports it as "not
 * imported" for reasons that aren't the real one.
 *
 * Counted once per track: the plan lists a track once for every playlist it's in.
 * Zero for a download that fetches tracks, and on web, which can't tell what is
 * on the user's disk.
 */
export const xmlOnlyMissingCount = (args: {
    electron: boolean;
    includeRekordboxXml: boolean;
    includeTracks: boolean;
    missing: Array<{ album?: string; artist: string; title: string }>;
}): number => {
    if (!args.electron || args.includeTracks || !args.includeRekordboxXml) return 0;
    return new Set(args.missing.map((t) => JSON.stringify([t.artist, t.title, t.album ?? ''])))
        .size;
};

/** Mirrors LibraryRootStatus in main/features/core/sync/in-place.ts (#220). */
export type LibraryRootStatus =
    | {
          code: 'missing' | 'not-a-folder' | 'nothing-found';
          reason: string;
          root: string;
          status: 'unavailable';
      }
    | { expected: number; found: number; root: string; status: 'ok' };
