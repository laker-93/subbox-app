import { isAxiosError } from 'axios';
import * as fs from 'fs';

import { rootRelative } from './library-root';

/** One entry of pymix's `POST /tracks/locations/record` body. */
export interface TrackLocationToRecord {
    // user_location under this device's library root, when one is set (#219).
    root_relative_path?: string;
    subbox_id: string;
    user_location: string;
}

// pymix caps a /tracks/locations/record request at 1000 tracks.
export const RECORD_LOCATIONS_CHUNK = 1000;

/**
 * Where on this machine each matched track lives, for the tracks an upload saw but
 * didn't send (#214 point 5).
 *
 * `/sync/match_tracks` answers in request order, so `matched[i]` is `sent[i]`'s
 * answer. Its `subboxId` is the library track it matched; a pymix from before
 * laker-93/pymix#247 sends none, and then nothing is recorded. A path that doesn't
 * exist here is left out: pymix keeps the first path recorded for a track, so a stale
 * XML entry would otherwise block the right one for good.
 *
 * With a library root set, each entry also carries its path under the root (#219),
 * which pymix fills in where the track has none.
 */
export function matchedTrackLocations(
    sent: Array<{ userLocation?: null | string }>,
    matched: Array<{ matched: boolean; subboxId?: null | string }>,
    exists: (filePath: string) => boolean = fs.existsSync,
    root: null | string = null,
): TrackLocationToRecord[] {
    const entries: TrackLocationToRecord[] = [];
    const seen = new Set<string>();
    matched.forEach((answer, i) => {
        const location = sent[i]?.userLocation;
        if (!answer.matched || !answer.subboxId || !location) return;
        if (seen.has(answer.subboxId) || !exists(location)) return;
        seen.add(answer.subboxId);
        const relative = root ? rootRelative(root, location) : null;
        entries.push({
            subbox_id: answer.subboxId,
            user_location: location,
            ...(relative ? { root_relative_path: relative } : {}),
        });
    });
    return entries;
}

/**
 * Send the entries to `/tracks/locations/record`, a chunk at a time. Returns how
 * many tracks pymix recorded a path for.
 *
 * Never throws: a path that isn't recorded only means that track reads as missing
 * on a later download, which is not worth failing an upload over. A 404 is a pymix
 * from before the endpoint; it is logged once and the remaining chunks are not sent.
 */
export async function recordTrackLocations(args: {
    entries: TrackLocationToRecord[];
    post: (chunk: TrackLocationToRecord[]) => Promise<{ data: { recorded?: string[] } }>;
}): Promise<number> {
    const { entries, post } = args;
    let recorded = 0;
    for (let i = 0; i < entries.length; i += RECORD_LOCATIONS_CHUNK) {
        const chunk = entries.slice(i, i + RECORD_LOCATIONS_CHUNK);
        try {
            const res = await post(chunk);
            recorded += res.data.recorded?.length ?? 0;
        } catch (err) {
            if (isAxiosError(err) && err.response?.status === 404) {
                console.log('[sync] pymix has no /tracks/locations/record; no paths recorded');
            } else {
                console.warn('[sync] could not record the paths of matched tracks:', err);
            }
            return recorded;
        }
    }
    return recorded;
}
