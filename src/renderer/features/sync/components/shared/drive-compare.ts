/**
 * Splitting the tracks a drive is missing by whether this computer has them
 * (#315, #314).
 *
 * Download can check a USB or external drive as well (#314). It plans the
 * selected playlists twice: against the local library, which decides what is
 * downloaded, and against the drive. A track missing from the drive that this
 * computer has needs only exporting to the drive from the DJ software; one
 * missing from both is downloaded first.
 *
 * Both plans are built by pymix from the same server tracks, so an entry's
 * artist, title and album are the same strings in each: they key one to the other.
 */

export interface DriveMissingSplit<T extends PlannedTrack> {
    // Missing from the drive but already on this computer: ready to export.
    onComputer: T[];
    // Missing from both: downloaded before it can be exported.
    toDownload: T[];
}

export interface PlannedTrack {
    album?: string;
    artist: string;
    title: string;
}

export const plannedTrackKey = (t: PlannedTrack): string =>
    JSON.stringify([t.artist, t.title, t.album ?? '']);

/**
 * `driveMissing` split by `localMissing`, the same playlists' missing tracks when
 * planned against this computer. A null `localMissing` (that plan failed) is read
 * as "nothing is local".
 *
 * Each track once, in the drive plan's order, as the plan's own entry: a plan lists
 * a track once for every selected playlist it is in, and a song in two playlists
 * is still one file to put on the drive.
 */
export function splitDriveMissing<T extends PlannedTrack>(
    driveMissing: T[],
    localMissing: null | PlannedTrack[],
): DriveMissingSplit<T> {
    const missingLocally = localMissing ? new Set(localMissing.map(plannedTrackKey)) : null;
    const onComputer: T[] = [];
    const toDownload: T[] = [];
    const seen = new Set<string>();
    for (const track of driveMissing) {
        const key = plannedTrackKey(track);
        if (seen.has(key)) continue;
        seen.add(key);
        if (missingLocally && !missingLocally.has(key)) {
            onComputer.push(track);
        } else {
            toDownload.push(track);
        }
    }
    return { onComputer, toDownload };
}
