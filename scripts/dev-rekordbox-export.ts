import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { extractPlaylists } from '../src/main/features/core/sync/rekordbox-xml';

// The Rekordbox download, end to end against a running dev stack: download the
// tracks, export the XML with the same user_root the client sends, and assert
// that every Location names a file the download actually produced.
//
// That last assertion is the point, and nothing else had it. The Serato export
// gets it for free -- `relative_path` is computed from the same music root
// _write_export_zip names its entries from, so the two cannot drift -- but the
// Rekordbox XML derives its Locations independently, in
// RekordboxXMLOrchestrator._resolve_track_location, from a `track.path` whose
// shape depends on the Navidrome layout and on `music_path_base_to_remove`. A
// wrong answer there is silent: the XML parses, the playlist tree is intact, and
// not one track resolves. It is only visible by checking the paths against the
// files, per track, which is what this does.
//
// The XML is read back through the client's own `extractPlaylists` rather than a
// regex, so a passing run also says our export is readable by our importer.
//
// Dev only -- it downloads a real library from a live per-user container. It
// writes nothing back, so unlike the Serato drivers it is read-only on the stack.
//
//   pnpm dev:rekordbox-export
//   PLAYLISTS="Ambient,Techno" pnpm dev:rekordbox-export

const PYMIX = process.env.PYMIX_URL ?? 'http://localhost:8002';
const SUBSONIC = process.env.SUBSONIC_URL ?? 'http://localhost:41831';
const USERNAME = process.env.SUBBOX_USER ?? 'test060826';
const PASSWORD = process.env.SUBBOX_PASSWORD ?? 'Testpass12345!';

/** Which playlists to export. Unset means the first four the user has. */
const PLAYLISTS = (process.env.PLAYLISTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Named to match sync-download.tsx's ZIP_MUSIC_DIR, which is the same contract. */
const ZIP_MUSIC_DIR = 'music';

let cookie = '';

async function download(filename: string): Promise<Buffer> {
    const res = await fetch(`${PYMIX}/sync/download/${encodeURIComponent(filename)}`, {
        headers: { Cookie: cookie },
    });
    if (!res.ok) throw new Error(`download ${filename} -> ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

async function main(): Promise<void> {
    console.log(`Rekordbox export against ${PYMIX} as ${USERNAME}\n`);
    const workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rb-export-')));

    await pymix('/user/login', { password: PASSWORD, username: USERNAME });
    console.log('  logged in');

    const all = await subsonicPlaylists();
    const wanted =
        PLAYLISTS.length > 0 ? all.filter((p) => PLAYLISTS.includes(p.name)) : all.slice(0, 4);
    assert.equal(
        wanted.length,
        PLAYLISTS.length > 0 ? PLAYLISTS.length : wanted.length,
        `wanted ${PLAYLISTS.join(', ')}; found ${wanted.map((p) => p.name).join(', ')}`,
    );
    assert.ok(wanted.length > 0, 'the user has no playlists to export');
    console.log(`  ${wanted.length} playlists: ${wanted.map((p) => p.name).join(', ')}\n`);

    // ── 1. the download, exactly as the client does it ──────────────────────
    // The zip nests everything under music/, so extracting into workDir puts the
    // tracks at workDir/music/... -- and user_root is that folder, not workDir.
    const musicRoot = path.join(workDir, ZIP_MUSIC_DIR);
    const plan = await pymix<{
        downloadFilename: null | string;
        nTracksExported: number;
        reason: string;
        success: boolean;
    }>('/sync/playlists', {
        direction: 'download',
        includeRekordboxXml: false,
        includeTracks: true,
        // Empty: this is a clean machine, so every track in the selection is missing.
        localTracks: [],
        options: { fuzzyMatch: true, includeMetadata: true },
        playlists: wanted.map((p) => ({ id: p.id, source: 'subbox' })),
        user_root: musicRoot,
    });
    assert.ok(plan.success, `sync/playlists failed: ${plan.reason}`);
    assert.ok(plan.downloadFilename, 'pymix returned no file to download');

    const zipPath = path.join(workDir, 'music.zip');
    fs.writeFileSync(zipPath, await download(plan.downloadFilename));
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', workDir]);
    fs.rmSync(zipPath);

    const filesOnDisk = fs
        .readdirSync(musicRoot, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile()).length;
    console.log(`  pymix zipped ${plan.nTracksExported} tracks; ${filesOnDisk} files extracted`);
    // Not an assertion: the zip carries a track once per playlist it is in
    // (pymix#139), so nTracksExported legitimately exceeds the file count today.
    if (plan.nTracksExported !== filesOnDisk) {
        console.log(
            `  note: ${plan.nTracksExported - filesOnDisk} duplicate entries in the zip (pymix#139)`,
        );
    }

    // ── 2. the XML, against that same user_root ─────────────────────────────
    const exported = await pymix<{ reason: string; success: boolean }>('/rekordbox/export', {
        playlistIds: wanted.map((p) => p.id),
        user_root: musicRoot,
    });
    assert.ok(exported.success, `rekordbox/export failed: ${exported.reason}`);

    const xmlPath = path.join(workDir, 'subbox_rb_export.xml');
    fs.writeFileSync(xmlPath, await download('subbox_rb_export.xml'));
    const { playlists, tracks } = extractPlaylists(xmlPath);
    console.log(`  XML: ${playlists.length} playlists, ${tracks.length} tracks\n`);

    // ── 3. every Location must name a file the download produced ────────────
    assert.ok(tracks.length > 0, 'the exported XML contained no tracks');
    const missing = tracks.filter((t) => !fs.existsSync(t.location));

    for (const track of missing.slice(0, 5)) {
        console.log(`  MISSING  ${track.location}`);
    }
    assert.equal(
        missing.length,
        0,
        `${missing.length}/${tracks.length} XML Locations do not exist on disk. ` +
            `First: ${missing[0]?.location}`,
    );
    console.log(`  all ${tracks.length} Locations resolve to a downloaded file`);

    // Each Location must sit under user_root too. A path that escapes it resolves
    // only by accident -- e.g. one that kept a server-side root and happens to
    // exist here -- and would be wrong on any other machine.
    const escaping = tracks.filter(
        (t) => !path.resolve(t.location).startsWith(musicRoot + path.sep),
    );
    assert.equal(
        escaping.length,
        0,
        `${escaping.length} Locations resolve outside user_root. First: ${escaping[0]?.location}`,
    );
    console.log(`  all ${tracks.length} Locations sit under user_root`);

    // The playlists have to survive too -- Locations can all be right while the
    // tree they hang off is empty.
    const named = new Set(wanted.map((p) => p.name));
    const exportedNames = playlists.map((p) => p.name);
    for (const name of named) {
        assert.ok(exportedNames.includes(name), `playlist ${name} missing from the XML`);
    }
    console.log(
        `  all ${named.size} playlists present, ${playlists.map((p) => p.trackCount).reduce((a, b) => a + b, 0)} entries\n`,
    );

    console.log(`Workspace kept for inspection:\n  ${workDir}`);
    console.log('\nRekordbox export passed.');
}

async function pymix<T>(pathname: string, body: unknown): Promise<T> {
    const res = await fetch(`${PYMIX}${pathname}`, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        method: 'POST',
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${text}`);
    return (text ? JSON.parse(text) : {}) as T;
}

async function subsonicPlaylists(): Promise<Array<{ id: string; name: string }>> {
    const url =
        `${SUBSONIC}/rest/getPlaylists?u=${encodeURIComponent(USERNAME)}` +
        `&p=${encodeURIComponent(PASSWORD)}&v=1.16.1&c=rekordbox-export&f=json`;
    const body = (await (await fetch(url)).json()) as any;
    return body['subsonic-response']?.playlists?.playlist ?? [];
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
