import { isAxiosError } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

/**
 * A track found on this machine where it was uploaded from, in the shape a
 * download's `localTracks` takes. pymix leaves it out of the zip by `subboxId`, and
 * writes `userLocation` as its Rekordbox XML Location (#214 stage 1).
 *
 * pymix matches it by `subboxId` alone; the title is the file name, for its logs.
 */
export interface InPlaceTrack {
    artist: string;
    fromTag: boolean;
    subboxId: string;
    title: string;
    userLocation: string;
}

// Stats in flight at once. One per track, so a whole library is ~12k of them.
const STAT_CONCURRENCY = 32;

type StatFn = (p: string) => Promise<{ isFile(): boolean }>;

/**
 * pymix's recorded upload path for each track in these playlists
 * (`POST /tracks/locations`), or null when it can't say.
 *
 * Null on any failure, and the download then goes ahead exactly as before. That
 * matters for a pymix from before the endpoint (a 404): it would leave these
 * tracks out of the zip yet still point the XML into AppData.
 */
export async function fetchTrackLocations(args: {
    playlistIds: string[];
    post: (playlistIds: string[]) => Promise<{ data: { locations?: Record<string, string> } }>;
}): Promise<null | Record<string, string>> {
    const { playlistIds, post } = args;
    if (playlistIds.length === 0) return {};
    try {
        const res = await post(playlistIds);
        return res.data.locations ?? {};
    } catch (err) {
        if (isAxiosError(err) && err.response?.status === 404) {
            console.log('[sync] pymix has no /tracks/locations; no tracks used in place');
        } else {
            console.warn('[sync] could not fetch track locations; no tracks used in place:', err);
        }
        return null;
    }
}

/**
 * The tracks in these playlists that are still where they were uploaded from, as
 * `localTracks` entries. Empty when pymix can't answer.
 */
export async function findInPlaceTracks(args: {
    platform?: NodeJS.Platform;
    playlistIds: string[];
    post: (playlistIds: string[]) => Promise<{ data: { locations?: Record<string, string> } }>;
    stat?: StatFn;
}): Promise<InPlaceTrack[]> {
    const locations = await fetchTrackLocations(args);
    if (!locations) return [];
    const candidates = new Map(
        Object.entries(locations).map(([subboxId, location]) => [subboxId, [location]]),
    );
    const found = await resolveInPlace(candidates, { platform: args.platform, stat: args.stat });
    console.log(
        `[sync] ${found.size} of ${candidates.size} track(s) with an upload path found in place`,
    );
    return Array.from(found, ([subboxId, userLocation]) => ({
        artist: '',
        fromTag: true,
        subboxId,
        title: path.parse(userLocation.replace(/\\/g, '/')).name,
        userLocation,
    }));
}

/**
 * Whether `p` is an absolute path in this platform's own form (#214 point 8).
 *
 * A path recorded on another OS isn't one to stat here: to Node on macOS,
 * `C:\Music\a.mp3` is relative to the working directory, and on Windows
 * `/Users/x/a.mp3` is rooted on the current drive. Windows takes a drive letter
 * (`C:\` or `C:/`) or a UNC share (`\\server\share`); `path.win32.isAbsolute` would
 * also take `\foo`, which is the current drive again.
 */
export function isPlatformAbsolute(
    p: string,
    platform: NodeJS.Platform = process.platform,
): boolean {
    if (platform === 'win32') {
        return /^[A-Za-z]:[\\/]/.test(p) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(p);
    }
    return p.startsWith('/');
}

/**
 * For each track, the first of its candidate paths that is a file here; tracks
 * with none are left out. Stat only, never open: on OneDrive a stat leaves a
 * cloud-only file cloud-only (#214 point 1), and such a file counts as present
 * (point 2). The path is trusted, with no size or tag check (point 4).
 *
 * Candidates are tried in order. Stage 1 has one per track, the path it was
 * uploaded from; stage 2 adds the library root's (#220, #222) to the same list.
 */
export async function resolveInPlace(
    candidates: Map<string, string[]>,
    opts: { platform?: NodeJS.Platform; stat?: StatFn } = {},
): Promise<Map<string, string>> {
    const { platform = process.platform, stat = (p: string) => fs.promises.stat(p) } = opts;
    const entries = Array.from(candidates.entries());
    const found = new Map<string, string>();

    const resolveOne = async ([subboxId, paths]: [string, string[]]) => {
        for (const candidate of paths) {
            if (!candidate || !isPlatformAbsolute(candidate, platform)) continue;
            try {
                if ((await stat(candidate)).isFile()) {
                    found.set(subboxId, candidate);
                    return;
                }
            } catch {
                // Not there (ENOENT), or unreadable: try the next candidate.
            }
        }
    };

    let next = 0;
    const worker = async () => {
        while (next < entries.length) {
            await resolveOne(entries[next++]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(STAT_CONCURRENCY, entries.length) }, worker));
    return found;
}
