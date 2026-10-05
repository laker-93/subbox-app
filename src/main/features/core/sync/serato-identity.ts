import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { rootRelative } from './library-root';
import { canOpenTags, readSubboxId, writeSubboxId } from './subbox-id-tags';

// ── The Serato import never writes into the user's files (#214 point 12, #221) ──
//
// It used to write SUBBOX_ID into every crate track without one. Under a cloud
// drive each write syncs the file to every device (and writing a cloud-only file
// downloads it first), so a first import re-synced the whole library. Now it only
// reads: an untagged file gets an id in memory, a re-import finds it by path
// (pymix's /tracks/by_location), and the bytes uploaded carry the id because
// they come from a tagged copy in a temp folder, not from the user's file.
//
// Kept free of electron imports, with relative imports, for
// scripts/check-serato-no-write.ts.

/**
 * A crate track's identity as read off the file: its own SUBBOX_ID (`fileTag`),
 * or, when it has none, one minted here and written nowhere.
 */
export interface CrateTrackIdentity {
    /** The SUBBOX_ID in the user's file, if any. */
    fileTag: null | string;
    subboxId: string;
}

// Fixed namespace for minted ids: any UUID, never to change, or every untagged
// file in every library gets a new id and uploads again.
const MINT_NAMESPACE = Buffer.from('6f1d2c4e9b8a4f3db1c75e2a0d9e8f41', 'hex');

interface CopyDeps {
    copy?: (from: string, to: string) => Promise<void>;
    remove?: (p: string) => Promise<void>;
    writeId?: (p: string, id: string) => void;
}

/**
 * The body for POST /tracks/by_location: the paths, and when this device has a
 * library root, each one's path under it (null outside it), for pymix to match a
 * file the absolute path doesn't find (pymix#252). No root, no field: the request
 * is exactly what it was before.
 */
export function byLocationBody(
    paths: string[],
    libraryRoot: null | string,
    platform: NodeJS.Platform = process.platform,
): { root_relative_paths?: (null | string)[]; user_locations: string[] } {
    if (!libraryRoot) return { user_locations: paths };
    return {
        root_relative_paths: paths.map((p) => rootRelative(libraryRoot, p, platform)),
        user_locations: paths,
    };
}

/**
 * Read a crate track's identity without writing to it: its SUBBOX_ID, or a minted
 * one. Null when TagLib can't open its tags, so it can't be identified (as
 * `getOrCreateSubboxId` returned).
 */
export function identifyCrateTrack(
    filePath: string,
    username: string,
    deps: {
        canOpen?: (p: string) => boolean;
        mint?: (username: string, p: string) => string;
        read?: (p: string) => null | string;
    } = {},
): CrateTrackIdentity | null {
    const { canOpen = canOpenTags, mint = mintSubboxId, read = readSubboxId } = deps;
    if (!canOpen(filePath)) return null;
    const fileTag = read(filePath);
    return { fileTag, subboxId: fileTag ?? mint(username, filePath) };
}

/**
 * The id an untagged file gets, the same every time for the same user and file.
 *
 * Stable because nothing is written down: a tag on the file used to keep an id
 * across attempts, and without one a retry after a dropped connection would mint a
 * new id for the copy already staged under the old one, and the manifest and the
 * staged bytes would disagree. A UUIDv5 of the username and the file's real path
 * (the true case on a case-insensitive disk, and NFC, so two spellings of one file
 * are one id, as a tag made them).
 */
export function mintSubboxId(
    username: string,
    filePath: string,
    realpath: (p: string) => string = (p) => fs.realpathSync.native(p),
): string {
    let real = filePath;
    try {
        real = realpath(filePath);
    } catch {
        // Gone or unreadable: the caller has already checked it exists, so use the
        // path as given.
    }
    const hash = createHash('sha1')
        .update(MINT_NAMESPACE)
        .update(`${username}\n${real.normalize('NFC')}`, 'utf8')
        .digest();
    hash[6] = (hash[6] & 0x0f) | 0x50;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = hash.subarray(0, 16).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Whether the bytes to upload must come from a tagged copy: the file doesn't carry this id. */
export function needsTaggedCopy(identity: CrateTrackIdentity): boolean {
    return identity.fileTag !== identity.subboxId;
}

const defaultCopy = (from: string, to: string) =>
    // A clone where the disk can (APFS, ReFS): instant, and no second copy's space.
    fs.promises.copyFile(from, to, fs.constants.COPYFILE_FICLONE);
const defaultRemove = (p: string) => fs.promises.rm(p, { force: true });

/**
 * The size of the bytes `withTaggedFile` would send, for comparing against a
 * staged upload (`findWhollyStaged`). Makes and deletes a tagged copy when one is
 * needed; the caller asks only for a file with something already staged.
 */
export async function sendableSize(
    args: CopyDeps & { filePath: string; identity: CrateTrackIdentity; tmpDir: string } & {
        size?: (p: string) => Promise<number>;
    },
): Promise<number> {
    const { size = async (p: string) => (await fs.promises.stat(p)).size } = args;
    return withTaggedFile(args, (sendPath) => size(sendPath));
}

/**
 * Run `fn` on a path whose bytes carry `subboxId`: the user's file itself when it
 * already does, or else a copy in `tmpDir` with the id written into it, deleted
 * afterwards whether `fn` succeeds or not. The user's file is only read.
 */
export async function withTaggedFile<T>(
    args: CopyDeps & { filePath: string; identity: CrateTrackIdentity; tmpDir: string },
    fn: (sendPath: string) => Promise<T>,
): Promise<T> {
    const { filePath, identity, tmpDir } = args;
    if (!needsTaggedCopy(identity)) return fn(filePath);
    const { copy = defaultCopy, remove = defaultRemove, writeId = writeSubboxId } = args;
    // Named by id, which is unique within one import; the extension is kept, as
    // TagLib picks the format by it.
    const copyPath = path.join(tmpDir, `${identity.subboxId}${path.extname(filePath)}`);
    try {
        await copy(filePath, copyPath);
        writeId(copyPath, identity.subboxId);
        return await fn(copyPath);
    } finally {
        await remove(copyPath).catch((err) =>
            console.warn(`[serato] could not delete the temp copy ${copyPath}:`, err),
        );
    }
}
