/**
 * Splitting a drive comparison's missing tracks by whether this computer already
 * has them (#315).
 *
 * External Drive compares the selected playlists with the drive. A track missing
 * from the drive may still be in the local library, and downloading it again
 * either wastes the bandwidth or, when the name pymix gives it has changed since
 * (pymix#264), writes a second local copy under the new name. So the screen also
 * plans the same playlists against the local library, and only a track missing
 * from both is downloaded.
 *
 * Both plans are built by pymix from the same server tracks, so an entry's
 * artist, title and album are the same strings in each: they key one to the other.
 */

export interface DriveMissingSplit<T extends PlannedTrack> {
    // Missing from the drive but already in the local library: the DJ software
    // can export these to the drive as they are. Nothing is downloaded.
    onComputer: T[];
    // Missing from both, once each: what the download fetches.
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
 * planned against the local library. A null `localMissing` (that plan failed) is
 * read as "nothing is local", which downloads what it did before this split.
 *
 * `onComputer` keeps the plan's own entries, one per playlist occurrence, as the
 * preview lists them. `toDownload` has each track once: a song in two selected
 * playlists is fetched once.
 */
export function splitDriveMissing<T extends PlannedTrack>(
    driveMissing: T[],
    localMissing: null | PlannedTrack[],
): DriveMissingSplit<T> {
    const missingLocally = localMissing ? new Set(localMissing.map(plannedTrackKey)) : null;
    const onComputer: T[] = [];
    const toDownload: T[] = [];
    const queued = new Set<string>();
    for (const track of driveMissing) {
        const key = plannedTrackKey(track);
        if (missingLocally && !missingLocally.has(key)) {
            onComputer.push(track);
        } else if (!queued.has(key)) {
            queued.add(key);
            toDownload.push(track);
        }
    }
    return { onComputer, toDownload };
}
