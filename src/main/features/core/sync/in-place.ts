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

/** The slice of `fs.Dirent` the root walk reads. */
export interface DirEntry {
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
    name: string;
}

export interface InPlaceResult {
    // Null when no root is set, it was ignored, or pymix couldn't answer.
    libraryRoot: LibraryRootStatus | null;
    // Tracks found only by the filename search under the root (#222): moved inside
    // it since their path was recorded. Each is also in `tracks`, at its new path.
    // The download records `rootRelativePath` as the track's new path; the preview
    // only counts them.
    moved: MovedTrack[];
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

/** A track found at a new place under the library root (#222). */
export interface MovedTrack {
    // Its new path under this device's root, `/`-separated and NFC.
    rootRelativePath: string;
    subboxId: string;
}

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

type ReaddirFn = (dir: string) => Promise<DirEntry[]>;

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

export interface RootListing {
    byName: Map<string, Array<{ path: string; relative: string }>>;
    // Files listed, for the log.
    files: number;
}

/**
 * A file name as the root listing keys it: NFC, and case-folded where the disk is
 * case-insensitive (macOS, Windows), so a name recorded one way finds a file
 * listed the other.
 */
export function fileNameKey(name: string, platform: NodeJS.Platform = process.platform): string {
    const nfc = name.normalize('NFC');
    return platform === 'darwin' || platform === 'win32' ? nfc.toLowerCase() : nfc;
}

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
    readdir?: ReaddirFn;
    stat?: (p: string) => Promise<{ isDirectory?(): boolean; isFile(): boolean }>;
}): Promise<InPlaceResult> {
    const { libraryRoot = null, platform = process.platform, playlistIds, post } = args;
    const stat = args.stat ?? ((p: string) => fs.promises.stat(p));
    const paths = await fetchTrackPaths({ playlistIds, post });
    if (!paths) return { libraryRoot: null, moved: [], tracks: [] };

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

    // The last candidate (#222): a track still missing may have been moved inside
    // the root. One listing of the root, only when something is missing, matched
    // by file name. Its own step rather than a list entry, since the listing is
    // shared by every track and only exists once one needs it.
    const moved: MovedTrack[] = [];
    if (rootUsable && libraryRoot) {
        const missing = [...ids].filter((id) => !found.has(id));
        if (missing.length > 0) {
            const started = Date.now();
            const listing = await listLibraryRoot(libraryRoot, {
                platform,
                readdir: args.readdir,
            });
            const relocated = await findMovedTracks({
                listing,
                missing: missing.map((subboxId) => ({
                    location: paths.locations[subboxId],
                    relativePath: paths.relativePaths[subboxId],
                    subboxId,
                })),
                platform,
                stat,
            });
            for (const track of relocated) {
                found.set(track.subboxId, track.path);
                moved.push({ rootRelativePath: track.rootRelativePath, subboxId: track.subboxId });
            }
            console.log(
                `[sync] ${relocated.length} of ${missing.length} missing track(s) found at a new ` +
                    `place under the library root (${listing.files} file(s) listed in ` +
                    `${Date.now() - started} ms)`,
            );
        }
    }
    console.log(`[sync] ${found.size} of ${ids.size} track(s) with a recorded path found in place`);

    if (rootUsable && libraryRoot) {
        // Counted after the search (#222 point 5): a library moved wholesale into a
        // subfolder is found by it, and must not read as an unmounted drive.
        const foundUnderRoot =
            [...expectedUnderRoot].filter((id) => found.has(id)).length +
            moved.filter((m) => !expectedUnderRoot.has(m.subboxId)).length;
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
        moved,
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
 * The missing tracks the root listing finds by file name (#222): the name of the
 * recorded path under the root, or of the absolute one when there is none.
 *
 * Exactly one file of that name is the track; none or several leave it missing,
 * never guessed between. A file two missing tracks both name is neither's. The
 * winner is stat-ed before use, as every other candidate is.
 */
export async function findMovedTracks(args: {
    listing: RootListing;
    missing: Array<{ location?: string; relativePath?: string; subboxId: string }>;
    platform?: NodeJS.Platform;
    stat?: StatFn;
}): Promise<Array<{ path: string; rootRelativePath: string; subboxId: string }>> {
    const { listing, missing, platform = process.platform } = args;
    const stat = args.stat ?? ((p: string) => fs.promises.stat(p));
    const claims = new Map<string, Array<{ relative: string; subboxId: string }>>();
    for (const track of missing) {
        const recorded = track.relativePath || track.location;
        if (!recorded) continue;
        const name = recorded.split(/[\\/]/).pop();
        if (!name) continue;
        const files = listing.byName.get(fileNameKey(name, platform)) ?? [];
        if (files.length !== 1) continue;
        const list = claims.get(files[0].path) ?? [];
        list.push({ relative: files[0].relative, subboxId: track.subboxId });
        claims.set(files[0].path, list);
    }
    const moved: Array<{ path: string; rootRelativePath: string; subboxId: string }> = [];
    for (const [filePath, claimants] of claims) {
        if (claimants.length !== 1) continue;
        try {
            if (!(await stat(filePath)).isFile()) continue;
        } catch {
            continue;
        }
        moved.push({
            path: filePath,
            rootRelativePath: claimants[0].relative,
            subboxId: claimants[0].subboxId,
        });
    }
    return moved;
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
 * Every file under the library root, by name: one recursive listing of directory
 * entries, never opening or stat-ing a file (#222). Symlinks are skipped, file and
 * folder alike, so a loop can't trap the walk. A cloud-only file lists as an
 * ordinary file, and listing hydrates nothing on Windows (#166).
 *
 * Keyed by `fileNameKey`; each value is every file of that name, with its path and
 * its path under the root (`/`-separated, NFC, as `rootRelative` gives). An
 * unreadable folder is skipped, not fatal.
 */
export async function listLibraryRoot(
    root: string,
    opts: { platform?: NodeJS.Platform; readdir?: ReaddirFn } = {},
): Promise<RootListing> {
    const { platform = process.platform } = opts;
    const readdir =
        opts.readdir ?? ((dir: string) => fs.promises.readdir(dir, { withFileTypes: true }));
    const impl = pathFor(platform);
    const byName = new Map<string, Array<{ path: string; relative: string }>>();
    let files = 0;
    const walk = async (dir: string, relative: string[]) => {
        let entries: DirEntry[];
        try {
            entries = await readdir(dir);
        } catch (err) {
            console.warn(`[sync] could not list ${dir} while looking for moved tracks:`, err);
            return;
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink()) continue;
            const full = impl.join(dir, entry.name);
            const parts = [...relative, entry.name];
            if (entry.isDirectory()) {
                await walk(full, parts);
            } else if (entry.isFile()) {
                files++;
                const key = fileNameKey(entry.name, platform);
                const list = byName.get(key) ?? [];
                list.push({ path: full, relative: parts.join('/').normalize('NFC') });
                byName.set(key, list);
            }
        }
    };
    await walk(root, []);
    return { byName, files };
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
