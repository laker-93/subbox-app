import { fetchTrackLocations } from './in-place';
import { backfillEntries } from './library-root';
import { recordTrackLocations, TrackLocationToRecord } from './record-locations';

/**
 * Give the tracks already uploaded from under this device's library root their
 * path under it, so another device can find them under its own (#219). No new
 * endpoint: `/tracks/locations` gives each track's recorded path, and
 * `/tracks/locations/record` fills the relative path where it is null, so running
 * it again is harmless.
 *
 * Returns how many of the playlists' tracks are under the root and how many pymix
 * recorded, or null when pymix can't answer (before laker-93/pymix#248, or any
 * error). Never throws: a failure here is logged, never shown as an error.
 */
export async function backfillLibraryRoot(args: {
    platform?: NodeJS.Platform;
    playlistIds: string[];
    postLocations: (
        playlistIds: string[],
    ) => Promise<{ data: { locations?: Record<string, string> } }>;
    postRecord: (chunk: TrackLocationToRecord[]) => Promise<{ data: { recorded?: string[] } }>;
    root: string;
}): Promise<null | { recorded: number; underRoot: number }> {
    const { platform, playlistIds, postLocations, postRecord, root } = args;
    const locations = await fetchTrackLocations({ playlistIds, post: postLocations });
    if (!locations) return null;
    const entries = backfillEntries(root, locations, platform);
    const recorded = await recordTrackLocations({ entries, post: postRecord });
    console.log(
        `[sync] library root backfill: ${entries.length} of ${Object.keys(locations).length} track(s) under ${root}; ${recorded} recorded`,
    );
    return { recorded, underRoot: entries.length };
}
