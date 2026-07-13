import { _electron as electron } from 'playwright';

import {
    getCredentials,
    isLoggedOut,
    performLogin,
    resolveAppEntry,
} from '../ui-snapshot-shared.mjs';

// Fixture builder for the pymix sync_plan duplicate-subbox_id fix (change A).
//
// Creates (or rebuilds) a Subsonic playlist that lists the SAME song more than
// once. When pymix reads it back for sync_plan, each occurrence becomes its own
// server-track sharing one subbox_id — the exact shape that used to make every
// occurrence past the first report as falsely "missing". The single local copy of
// that song must satisfy all occurrences.
//
// Navidrome allows duplicate entries in a playlist; we add the chosen song
// `QA_DUP_COUNT` times (default 3).
//
// Env:
//   QA_APP_ENTRY     out/main/index.js to launch
//   QA_DUP_NAME      playlist name to create (default "QA Dup Test")
//   QA_DUP_COUNT     how many times to add the song (default 3)
//   QA_SONG_ID       Subsonic song id to duplicate. If unset, the first song of
//                    QA_SOURCE_PLAYLIST is used.
//   QA_SOURCE_PLAYLIST  playlist to borrow the first song from (default "Kodzo")
//
// IMPORTANT: pick a song whose file is ALREADY in the dev local library and
// SUBBOX_ID-tagged, so the classification test can prove one local file satisfies
// all N occurrences. The default (Kodzo's first track) is such a track if Kodzo
// has been downloaded locally.
//
// Prints the created playlist's name + id and its final song list. Cleanup:
// delete it afterwards (deletePlaylist.view) or leave it for repeat runs.
//
// Usage:
//   cd ../feishin-qa
//   QA_APP_ENTRY=../feishin/out/main/index.js node scripts/qa/make-dup-playlist.mjs

const MAIN_ENTRY = resolveAppEntry();
const credentials = getCredentials();
const DUP_NAME = process.env.QA_DUP_NAME || 'QA Dup Test';
const DUP_COUNT = Number(process.env.QA_DUP_COUNT) || 3;
const SOURCE_PLAYLIST = process.env.QA_SOURCE_PLAYLIST || 'Kodzo';

async function main() {
    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(1000);

    const server = await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('store_authentication')).state.currentServer;
        return { credential: s.credential, url: s.url, username: s.username };
    });

    const result = await page.evaluate(
        async ({ credential, dupCount, dupName, songIdEnv, sourcePlaylist, url }) => {
            const base = (view, params) =>
                `${url}/rest/${view}?${credential}&v=1.16.1&c=subbox&f=json${params ? '&' + params : ''}`;
            const call = async (view, params) => {
                const res = await fetch(base(view, params));
                return res.json();
            };

            // Resolve the song id to duplicate.
            let songId = songIdEnv;
            let songLabel = songIdEnv;
            if (!songId) {
                const pls = await call('getPlaylists.view');
                const src = (pls['subsonic-response']?.playlists?.playlist ?? []).find(
                    (p) => p.name === sourcePlaylist,
                );
                if (!src) return { error: `source playlist "${sourcePlaylist}" not found` };
                const full = await call('getPlaylist.view', `id=${encodeURIComponent(src.id)}`);
                const entries = full['subsonic-response']?.playlist?.entry ?? [];
                if (!entries.length)
                    return { error: `source playlist "${sourcePlaylist}" is empty` };
                songId = entries[0].id;
                songLabel = `${entries[0].artist} — ${entries[0].title}`;
            }

            // Remove any prior playlist of this name so runs are idempotent.
            const existing = await call('getPlaylists.view');
            for (const p of existing['subsonic-response']?.playlists?.playlist ?? []) {
                if (p.name === dupName) {
                    await call('deletePlaylist.view', `id=${encodeURIComponent(p.id)}`);
                }
            }

            // Create the playlist with the first occurrence.
            const created = await call(
                'createPlaylist.view',
                `name=${encodeURIComponent(dupName)}&songId=${encodeURIComponent(songId)}`,
            );
            let newId = created['subsonic-response']?.playlist?.id;
            if (!newId) {
                // Some servers don't echo the playlist; look it up by name.
                const after = await call('getPlaylists.view');
                newId = (after['subsonic-response']?.playlists?.playlist ?? []).find(
                    (p) => p.name === dupName,
                )?.id;
            }
            if (!newId) return { error: 'could not determine created playlist id' };

            // Add the SAME song (dupCount - 1) more times.
            for (let i = 1; i < dupCount; i++) {
                await call(
                    'updatePlaylist.view',
                    `playlistId=${encodeURIComponent(newId)}&songIdToAdd=${encodeURIComponent(songId)}`,
                );
            }

            const final = await call('getPlaylist.view', `id=${encodeURIComponent(newId)}`);
            const entries = final['subsonic-response']?.playlist?.entry ?? [];
            return {
                entryCount: entries.length,
                ids: entries.map((e) => e.id),
                name: dupName,
                playlistId: newId,
                songId,
                songLabel,
            };
        },
        {
            credential: server.credential,
            dupCount: DUP_COUNT,
            dupName: DUP_NAME,
            songIdEnv: process.env.QA_SONG_ID || '',
            sourcePlaylist: SOURCE_PLAYLIST,
            url: server.url,
        },
    );

    await electronApp.close();

    if (result.error) {
        console.error('FAILED:', result.error);
        process.exit(1);
    }

    const allSame = result.ids.every((id) => id === result.songId);
    console.log('=== duplicate playlist created ===');
    console.log(`  name:       ${result.name}`);
    console.log(`  id:         ${result.playlistId}`);
    console.log(`  song:       ${result.songLabel} (${result.songId})`);
    console.log(`  entries:    ${result.entryCount} (requested ${DUP_COUNT})`);
    console.log(`  all same:   ${allSame}`);
    console.log('');
    console.log(
        allSame && result.entryCount === DUP_COUNT
            ? `OK — now run: QA_PLAYLIST="${result.name}" QA_EXPECT_MISSING=0 QA_EXPECT_PRESENT=${DUP_COUNT} node scripts/qa/sync-plan-classification.mjs`
            : 'WARNING: playlist did not end up with the expected duplicate entries — inspect above.',
    );
    process.exit(allSame && result.entryCount === DUP_COUNT ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
