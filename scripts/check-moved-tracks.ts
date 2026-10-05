import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    DirEntry,
    fileNameKey,
    findInPlaceTracks,
    findMovedTracks,
    listLibraryRoot,
} from '../src/main/features/core/sync/in-place';
import { movedTrackEntries } from '../src/main/features/core/sync/record-locations';

// A download follows tracks moved inside the library root (#222): one listing of
// the root, only when something is missing, matched by file name; exactly one
// candidate or none; the unavailable-root guard counted after the search; and the
// record payload that replaces the relative path and never the absolute one.
//
// Usage: pnpm run check:moved-tracks

/** A fake disk: a set of files and folders, and symlinks. */
function fakeDisk(files: string[], opts: { links?: string[]; unreadable?: string[] } = {}) {
    const dirs = new Set<string>();
    for (const f of files) {
        let d = path.posix.dirname(f);
        while (d !== '/' && !dirs.has(d)) {
            dirs.add(d);
            d = path.posix.dirname(d);
        }
    }
    const links = new Set(opts.links ?? []);
    let readdirCalls = 0;
    const entry = (full: string): DirEntry => ({
        isDirectory: () => dirs.has(full) && !links.has(full),
        isFile: () => files.includes(full) && !links.has(full),
        isSymbolicLink: () => links.has(full),
        name: path.posix.basename(full),
    });
    return {
        readdir: async (dir: string) => {
            readdirCalls++;
            if (opts.unreadable?.includes(dir)) throw new Error('EACCES');
            const children = new Set<string>();
            for (const p of [...files, ...dirs, ...links]) {
                if (path.posix.dirname(p) === dir) children.add(p);
            }
            return [...children].map(entry);
        },
        get readdirCalls() {
            return readdirCalls;
        },
        stat: async (p: string) => {
            if (dirs.has(p)) return { isDirectory: () => true, isFile: () => false };
            if (files.includes(p)) return { isDirectory: () => false, isFile: () => true };
            throw new Error('ENOENT');
        },
    };
}

const post =
    (locations: Record<string, string>, relativePaths: Record<string, string> = {}) =>
    async () => ({ data: { locations, relativePaths } });

async function main(): Promise<void> {
    // ── fileNameKey ─────────────────────────────────────────────────────────
    assert.equal(
        fileNameKey('Beyonce\u0301.MP3', 'darwin'),
        fileNameKey('beyonc\u00e9.mp3', 'darwin'),
    );
    assert.equal(fileNameKey('A.mp3', 'win32'), fileNameKey('a.mp3', 'win32'));
    // Linux disks are case-sensitive: two names, two files.
    assert.notEqual(fileNameKey('A.mp3', 'linux'), fileNameKey('a.mp3', 'linux'));
    assert.equal(
        fileNameKey('Beyonce\u0301.mp3', 'linux'),
        fileNameKey('Beyonc\u00e9.mp3', 'linux'),
    );

    // ── listLibraryRoot ─────────────────────────────────────────────────────
    const disk = fakeDisk(
        ['/Lib/Deep/a.mp3', '/Lib/House/b.mp3', '/Lib/Cafe\u0301/c.mp3', '/Lib/Private/d.mp3'],
        { links: ['/Lib/Loop', '/Lib/link.mp3'], unreadable: ['/Lib/Private'] },
    );
    const listing = await listLibraryRoot('/Lib', { platform: 'darwin', readdir: disk.readdir });
    assert.equal(listing.files, 3, 'symlinks and an unreadable folder are skipped');
    assert.deepEqual(listing.byName.get('a.mp3'), [
        { path: '/Lib/Deep/a.mp3', relative: 'Deep/a.mp3' },
    ]);
    assert.deepEqual(listing.byName.get('c.mp3'), [
        { path: '/Lib/Cafe\u0301/c.mp3', relative: 'Caf\u00e9/c.mp3' },
    ]);
    assert.equal(listing.byName.has('link.mp3'), false);

    // A real symlink loop doesn't trap the walk.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'moved-tracks-check-'));
    try {
        fs.mkdirSync(path.join(tmp, 'Deep'));
        fs.writeFileSync(path.join(tmp, 'Deep', 'a.mp3'), '');
        fs.symlinkSync(tmp, path.join(tmp, 'Deep', 'loop'));
        const real = await listLibraryRoot(tmp);
        assert.equal(real.files, 1);
    } finally {
        fs.rmSync(tmp, { force: true, recursive: true });
    }

    // ── findMovedTracks ─────────────────────────────────────────────────────
    const twoIntros = fakeDisk([
        '/Lib/A/01 Intro.mp3',
        '/Lib/B/01 Intro.mp3',
        '/Lib/New/x.mp3',
        '/Lib/New/y.mp3',
    ]);
    const l2 = await listLibraryRoot('/Lib', { platform: 'darwin', readdir: twoIntros.readdir });
    const moved = await findMovedTracks({
        listing: l2,
        missing: [
            // Several candidates: never guessed between.
            { relativePath: 'Old/01 Intro.mp3', subboxId: 'sid-intro' },
            // Exactly one, by the relative path's name (case differs on darwin).
            { location: '/Old/Machine/Y.MP3', relativePath: 'Old/X.mp3', subboxId: 'sid-x' },
            // No relative path: the absolute path's name, Windows form too.
            { location: 'C:\\Old\\y.mp3', subboxId: 'sid-y' },
            // None.
            { relativePath: 'Old/gone.mp3', subboxId: 'sid-gone' },
        ],
        platform: 'darwin',
        stat: twoIntros.stat,
    });
    assert.deepEqual(
        moved.sort((a, b) => a.subboxId.localeCompare(b.subboxId)),
        [
            { path: '/Lib/New/x.mp3', rootRelativePath: 'New/x.mp3', subboxId: 'sid-x' },
            { path: '/Lib/New/y.mp3', rootRelativePath: 'New/y.mp3', subboxId: 'sid-y' },
        ],
    );

    // One file two missing tracks name: neither's.
    assert.deepEqual(
        await findMovedTracks({
            listing: l2,
            missing: [
                { relativePath: 'Old/x.mp3', subboxId: 'sid-1' },
                { relativePath: 'Other/x.mp3', subboxId: 'sid-2' },
            ],
            platform: 'darwin',
            stat: twoIntros.stat,
        }),
        [],
    );

    // The winner is stat-ed: gone since the listing, not used.
    assert.deepEqual(
        await findMovedTracks({
            listing: l2,
            missing: [{ relativePath: 'Old/x.mp3', subboxId: 'sid-x' }],
            platform: 'darwin',
            stat: async () => {
                throw new Error('ENOENT');
            },
        }),
        [],
    );

    // ── findInPlaceTracks: when the search runs ─────────────────────────────
    // Nothing missing: no listing.
    const allThere = fakeDisk(['/Lib/House/a.mp3']);
    const r1 = await findInPlaceTracks({
        libraryRoot: '/Lib',
        platform: 'darwin',
        playlistIds: ['p'],
        post: post({ 'sid-a': '/Other/House/a.mp3' }, { 'sid-a': 'House/a.mp3' }),
        readdir: allThere.readdir,
        stat: allThere.stat,
    });
    assert.equal(r1.tracks.length, 1);
    assert.deepEqual(r1.moved, []);
    assert.equal(allThere.readdirCalls, 0, 'no listing when nothing is missing');

    // No root: no listing, and the moved track stays missing.
    const noRoot = fakeDisk(['/Lib/Deep/a.mp3']);
    const r2 = await findInPlaceTracks({
        platform: 'darwin',
        playlistIds: ['p'],
        post: post({ 'sid-a': '/Lib/House/a.mp3' }, { 'sid-a': 'House/a.mp3' }),
        readdir: noRoot.readdir,
        stat: noRoot.stat,
    });
    assert.deepEqual(r2.tracks, []);
    assert.equal(noRoot.readdirCalls, 0, 'no listing without a root');

    // Moved into a subfolder: found at its new path, reported as moved.
    const someMoved = fakeDisk(['/Lib/House/a.mp3', '/Lib/Deep/b.mp3']);
    const r3 = await findInPlaceTracks({
        libraryRoot: '/Lib',
        platform: 'darwin',
        playlistIds: ['p'],
        post: post(
            { 'sid-a': '/Old/House/a.mp3', 'sid-b': '/Old/House/b.mp3' },
            { 'sid-a': 'House/a.mp3', 'sid-b': 'House/b.mp3' },
        ),
        readdir: someMoved.readdir,
        stat: someMoved.stat,
    });
    assert.deepEqual(r3.tracks.map((t) => [t.subboxId, t.userLocation]).sort(), [
        ['sid-a', '/Lib/House/a.mp3'],
        ['sid-b', '/Lib/Deep/b.mp3'],
    ]);
    assert.deepEqual(r3.moved, [{ rootRelativePath: 'Deep/b.mp3', subboxId: 'sid-b' }]);
    assert.deepEqual(r3.libraryRoot, { expected: 2, found: 2, root: '/Lib', status: 'ok' });

    // The whole library moved into one subfolder: the guard counts after the
    // search, so this is not an unavailable root.
    const allMoved = fakeDisk(['/Lib/2026/House/a.mp3', '/Lib/2026/House/b.mp3']);
    const r4 = await findInPlaceTracks({
        libraryRoot: '/Lib',
        platform: 'darwin',
        playlistIds: ['p'],
        post: post({}, { 'sid-a': 'House/a.mp3', 'sid-b': 'House/b.mp3' }),
        readdir: allMoved.readdir,
        stat: allMoved.stat,
    });
    assert.equal(r4.libraryRoot?.status, 'ok');
    assert.equal(r4.moved.length, 2);

    // An empty mount point is still unavailable: the search finds nothing in it.
    const empty = fakeDisk(['/Lib/.keep']);
    const r5 = await findInPlaceTracks({
        libraryRoot: '/Lib',
        platform: 'darwin',
        playlistIds: ['p'],
        post: post({}, { 'sid-a': 'House/a.mp3' }),
        readdir: empty.readdir,
        stat: empty.stat,
    });
    assert.equal(r5.libraryRoot?.status, 'unavailable');
    assert.equal(r5.libraryRoot?.status === 'unavailable' && r5.libraryRoot.code, 'nothing-found');

    // ── The record payload ──────────────────────────────────────────────────
    const entries = movedTrackEntries([{ rootRelativePath: 'Deep/b.mp3', subboxId: 'sid-b' }]);
    assert.deepEqual(entries, [
        { replace: true, root_relative_path: 'Deep/b.mp3', subbox_id: 'sid-b' },
    ]);
    assert.ok(!('user_location' in entries[0]), 'user_location is write-once: never sent');

    console.log(
        '✓ moved tracks are found by name under the root, and only their relative path is replaced',
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
