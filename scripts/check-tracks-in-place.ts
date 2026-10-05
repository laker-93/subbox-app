import { AxiosError, AxiosHeaders } from 'axios';
import assert from 'node:assert/strict';

import {
    fetchTrackLocations,
    findInPlaceTracks,
    isPlatformAbsolute,
    resolveInPlace,
} from '../src/main/features/core/sync/in-place';
import { usesTracksInPlace } from '../src/renderer/features/sync/components/shared/tracks-in-place';

// A Rekordbox download uses the tracks still where the user uploaded them from
// (#214 stage 1, #217): pymix sends each track's upload path, the client stats it,
// and reports the ones it finds as local tracks. These check each part of that.
//
// Usage: pnpm run check:tracks-in-place

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

const fileStat = { isFile: () => true };
const dirStat = { isFile: () => false };

/** A fake disk: a stat that answers from `files`/`dirs`, records what it was asked,
 *  and fails with EACCES for `unreadable`. */
function fakeDisk(files: string[], dirs: string[] = [], unreadable: string[] = []) {
    const asked: string[] = [];
    const stat = async (p: string) => {
        asked.push(p);
        if (unreadable.includes(p)) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        if (files.includes(p)) return fileStat;
        if (dirs.includes(p)) return dirStat;
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    };
    return { asked, stat };
}

async function main(): Promise<void> {
    // Platform form (point 8): only a path absolute in this OS's own form is stat'd.
    for (const p of [
        'C:\\Music\\a.mp3',
        'c:/Music/a.mp3',
        '\\\\nas\\share\\a.mp3',
        '//nas/share/a.mp3',
    ]) {
        assert.equal(isPlatformAbsolute(p, 'win32'), true, p);
        assert.equal(isPlatformAbsolute(p, 'darwin'), p.startsWith('//'), p);
    }
    // On Windows these land on the current drive; on macOS the first is a real path.
    for (const p of ['/Users/dj/a.mp3', '\\Music\\a.mp3', 'Music\\a.mp3', 'C:a.mp3']) {
        assert.equal(isPlatformAbsolute(p, 'win32'), false, p);
    }
    assert.equal(isPlatformAbsolute('/Users/dj/a.mp3', 'darwin'), true);
    assert.equal(isPlatformAbsolute('/home/dj/a.mp3', 'linux'), true);
    assert.equal(isPlatformAbsolute('Music/a.mp3', 'darwin'), false);

    // Stat: found, not found, a directory, an error; a foreign path is never asked.
    const disk = fakeDisk(
        ['/Music/found.mp3', '/Music/second.mp3'],
        ['/Music/dir.mp3'],
        ['/Music/locked.mp3'],
    );
    const found = await resolveInPlace(
        new Map([
            ['sid-dir', ['/Music/dir.mp3']],
            ['sid-error', ['/Music/locked.mp3']],
            ['sid-found', ['/Music/found.mp3']],
            ['sid-missing', ['/Music/gone.mp3']],
            // Candidates in order: the first that stats wins (stage 2 adds more).
            ['sid-second', ['/Music/gone-too.mp3', '/Music/second.mp3']],
            ['sid-windows', ['C:\\Music\\found.mp3']],
        ]),
        { platform: 'darwin', stat: disk.stat },
    );
    assert.deepEqual(Object.fromEntries(found), {
        'sid-found': '/Music/found.mp3',
        'sid-second': '/Music/second.mp3',
    });
    assert.ok(!disk.asked.includes('C:\\Music\\found.mp3'));

    // The same on Windows, where a macOS path is the foreign one.
    const winDisk = fakeDisk(['C:\\Users\\DJ\\OneDrive\\a b.mp3']);
    const winFound = await findInPlaceTracks({
        platform: 'win32',
        playlistIds: ['pl-1'],
        post: async () => ({
            data: {
                locations: {
                    'sid-mac': '/Users/dj/a b.mp3',
                    'sid-win': 'C:\\Users\\DJ\\OneDrive\\a b.mp3',
                },
            },
        }),
        stat: winDisk.stat,
    });
    assert.deepEqual(winFound, [
        {
            artist: '',
            fromTag: true,
            subboxId: 'sid-win',
            title: 'a b',
            userLocation: 'C:\\Users\\DJ\\OneDrive\\a b.mp3',
        },
    ]);
    assert.deepEqual(winDisk.asked, ['C:\\Users\\DJ\\OneDrive\\a b.mp3']);

    // Many tracks: every one is checked, with bounded concurrency.
    let inFlight = 0;
    let peak = 0;
    const many = new Map(Array.from({ length: 500 }, (_, i) => [`sid-${i}`, [`/Music/${i}.mp3`]]));
    const manyFound = await resolveInPlace(many, {
        platform: 'darwin',
        stat: async () => {
            peak = Math.max(peak, ++inFlight);
            await new Promise((r) => setTimeout(r, 1));
            inFlight--;
            return fileStat;
        },
    });
    assert.equal(manyFound.size, 500);
    assert.ok(peak <= 32, `peak concurrency ${peak}`);

    // A pymix without /tracks/locations: null, so nothing is sent as in place.
    assert.equal(
        await fetchTrackLocations({
            playlistIds: ['pl-1'],
            post: async () => Promise.reject(axios404()),
        }),
        null,
    );
    const statAfter404 = fakeDisk([]);
    assert.deepEqual(
        await findInPlaceTracks({
            playlistIds: ['pl-1'],
            post: async () => Promise.reject(axios404()),
            stat: statAfter404.stat,
        }),
        [],
    );
    assert.equal(statAfter404.asked.length, 0);
    // Any other failure is the same.
    assert.equal(
        await fetchTrackLocations({
            playlistIds: ['pl-1'],
            post: async () => Promise.reject(new Error('ECONNRESET')),
        }),
        null,
    );

    // Format (point 9): only a desktop Rekordbox download that writes no crates.
    assert.equal(
        usesTracksInPlace({
            electron: true,
            includeRekordboxXml: true,
            includeSeratoCrates: false,
        }),
        true,
    );
    assert.equal(
        usesTracksInPlace({
            electron: true,
            includeRekordboxXml: false,
            includeSeratoCrates: true,
        }),
        false,
    );
    // Rekordbox with "also write Serato crates": the crates need every track.
    assert.equal(
        usesTracksInPlace({ electron: true, includeRekordboxXml: true, includeSeratoCrates: true }),
        false,
    );
    assert.equal(
        usesTracksInPlace({
            electron: false,
            includeRekordboxXml: true,
            includeSeratoCrates: false,
        }),
        false,
    );

    console.log('check:tracks-in-place OK');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
