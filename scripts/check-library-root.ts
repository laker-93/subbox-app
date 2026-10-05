import { AxiosError, AxiosHeaders } from 'axios';
import assert from 'node:assert/strict';

import {
    backfillEntries,
    checkLibraryRoot,
    rootRelative,
    withRootRelativePath,
} from '../src/main/features/core/sync/library-root';
import { backfillLibraryRoot } from '../src/main/features/core/sync/library-root-backfill';
import {
    matchedTrackLocations,
    RECORD_LOCATIONS_CHUNK,
    TrackLocationToRecord,
} from '../src/main/features/core/sync/record-locations';

// The per-device library root (#214 stage 2, #219): the one rule that turns a file
// path into its path under the root (pymix stores the result as given and does no
// path work), the root check, and the backfill that fills it in for tracks uploaded
// before the root was set.
//
// Usage: pnpm run check:library-root

function axios404(): AxiosError {
    const headers = new AxiosHeaders();
    return new AxiosError('Not Found', 'ERR_BAD_REQUEST', { headers }, null, {
        config: { headers },
        data: { detail: 'Not Found' },
        headers: {},
        status: 404,
        statusText: 'Not Found',
    });
}

async function main(): Promise<void> {
    // ── rootRelative, POSIX ──────────────────────────────────────────────
    const mac = (root: string, file: string) => rootRelative(root, file, 'darwin');
    assert.equal(mac('/Users/dj/Music', '/Users/dj/Music/House/a b.mp3'), 'House/a b.mp3');
    // A trailing separator on the root changes nothing.
    assert.equal(mac('/Users/dj/Music/', '/Users/dj/Music/House/a.mp3'), 'House/a.mp3');
    // The separator boundary: /Music2 is not under /Music.
    assert.equal(mac('/Volumes/X/Music', '/Volumes/X/Music2/a.mp3'), null);
    assert.equal(mac('/Users/dj/Music', '/Users/dj/Other/a.mp3'), null);
    // The root itself is not a track under it.
    assert.equal(mac('/Users/dj/Music', '/Users/dj/Music'), null);
    // A name that merely starts with ".." is still under the root.
    assert.equal(mac('/Music', '/Music/..hidden/a.mp3'), '..hidden/a.mp3');
    // POSIX is case-sensitive, and the file's own case is kept.
    assert.equal(mac('/Users/dj/music', '/Users/dj/Music/a.mp3'), null);
    assert.equal(mac('/Users/dj/Music', '/Users/dj/Music/MiXeD/A.mp3'), 'MiXeD/A.mp3');
    // NFD (as macOS lists it) against an NFC root, and the other way round: the
    // result is NFC either way.
    const nfcRoot = '/Users/dj/Café';
    const nfdFile = '/Users/dj/Cafe\u0301/Bjo\u0308rk.mp3';
    assert.equal(mac(nfcRoot, nfdFile), 'Björk.mp3'.normalize('NFC'));
    assert.equal(mac(nfcRoot.normalize('NFD'), '/Users/dj/Café/a.mp3'), 'a.mp3');
    // A Windows path is never under a macOS root.
    assert.equal(mac('/Users/dj/Music', 'C:\\Users\\dj\\Music\\a.mp3'), null);

    // ── rootRelative, Windows ────────────────────────────────────────────
    const win = (root: string, file: string) => rootRelative(root, file, 'win32');
    assert.equal(
        win('C:\\Users\\DJ\\OneDrive', 'C:\\Users\\DJ\\OneDrive\\House\\a.mp3'),
        'House/a.mp3',
    );
    // Mixed case on the root's part is the same folder; the file's own case is kept.
    assert.equal(
        win('c:\\users\\dj\\onedrive', 'C:\\Users\\DJ\\OneDrive\\House\\A.mp3'),
        'House/A.mp3',
    );
    // Mixed separators.
    assert.equal(
        win('C:/Users/DJ/OneDrive/', 'C:\\Users\\DJ\\OneDrive/House\\a.mp3'),
        'House/a.mp3',
    );
    // A drive root.
    assert.equal(win('D:\\', 'D:\\Music\\a.mp3'), 'Music/a.mp3');
    // Another drive, the boundary, outside.
    assert.equal(win('C:\\Music', 'D:\\Music\\a.mp3'), null);
    assert.equal(win('C:\\Music', 'C:\\Music2\\a.mp3'), null);
    assert.equal(win('C:\\Music', 'C:\\Other\\a.mp3'), null);
    // A UNC share.
    assert.equal(win('\\\\nas\\music', '\\\\nas\\music\\House\\a.mp3'), 'House/a.mp3');
    // A macOS path is never under a Windows root, even a drive root: on Windows it
    // would resolve onto the current drive.
    assert.equal(win('C:\\', '/Users/dj/Music/a.mp3'), null);

    // ── the root check ───────────────────────────────────────────────────
    const dirs = new Set(['/Users/dj/Music', 'C:\\Music']);
    const files = new Set(['/Users/dj/a.mp3']);
    const stat = async (p: string) => {
        if (dirs.has(p)) return { isDirectory: () => true };
        if (files.has(p)) return { isDirectory: () => false };
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    };
    assert.deepEqual(await checkLibraryRoot('/Users/dj/Music', { platform: 'darwin', stat }), {
        ok: true,
    });
    assert.deepEqual(await checkLibraryRoot('C:\\Music', { platform: 'win32', stat }), {
        ok: true,
    });
    for (const [dir, platform] of [
        ['', 'darwin'],
        ['Music', 'darwin'],
        ['/Users/dj/a.mp3', 'darwin'],
        ['/Volumes/Unplugged', 'darwin'],
        ['/Users/dj/Music', 'win32'],
        ['\\Music', 'win32'],
    ] as const) {
        assert.equal(
            (await checkLibraryRoot(dir, { platform, stat })).ok,
            false,
            `${platform} ${dir}`,
        );
    }

    // ── what the uploads send ────────────────────────────────────────────
    const root = process.platform === 'win32' ? 'C:\\Music' : '/Music';
    const under = process.platform === 'win32' ? 'C:\\Music\\House\\a.mp3' : '/Music/House/a.mp3';
    const outside = process.platform === 'win32' ? 'D:\\Other\\b.mp3' : '/Other/b.mp3';
    // map_meta (Rekordbox upload and Serato import).
    assert.deepEqual(withRootRelativePath(root, under), { rootRelativePath: 'House/a.mp3' });
    assert.deepEqual(withRootRelativePath(root, outside), {});
    assert.deepEqual(withRootRelativePath(null, under), {});
    // /tracks/locations/record for matched tracks (#216).
    const sent = [{ userLocation: under }, { userLocation: outside }];
    const matched = [
        { matched: true, subboxId: 'sid-a' },
        { matched: true, subboxId: 'sid-b' },
    ];
    assert.deepEqual(
        matchedTrackLocations(sent, matched, () => true, root),
        [
            { root_relative_path: 'House/a.mp3', subbox_id: 'sid-a', user_location: under },
            { subbox_id: 'sid-b', user_location: outside },
        ],
    );
    // No root: as before.
    assert.deepEqual(
        matchedTrackLocations(sent, matched, () => true),
        [
            { subbox_id: 'sid-a', user_location: under },
            { subbox_id: 'sid-b', user_location: outside },
        ],
    );

    // ── the backfill ─────────────────────────────────────────────────────
    assert.deepEqual(
        backfillEntries(
            '/Music',
            { 'sid-a': '/Music/a.mp3', 'sid-b': '/Other/b.mp3', 'sid-c': 'C:\\c.mp3' },
            'darwin',
        ),
        [{ root_relative_path: 'a.mp3', subbox_id: 'sid-a', user_location: '/Music/a.mp3' }],
    );

    // Only tracks under the root are sent, chunked at pymix's cap.
    const many: Record<string, string> = {};
    for (let i = 0; i < RECORD_LOCATIONS_CHUNK + 5; i++) many[`sid-${i}`] = `/Music/${i}.mp3`;
    many['sid-outside'] = '/Other/x.mp3';
    const chunks: TrackLocationToRecord[][] = [];
    const result = await backfillLibraryRoot({
        platform: 'darwin',
        playlistIds: ['pl-1', 'pl-2'],
        postLocations: async (ids) => {
            assert.deepEqual(ids, ['pl-1', 'pl-2']);
            return { data: { locations: many } };
        },
        postRecord: async (chunk) => {
            chunks.push(chunk);
            return { data: { recorded: chunk.map((e) => e.subbox_id) } };
        },
        root: '/Music',
    });
    assert.deepEqual(result, {
        recorded: RECORD_LOCATIONS_CHUNK + 5,
        underRoot: RECORD_LOCATIONS_CHUNK + 5,
    });
    assert.deepEqual(
        chunks.map((c) => c.length),
        [RECORD_LOCATIONS_CHUNK, 5],
    );
    assert.ok(chunks.flat().every((e) => e.root_relative_path && e.subbox_id !== 'sid-outside'));

    // An old pymix (no /tracks/locations): skipped, nothing recorded, null.
    let recordCalls = 0;
    assert.equal(
        await backfillLibraryRoot({
            platform: 'darwin',
            playlistIds: ['pl-1'],
            postLocations: async () => Promise.reject(axios404()),
            postRecord: async () => {
                recordCalls++;
                return { data: {} };
            },
            root: '/Music',
        }),
        null,
    );
    assert.equal(recordCalls, 0);

    console.log('check:library-root OK');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
