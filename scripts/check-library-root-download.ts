import assert from 'node:assert/strict';

import { findInPlaceTracks, joinUnderRoot } from '../src/main/features/core/sync/in-place';
import { usesTracksInPlace } from '../src/renderer/features/sync/components/shared/tracks-in-place';

// A Rekordbox download finds tracks under this device's library root (#214 stage 2,
// #220): root + the relative path pymix recorded (#251) is each track's second
// candidate, after where it was uploaded from, and an unavailable root blocks the
// download rather than fetching everything (point 11).
//
// Usage: pnpm run check:library-root-download

/** A fake disk: `files` and `dirs` stat, everything else is ENOENT. Records what it was asked. */
function fakeDisk(files: string[], dirs: string[] = []) {
    const asked: string[] = [];
    const stat = async (p: string) => {
        asked.push(p);
        if (files.includes(p)) return { isDirectory: () => false, isFile: () => true };
        if (dirs.includes(p)) return { isDirectory: () => true, isFile: () => false };
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    };
    return { asked, stat };
}

// What machine A uploaded: absolute paths on A, and their paths under A's root.
const FROM_A = {
    locations: {
        'sid-both': '/Volumes/A/Music/House/both.mp3',
        'sid-here': '/Users/b/Music/here.mp3',
        'sid-neither': '/Volumes/A/Music/House/neither.mp3',
        'sid-no-relative': '/Volumes/A/Music/old.mp3',
    },
    relativePaths: {
        'sid-both': 'House/both.mp3',
        'sid-neither': 'House/neither.mp3',
    },
};
const post = async () => ({ data: FROM_A });

async function main(): Promise<void> {
    // ── joining a POSIX relative path ────────────────────────────────────
    assert.equal(
        joinUnderRoot('/Users/b/OneDrive', 'House/a b.mp3', 'darwin'),
        '/Users/b/OneDrive/House/a b.mp3',
    );
    assert.equal(
        joinUnderRoot('C:\\Users\\B\\OneDrive', 'House/Deep/a.mp3', 'win32'),
        'C:\\Users\\B\\OneDrive\\House\\Deep\\a.mp3',
    );
    assert.equal(joinUnderRoot('D:\\', 'Music/a.mp3', 'win32'), 'D:\\Music\\a.mp3');
    // Nothing that would leave the root.
    for (const bad of ['', '/etc/passwd', '../outside.mp3', 'House/../../x.mp3']) {
        assert.equal(joinUnderRoot('/Music', bad, 'darwin'), null, bad);
    }
    assert.equal(joinUnderRoot('C:\\Music', 'D:/x.mp3', 'win32'), null);

    // ── found by user_location, by root + relative path, and by neither ──
    const root = '/Users/b/OneDrive';
    const disk = fakeDisk(['/Users/b/Music/here.mp3', '/Users/b/OneDrive/House/both.mp3'], [root]);
    const result = await findInPlaceTracks({
        libraryRoot: root,
        platform: 'darwin',
        playlistIds: ['pl'],
        post,
        stat: disk.stat,
    });
    assert.deepEqual(Object.fromEntries(result.tracks.map((t) => [t.subboxId, t.userLocation])), {
        // The joined path goes to pymix as the in-place userLocation.
        'sid-both': '/Users/b/OneDrive/House/both.mp3',
        'sid-here': '/Users/b/Music/here.mp3',
    });
    assert.deepEqual(result.libraryRoot, { expected: 2, found: 1, root, status: 'ok' });
    // The root is checked before any track under it, and the upload path comes first.
    assert.equal(disk.asked[0], root);
    assert.ok(
        disk.asked.indexOf('/Volumes/A/Music/House/both.mp3') <
            disk.asked.indexOf('/Users/b/OneDrive/House/both.mp3'),
    );

    // On Windows: the POSIX relative path is joined with backslashes, and A's macOS
    // paths are skipped (point 8) rather than stat'd.
    const winRoot = 'D:\\OneDrive';
    const winDisk = fakeDisk(['D:\\OneDrive\\House\\both.mp3'], [winRoot]);
    const win = await findInPlaceTracks({
        libraryRoot: winRoot,
        platform: 'win32',
        playlistIds: ['pl'],
        post,
        stat: winDisk.stat,
    });
    assert.deepEqual(
        win.tracks.map((t) => t.userLocation),
        ['D:\\OneDrive\\House\\both.mp3'],
    );
    assert.ok(winDisk.asked.every((p) => !p.startsWith('/')));

    // ── an unavailable root ──────────────────────────────────────────────
    // Missing (an unmounted drive): unavailable, and no path under it is tried.
    const missing = fakeDisk(['/Users/b/Music/here.mp3']);
    const missingResult = await findInPlaceTracks({
        libraryRoot: '/Volumes/Gone',
        platform: 'darwin',
        playlistIds: ['pl'],
        post,
        stat: missing.stat,
    });
    assert.equal(missingResult.libraryRoot?.status, 'unavailable');
    assert.equal(
        missingResult.libraryRoot?.status === 'unavailable' && missingResult.libraryRoot.code,
        'missing',
    );
    assert.ok(missing.asked.every((p) => !p.startsWith('/Volumes/Gone/')));
    // Stage 1's candidate still runs, so the plan is right once the user goes ahead.
    assert.deepEqual(
        missingResult.tracks.map((t) => t.subboxId),
        ['sid-here'],
    );

    // A file, not a folder.
    const notDir = await findInPlaceTracks({
        libraryRoot: '/Users/b/file.mp3',
        platform: 'darwin',
        playlistIds: ['pl'],
        post,
        stat: fakeDisk(['/Users/b/file.mp3']).stat,
    });
    assert.equal(
        notDir.libraryRoot?.status === 'unavailable' && notDir.libraryRoot.code,
        'not-a-folder',
    );

    // There, but none of the tracks expected under it found (an empty mount point, a
    // signed-out cloud folder): unavailable too.
    const empty = await findInPlaceTracks({
        libraryRoot: root,
        platform: 'darwin',
        playlistIds: ['pl'],
        post,
        stat: fakeDisk(['/Users/b/Music/here.mp3'], [root]).stat,
    });
    assert.equal(
        empty.libraryRoot?.status === 'unavailable' && empty.libraryRoot.code,
        'nothing-found',
    );

    // A pymix without #251 sends no relativePaths: nothing to count, so the root
    // only has to exist.
    const stage1Server = await findInPlaceTracks({
        libraryRoot: root,
        platform: 'darwin',
        playlistIds: ['pl'],
        post: async () => ({ data: { locations: FROM_A.locations } }),
        stat: fakeDisk([], [root]).stat,
    });
    assert.deepEqual(stage1Server.libraryRoot, { expected: 0, found: 0, root, status: 'ok' });

    // No root set (or "Download anyway"): no status, stage 1 only.
    const noRoot = await findInPlaceTracks({
        platform: 'darwin',
        playlistIds: ['pl'],
        post,
        stat: disk.stat,
    });
    assert.equal(noRoot.libraryRoot, null);
    assert.deepEqual(
        noRoot.tracks.map((t) => t.subboxId),
        ['sid-here'],
    );

    // ── Serato sends nothing (point 9) ──────────────────────────────────
    assert.equal(
        usesTracksInPlace({
            electron: true,
            includeRekordboxXml: false,
            includeSeratoCrates: true,
        }),
        false,
    );

    console.log('check:library-root-download OK');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
