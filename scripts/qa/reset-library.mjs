import { execFileSync } from 'child_process';

import { devRequest, pymixLogin, subsonic } from './dev-http.mjs';
import { getCredentials } from '../ui-snapshot-shared.mjs';

// Wipe a local-dev test account's library back to empty, over the same server-side
// paths the app itself uses. Importable (`resetLibrary()`) and runnable on its own:
//
//   node scripts/qa/reset-library.mjs
//
// This exists because several regressions — the Serato round trip above all — are
// only meaningful from a known-empty library: "18 playlists" tells you nothing if
// 14 of them predate the run. `_reset-account.mjs` does the same job by driving the
// Electron UI, which takes minutes and is gitignored; this is the HTTP/psql
// equivalent and takes seconds.
//
// LOCAL DEV ONLY, and destructive by design: every track and every playlist the
// account owns is deleted. `devRequest` refuses any host that isn't
// *.docker.localhost, so it cannot be pointed at staging or prod.
//
// The four things it clears, in the order that keeps them consistent:
//   1. playlists   — Subsonic deletePlaylist.view (the client calls Navidrome
//                    directly for these; pymix is not involved)
//   2. tracks      — one batched pymix DELETE /track over every subbox_id the DB
//                    knows about; it removes from beets + disk first, verifies,
//                    and only then drops its own rows
//   3. orphan rows — meta_history_table and playlist_path_table, which
//                    db_controller.delete_track does not touch. playlist_path
//                    especially: a stale row leaks into the next Rekordbox export
//                    as a playlist folder nothing is in.
//   4. verify      — library_size, playlist count and `beet ls` all read back zero
//
// Env:
//   QA_RESET_USER / QA_RESET_PASSWORD  override the account (default: the
//                                      .env.ui-snapshot.local credentials)

const PYMIX_URL = process.env.QA_PYMIX_URL || 'https://pymix.docker.localhost';
const PG_CONTAINER = process.env.QA_PG_CONTAINER || 'pymix-postgres';

const log = (...a) => console.log('[reset-library]', ...a);

function psql(sql) {
    return execFileSync(
        'docker',
        ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'pymix', '-d', 'pymix', '-tAc', sql],
        { encoding: 'utf8' },
    ).trim();
}

/**
 * @returns {Promise<{beetTracks: null|number, empty: boolean, librarySizeBytes: number,
 *   emptyDirsRemoved: number, orphanRowsDeleted: number, playlistsDeleted: number,
 *   playlistsLeft: number,
 *   tracksDeleted: number, tracksFailed: string[]}>}
 */
export async function resetLibrary({ password, username } = {}) {
    const creds = getCredentials();
    const user = username || process.env.QA_RESET_USER || creds.username;
    const pass = password || process.env.QA_RESET_PASSWORD || creds.password;
    log(`resetting ${user} at ${PYMIX_URL}`);

    // Every per-track table keys off user_table.user_id (a hex string), not the
    // integer primary key — joining on `id` matches nothing and silently reports an
    // already-empty library.
    const userId = psql(`select user_id from user_table where username = '${user}'`);
    if (!userId) throw new Error(`no row in user_table for ${user}`);

    // ── 1. Playlists ──────────────────────────────────────────────────────
    const { playlists } = await subsonic(user, pass, 'getPlaylists');
    const list = playlists?.playlist ?? [];
    for (const pl of list) {
        await subsonic(user, pass, 'deletePlaylist', { id: pl.id });
    }
    log(`deleted ${list.length} playlists`);

    // ── 2. Tracks ─────────────────────────────────────────────────────────
    // Union of every table that can hold an id: an uploaded track lands in
    // subbox_beets_map_table without ever reaching library_table (that is the
    // upload path working as designed), so neither table alone is the whole library.
    const ids = psql(
        `select distinct subbox_id from (
           select subbox_id from library_table where user_id = '${userId}'
           union select subbox_id from subbox_beets_map_table where user_id = '${userId}'
           union select subbox_id from original_track_meta_map_table where user_id = '${userId}'
         ) t`,
    )
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    log(`${ids.length} subbox_ids to delete`);

    let tracksDeleted = 0;
    const tracksFailed = [];
    if (ids.length > 0) {
        const cookie = await pymixLogin(PYMIX_URL, user, pass);
        const res = await devRequest(`${PYMIX_URL}/track`, {
            body: JSON.stringify({ ids }),
            headers: { 'Content-Type': 'application/json', cookie },
            method: 'DELETE',
        });
        if (res.status !== 200) throw new Error(`DELETE /track: ${res.status} ${res.body}`);
        for (const r of res.json().results ?? []) {
            if (r.success) tracksDeleted += 1;
            else tracksFailed.push(`${r.subbox_id}: ${r.reason}`);
        }
        log(`deleted ${tracksDeleted}/${ids.length} tracks`);
        if (tracksFailed.length) log(`FAILED: ${tracksFailed.slice(0, 5).join(' | ')}`);
    }

    // ── 3. Orphan rows delete_track does not reach ────────────────────────
    const orphanRowsDeleted = ['meta_history_table', 'playlist_path_table']
        .map((table) =>
            Number(
                psql(
                    `with d as (delete from ${table} where user_id = '${userId}' returning 1)
                     select count(*) from d`,
                ),
            ),
        )
        .reduce((a, b) => a + b, 0);
    log(`cleared ${orphanRowsDeleted} orphan rows (meta_history + playlist_path)`);

    // ── 3b. Empty album/artist folders the file delete leaves behind ──────
    // `du` counts directory inodes, so one empty leftover folder is 4096 bytes of
    // "library" — enough to make an exact `library_size == 0` assert fail on an
    // account with nothing in it. -depth removes them bottom-up, so a nested pair
    // goes in one pass; only empty directories match, never a file.
    let emptyDirsRemoved = 0;
    try {
        const out = execFileSync(
            'docker',
            [
                'exec',
                // The beets container mounts /music read-write; navidrome's copy of
                // the same volume is read-only, so the delete has to go through beets.
                `beets${user}`,
                'sh',
                '-c',
                // In the beets container the per-user volume IS /music; navidrome
                // mounts the same volume one level up as /music/<user>.
                'find /music -mindepth 1 -depth -type d -empty -print -delete | wc -l',
            ],
            { encoding: 'utf8' },
        );
        emptyDirsRemoved = Number(out.trim());
    } catch {
        // Nothing to clean, or no container — the verify below is what decides.
    }
    if (emptyDirsRemoved) log(`removed ${emptyDirsRemoved} empty folders`);

    // ── 4. Verify from the outside ────────────────────────────────────────
    const cookie2 = await pymixLogin(PYMIX_URL, user, pass);
    const size = (
        await devRequest(`${PYMIX_URL}/user/library_size`, { headers: { cookie: cookie2 } })
    ).json();
    const after = await subsonic(user, pass, 'getPlaylists');
    const playlistsLeft = after.playlists?.playlist?.length ?? 0;

    let beetTracks = null;
    try {
        beetTracks = Number(
            execFileSync(
                'docker',
                ['exec', `beets${user}`, 'sh', '-c', 'beet ls 2>/dev/null | wc -l'],
                { encoding: 'utf8' },
            ).trim(),
        );
    } catch {
        // A stopped or missing beets container is worth reporting as null, not throwing.
    }

    const summary = {
        beetTracks,
        emptyDirsRemoved,
        empty: size.total_size_bytes === 0 && playlistsLeft === 0 && (beetTracks ?? 0) === 0,
        librarySizeBytes: size.total_size_bytes,
        orphanRowsDeleted,
        playlistsDeleted: list.length,
        playlistsLeft,
        tracksDeleted,
        tracksFailed,
    };
    log('after reset:', JSON.stringify(summary));
    return summary;
}

// Run directly (not when imported).
if (import.meta.url === `file://${process.argv[1]}`) {
    resetLibrary()
        .then((s) => process.exit(s.empty ? 0 : 1))
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}
