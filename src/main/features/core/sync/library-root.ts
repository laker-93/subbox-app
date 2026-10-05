import * as fs from 'fs';
import * as path from 'path';

import type { TrackLocationToRecord } from './record-locations';

import { isPlatformAbsolute } from './in-place';

/**
 * The library root: the folder the user keeps their own library in on this device,
 * often a cloud drive (#214 stage 2). Per device, in the main-process settings store
 * (`localSettings` in the renderer), so it never syncs: the same library sits under
 * a different folder on each machine.
 *
 * Subbox only ever reads under it, by stat, and never writes there.
 */
export const LIBRARY_ROOT_SETTING = 'library_root';

const pathFor = (platform: NodeJS.Platform) => (platform === 'win32' ? path.win32 : path.posix);

export type LibraryRootCheck = { ok: false; reason: string } | { ok: true };

/**
 * The entries to send `/tracks/locations/record` so tracks uploaded before this
 * device had a root get their path under it (#219). Only tracks whose recorded
 * path is under the root; pymix fills the relative path where it is null, so
 * sending one that already has it is harmless.
 */
export function backfillEntries(
    root: string,
    locations: Record<string, string>,
    platform: NodeJS.Platform = process.platform,
): TrackLocationToRecord[] {
    const entries: TrackLocationToRecord[] = [];
    for (const [subboxId, location] of Object.entries(locations)) {
        const relative = rootRelative(root, location, platform);
        if (relative) {
            entries.push({
                root_relative_path: relative,
                subbox_id: subboxId,
                user_location: location,
            });
        }
    }
    return entries;
}

/** Whether `dir` can be a library root: an absolute path to an existing folder. */
export async function checkLibraryRoot(
    dir: string,
    opts: {
        platform?: NodeJS.Platform;
        stat?: (p: string) => Promise<{ isDirectory(): boolean }>;
    } = {},
): Promise<LibraryRootCheck> {
    const { platform = process.platform, stat = (p: string) => fs.promises.stat(p) } = opts;
    if (!dir || !isPlatformAbsolute(dir, platform)) {
        return { ok: false, reason: 'Choose a full folder path.' };
    }
    try {
        return (await stat(dir)).isDirectory()
            ? { ok: true }
            : { ok: false, reason: 'That is a file, not a folder.' };
    } catch {
        return { ok: false, reason: 'Folder not found. Is the drive connected?' };
    }
}

/**
 * Whether `dir` is the library root or a folder inside it (#221): the Watch
 * folder there means subbox writes a tag into files that sync to every device.
 */
export function isAtOrUnderRoot(
    root: string,
    dir: string,
    platform: NodeJS.Platform = process.platform,
): boolean {
    if (!isPlatformAbsolute(root, platform) || !isPlatformAbsolute(dir, platform)) return false;
    const relative = pathFor(platform).relative(root.normalize('NFC'), dir.normalize('NFC'));
    return relative === '' || rootRelative(root, dir, platform) !== null;
}

/**
 * `file`'s path under `root`, `/`-separated with its own case kept, or null when
 * it isn't under the root. The one place this rule lives: pymix stores the result
 * as an opaque string and does no path work (#214 point 10).
 *
 * Both sides are NFC first: macOS hands out NFD names, and a root typed or picked
 * one way must still match a file listed the other. `path` is the platform's own,
 * so on Windows the comparison ignores case and takes either separator, and a file
 * on another drive comes back absolute (so: not under the root). A path recorded on
 * another OS is never under it: on Windows `/Users/x` would resolve onto the
 * current drive, and so under a root of `C:\`.
 */
export function rootRelative(
    root: string,
    file: string,
    platform: NodeJS.Platform = process.platform,
): null | string {
    if (!isPlatformAbsolute(root, platform) || !isPlatformAbsolute(file, platform)) return null;
    const impl = pathFor(platform);
    const relative = impl.relative(root.normalize('NFC'), file.normalize('NFC'));
    if (!relative || impl.isAbsolute(relative)) return null;
    const parts = relative.split(impl.sep);
    if (parts[0] === '..') return null;
    return parts.join('/');
}

/**
 * `{ rootRelativePath }` for a `/sync/map_meta` entry, or nothing when no root is
 * set or the file isn't under it (#219). Spread into the entry.
 */
export function withRootRelativePath(
    root: null | string,
    file: string,
): { rootRelativePath?: string } {
    const relative = root ? rootRelative(root, file) : null;
    return relative ? { rootRelativePath: relative } : {};
}
