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

export interface InPlaceResult {
    // Null when no root is set, it was ignored, or pymix couldn't answer.
    libraryRoot: LibraryRootStatus | null;
    tracks: InPlaceTrack[];
}

/**
 * Whether this device's library root could be looked under, and what was found
 * there (#214 point 11).
 *
 * Unavailable when it isn't an existing folder, or when it is but none of the
 * tracks expected under it (those with a relative path) were found by any path:
 * an empty mount point, or a cloud folder whose provider is signed out. A stat of
 * a file under an unmounted drive is a plain ENOENT, the same as a deleted file,
 * so without this the plan would read the whole library as missing and download
 * it. An unavailable root blocks the download until the user acts.
 */
export type LibraryRootStatus =
    | {
          code: 'missing' | 'not-a-folder' | 'nothing-found';
          reason: string;
          root: string;
          status: 'unavailable';
      }
    | { expected: number; found: number; root: string; status: 'ok' };

/** What `POST /tracks/locations` says about the tracks in some playlists. */
export interface TrackPaths {
    // Where each was uploaded from: absolute on the machine that uploaded it.
    locations: Record<string, string>;
    // Where each is under that machine's library root, `/`-separated (#251). Empty
    // from a pymix before #251.
    relativePaths: Record<string, string>;
}

type PostLocations = (playlistIds: string[]) => Promise<{
    data: { locations?: Record<string, string>; relativePaths?: Record<string, string> };
}>;

type StatFn = (p: string) => Promise<{ isFile(): boolean }>;

/**
 * pymix's recorded paths for each track in these playlists
 * (`POST /tracks/locations`), or null when it can't say.
 *
 * Null on any failure, and the download then goes ahead exactly as before. That
 * matters for a pymix from before the endpoint (a 404): it would leave these
 * tracks out of the zip yet still point the XML into AppData.
 */
export async function fetchTrackPaths(args: {
    playlistIds: string[];
    post: PostLocations;
}): Promise<null | TrackPaths> {
    const { playlistIds, post } = args;
    if (playlistIds.length === 0) return { locations: {}, relativePaths: {} };
    try {
        const res = await post(playlistIds);
        return { locations: res.data.locations ?? {}, relativePaths: res.data.relativePaths ?? {} };
    } catch (err) {
        if (isAxiosError(err) && err.response?.status === 404) {
            console.log('[sync] pymix has no /tracks/locations; no tracks used in place');
        } else {
            console.warn('[sync] could not fetch track locations; no tracks used in place:', err);
        }
        return null;
    }
}

const pathFor = (platform: NodeJS.Platform) => (platform === 'win32' ? path.win32 : path.posix);

/**
 * The tracks in these playlists found on this machine, as `localTracks` entries,
 * and the state of the library root if one is set.
 *
 * Each track has an ordered list of candidate paths, and the first that stats as
 * a file wins: where it was uploaded from, then this device's root joined with its
 * path under the uploading device's root (#220). One resolver, so later stages add
 * candidates and no second code path. When the root isn't an existing folder its
 * candidates are left out, and only the first is tried.
 */
export async function findInPlaceTracks(args: {
    libraryRoot?: null | string;
    platform?: NodeJS.Platform;
    playlistIds: string[];
    post: PostLocations;
    stat?: (p: string) => Promise<{ isDirectory?(): boolean; isFile(): boolean }>;
}): Promise<InPlaceResult> {
    const { libraryRoot = null, platform = process.platform, playlistIds, post } = args;
    const stat = args.stat ?? ((p: string) => fs.promises.stat(p));
    const paths = await fetchTrackPaths({ playlistIds, post });
    if (!paths) return { libraryRoot: null, tracks: [] };

    let rootStatus: LibraryRootStatus | null = null;
    let rootUsable = false;
    if (libraryRoot) {
        try {
            const st = await stat(libraryRoot);
            if (st.isDirectory?.()) {
                rootUsable = true;
            } else {
                rootStatus = {
                    code: 'not-a-folder',
                    reason: 'It is a file, not a folder.',
                    root: libraryRoot,
                    status: 'unavailable',
                };
            }
        } catch {
            rootStatus = {
                code: 'missing',
                reason: 'The folder is not there. Is the drive connected?',
                root: libraryRoot,
                status: 'unavailable',
            };
        }
    }

    const ids = new Set([...Object.keys(paths.locations), ...Object.keys(paths.relativePaths)]);
    const candidates = new Map<string, string[]>();
    const expectedUnderRoot = new Set<string>();
    for (const subboxId of ids) {
        const list: string[] = [];
        const location = paths.locations[subboxId];
        if (location) list.push(location);
        const relative = paths.relativePaths[subboxId];
        if (rootUsable && libraryRoot && relative) {
            const joined = joinUnderRoot(libraryRoot, relative, platform);
            if (joined) {
                list.push(joined);
                expectedUnderRoot.add(subboxId);
            }
        }
        if (list.length > 0) candidates.set(subboxId, list);
    }

    const found = await resolveInPlace(candidates, { platform, stat });
    console.log(
        `[sync] ${found.size} of ${candidates.size} track(s) with a recorded path found in place`,
    );

    if (rootUsable && libraryRoot) {
        const foundUnderRoot = [...expectedUnderRoot].filter((id) => found.has(id)).length;
        rootStatus =
            expectedUnderRoot.size > 0 && foundUnderRoot === 0
                ? {
                      code: 'nothing-found',
                      reason: 'None of your tracks were found in it. Is the drive or cloud folder connected?',
                      root: libraryRoot,
                      status: 'unavailable',
                  }
                : {
                      expected: expectedUnderRoot.size,
                      found: foundUnderRoot,
                      root: libraryRoot,
                      status: 'ok',
                  };
    }

    return {
        libraryRoot: rootStatus,
        tracks: Array.from(found, ([subboxId, userLocation]) => ({
            artist: '',
            fromTag: true,
            subboxId,
            title: path.parse(userLocation.replace(/\\/g, '/')).name,
            userLocation,
        })),
    };
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
 * `root` joined with a `/`-separated relative path from pymix, in this platform's
 * form (`\\` on Windows), or null for a path that would leave the root. pymix
 * stores the relative path as an opaque string, so it is checked here.
 */
export function joinUnderRoot(
    root: string,
    relativePath: string,
    platform: NodeJS.Platform = process.platform,
): null | string {
    const parts = relativePath.split('/');
    if (!relativePath || relativePath.startsWith('/') || parts.some((p) => p === '..')) return null;
    if (platform === 'win32' && /^[A-Za-z]:/.test(relativePath)) return null;
    return pathFor(platform).join(root, ...parts);
}

/**
 * For each track, the first of its candidate paths that is a file here; tracks
 * with none are left out. Stat only, never open: on OneDrive a stat leaves a
 * cloud-only file cloud-only (#214 point 1), and such a file counts as present
 * (point 2). The path is trusted, with no size or tag check (point 4).
 *
 * Candidates are tried in order: the path it was uploaded from, then the library
 * root's (#220); #222 adds the filename search to the same list.
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
