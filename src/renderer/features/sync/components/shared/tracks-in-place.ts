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
