import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    CrateToWrite,
    nodeKey,
    readCrateTree,
    readTrackCues,
    readTrackGrid,
    SeratoBeatgridWire,
    SeratoCueWire,
    writeCrates,
    writeTrackCues,
    writeTrackGrid,
} from '../src/main/features/core/sync/serato-crates';

// Rung 5 of the Serato harness, minus the Electron shell: drive the whole export
// against a running dev stack and assert on what lands on disk.
//
// `pnpm check:serato-crates` proves the crate writer is correct in isolation. It
// cannot prove the two halves agree — that `relative_path` really is where the
// download puts a track, that the crate tree pymix returns really is the one the
// user's playlists have, that the cues in `meta_history` really do decode. Those
// need a stack, and this is the cheapest way to get at them: the same functions
// the main process calls, over the same HTTP the renderer uses, without a window.
//
// Dev only. An import writes into a live per-user container.
//
//   pnpm dev:serato-roundtrip
//   PLAYLISTS="Techno,Subbox Demo / Closers" pnpm dev:serato-roundtrip

const PYMIX = process.env.PYMIX_URL ?? 'http://localhost:8002';
const SUBSONIC = process.env.SUBSONIC_URL ?? 'http://localhost:41831';
const USERNAME = process.env.SUBBOX_USER ?? 'test060826';
const PASSWORD = process.env.SUBBOX_PASSWORD ?? 'Testpass12345!';

/** Which playlists to round-trip. Nested ones are the point — keep at least one. */
const PLAYLISTS = (
    process.env.PLAYLISTS ??
    'Subbox Demo / Closers,Subbox Demo / Peak Time,QA MetaOnly / MetaOnly Doc Check,Techno'
)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

type ExportCrate = { display_name: string; path_components: string[]; tracks: ExportTrack[] };
type ExportTrack = {
    album: string;
    artist: string;
    // pymix derives Serato's whole-beat spacing server-side (beatgrid.to_serato_anchors),
    // so what arrives is already Serato-shaped and the client only maps fields.
    beatgrid: SeratoBeatgridWire[];
    // What the conversion could not carry -- a dropped Metro, a non-downbeat
    // Battito, a beat span rounded to a whole number. Surfaced, never silent.
    beatgrid_notes: string[];
    cues: SeratoCueWire[];
    rating: number;
    relative_path: string;
    subbox_id: null | string;
    title: string;
};

let cookie = '';

function countFiles(dir: string): number {
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
        .length;
}

/** Fetch the tracks for these playlists and extract them the way the client does. */
async function downloadTracks(workDir: string, playlistIds: string[]): Promise<string> {
    const musicRoot = path.join(workDir, 'music');
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
        playlists: playlistIds.map((id) => ({ id, source: 'subbox' })),
        user_root: musicRoot,
    });
    assert.ok(plan.success, `sync/playlists failed: ${plan.reason}`);
    assert.ok(plan.downloadFilename, 'pymix returned no file to download');
    console.log(`  pymix zipped ${plan.nTracksExported} tracks as ${plan.downloadFilename}`);

    const res = await fetch(`${PYMIX}/sync/download/${encodeURIComponent(plan.downloadFilename)}`, {
        headers: { Connection: 'close', Cookie: cookie },
    });
    assert.ok(res.ok, `download -> ${res.status}`);
    const zipPath = path.join(workDir, 'music.zip');
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));

    // The zip nests everything under music/, so extracting into workDir puts the
    // tracks exactly where `relative_path` says they are.
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', workDir]);
    fs.rmSync(zipPath);
    return musicRoot;
}

async function main(): Promise<void> {
    console.log(`Serato round trip against ${PYMIX} as ${USERNAME}\n`);
    const workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'serato-e2e-')));
    const seratoFolder = path.join(workDir, '_Serato_');
    fs.mkdirSync(path.join(seratoFolder, 'SubCrates'), { recursive: true });

    await pymix('/user/login', { password: PASSWORD, username: USERNAME });
    console.log('  logged in');

    const all = await subsonicPlaylists();
    const wanted = all.filter((p) => PLAYLISTS.includes(p.name));
    assert.equal(
        wanted.length,
        PLAYLISTS.length,
        `wanted ${PLAYLISTS.join(', ')}; found ${wanted.map((p) => p.name).join(', ')}`,
    );
    console.log(`  ${wanted.length} playlists selected\n`);

    // ── 1. the structure ────────────────────────────────────────────────────
    const structure = await pymix<{ crates: ExportCrate[]; n_tracks: number; success: boolean }>(
        '/serato/export',
        { playlistIds: wanted.map((p) => p.id) },
    );
    assert.ok(structure.success);
    const crates = structure.crates.filter((c) => PLAYLISTS.includes(c.display_name));
    assert.equal(
        crates.length,
        wanted.length,
        'every requested playlist should come back as a crate',
    );
    for (const crate of crates) {
        const cues = crate.tracks.reduce((n, t) => n + t.cues.length, 0);
        const gridded = crate.tracks.filter((t) => (t.beatgrid ?? []).length > 0).length;
        const anchors = crate.tracks.reduce((n, t) => n + (t.beatgrid ?? []).length, 0);
        console.log(
            `  ${crate.display_name}: ${crate.tracks.length} tracks, ${cues} cues, ` +
                `${gridded} gridded (${anchors} anchors), depth ${crate.path_components.length}`,
        );
        for (const t of crate.tracks) {
            for (const note of t.beatgrid_notes ?? []) {
                console.log(`      note (${t.relative_path}): ${note}`);
            }
        }
    }
    // A field ts-rest would not have caught: it does not validate responses, so a
    // server that stopped sending `beatgrid` reads as `undefined` rather than
    // throwing, and every grid assertion below would vacuously pass.
    assert.ok(
        crates.every((c) => c.tracks.every((t) => Array.isArray(t.beatgrid))),
        'every exported track must carry a beatgrid array (absent === server half missing)',
    );
    assert.ok(
        crates.some((c) => c.path_components.length > 1),
        'at least one nested crate, or the tree is not being tested',
    );

    // ── 2. the tracks ───────────────────────────────────────────────────────
    console.log('\nDownloading');
    const musicRoot = await downloadTracks(
        workDir,
        wanted.map((p) => p.id),
    );
    console.log(`  extracted ${countFiles(musicRoot)} files under ${musicRoot}`);

    // The contract that only a stack can check: relative_path is where the
    // download actually put the file.
    const missing = crates
        .flatMap((c) => c.tracks)
        .filter((t) => !fs.existsSync(path.join(musicRoot, t.relative_path)));
    assert.deepEqual(
        missing.map((t) => t.relative_path),
        [],
        'every relative_path must resolve to a file the download produced',
    );
    console.log('  every relative_path resolves to a downloaded file — OK');

    // ── 3. write the crates ─────────────────────────────────────────────────
    console.log('\nWriting crates');
    const toWrite: CrateToWrite[] = crates.map((c) => ({
        pathComponents: c.path_components,
        tracks: c.tracks.map((t) => ({
            cues: t.cues,
            localPath: path.join(musicRoot, t.relative_path),
        })),
    }));
    const written = writeCrates(seratoFolder, toWrite);
    console.log(
        `  ${written.cratesWritten} crates, ${written.tracksWritten} tracks, ` +
            `${written.missing.length} missing, ${written.renamed.length} renamed`,
    );
    assert.deepEqual(written.missing, [], 'nothing should be missing on a fresh download');

    // Read back through the parse the *import* uses, so the round trip is the test.
    const parsed = new Map(readCrateTree(seratoFolder).map((n) => [nodeKey(n.components), n]));
    for (const crate of crates) {
        const key = crate.path_components.join(' / ');
        const node = parsed.get(key);
        assert.ok(node, `crate ${key} should parse back out`);
        assert.deepEqual(
            node.tracks,
            crate.tracks.map((t) => path.join(musicRoot, t.relative_path)),
            `crate ${key} should hold exactly the tracks pymix listed, in order`,
        );
    }
    console.log(`  ${parsed.size} crates parse back with the same tracks, in order — OK`);

    // ── 4. write the cues ───────────────────────────────────────────────────
    console.log('\nWriting cues');
    const cueTargets = new Map<string, SeratoCueWire[]>();
    for (const crate of crates) {
        for (const t of crate.tracks) {
            if (t.cues.length > 0) {
                cueTargets.set(path.join(musicRoot, t.relative_path), t.cues);
            }
        }
    }
    const cueResult = writeTrackCues(
        Array.from(cueTargets, ([localPath, cues]) => ({ cues, localPath })),
    );
    console.log(
        `  ${cueResult.written} written, ${cueResult.alreadyCued} already cued, ` +
            `${cueResult.unsupported} unsupported, ${cueResult.failed.length} failed`,
    );
    for (const f of cueResult.failed) console.log(`    FAILED ${f.trackName}: ${f.reason}`);
    assert.equal(cueResult.failed.length, 0, 'no cue write should fail');

    // Read them back off the files, which is what Serato will do.
    let checked = 0;
    for (const [localPath, expected] of cueTargets) {
        if (path.extname(localPath).toLowerCase() !== '.mp3') continue;
        const back = readTrackCues(localPath);
        assert.ok(back, `cues should read back from ${path.basename(localPath)}`);
        assert.deepEqual(
            back.map((c) => [c.type, c.start_ms, c.end_ms ?? null, c.name]).sort(),
            expected.map((c) => [c.type, c.start_ms, c.end_ms ?? null, c.name]).sort(),
            `cues on ${path.basename(localPath)} should read back as written`,
        );
        checked += 1;
    }
    console.log(`  ${checked} tracks' cues read back identically — OK`);

    // ── 5. write the beat grids ─────────────────────────────────────────────
    console.log('\nWriting beat grids');
    const gridTargets = new Map<string, SeratoBeatgridWire[]>();
    for (const crate of crates) {
        for (const t of crate.tracks) {
            if ((t.beatgrid ?? []).length > 0) {
                gridTargets.set(path.join(musicRoot, t.relative_path), t.beatgrid);
            }
        }
    }
    console.log(`  ${gridTargets.size} tracks have a grid to write`);

    // The guard would otherwise make this test lie. writeTrackGrid declines any
    // file that already carries anchors -- deliberately, because it cannot tell
    // Serato's auto-analysis from a grid the user fixed by hand, and a wrong grid
    // is worse than a missing one. But these files came out of subbox carrying
    // whatever the *uploaded* copy had, so without this most of them would be
    // skipped, the run would report success, and nothing would have been written.
    //
    // Clearing to n_markers=0 is not a cheat: it is exactly the state Serato
    // leaves a track it has analysed but never gridded, which is the case the
    // writeback exists to serve. It also proves the guard tests for *anchors*
    // rather than for the frame, since the frame is still there afterwards.
    let cleared = 0;
    if (process.env.KEEP_EXISTING_GRIDS !== '1') {
        const { BeatgridMp3Encoder, Track } = await import('tserato');
        const encoder = new BeatgridMp3Encoder();
        for (const localPath of gridTargets.keys()) {
            if (path.extname(localPath).toLowerCase() !== '.mp3') continue;
            const t = Track.fromPath(localPath);
            if (encoder.readBeatgrid(t).length === 0) continue;
            t.beatgrid = [];
            encoder.write(t);
            cleared += 1;
        }
        console.log(`  cleared ${cleared} pre-existing grids to the analysed-but-ungridded state`);
    }

    const gridResult = writeTrackGrid(
        Array.from(gridTargets, ([localPath, beatgrid]) => ({ beatgrid, localPath })),
    );
    console.log(
        `  ${gridResult.written} written, ${gridResult.alreadyGridded} already gridded, ` +
            `${gridResult.unsupported} unsupported, ${gridResult.failed.length} failed`,
    );
    for (const f of gridResult.failed) console.log(`    FAILED ${f.trackName}: ${f.reason}`);
    assert.equal(gridResult.failed.length, 0, 'no grid write should fail');

    const mp3Targets = Array.from(gridTargets.keys()).filter(
        (p) => path.extname(p).toLowerCase() === '.mp3',
    );
    if (mp3Targets.length > 0) {
        // Assert on `written`, not on the call returning. A run where every file
        // was skipped is the failure this phase is here to catch.
        assert.ok(
            gridResult.written > 0,
            'at least one grid must actually be written -- all-skipped is not a pass',
        );
    }

    // Read them back through the same decode the import uses.
    let gridsChecked = 0;
    for (const [localPath, expected] of gridTargets) {
        if (path.extname(localPath).toLowerCase() !== '.mp3') continue;
        const back = readTrackGrid(localPath);
        assert.ok(back, `a grid should read back from ${path.basename(localPath)}`);
        assert.equal(
            back.length,
            expected.length,
            `${path.basename(localPath)} should have ${expected.length} anchors`,
        );
        for (let i = 0; i < expected.length; i += 1) {
            // Serato stores float32 seconds, so a position survives to about
            // 1e-4 ms -- far finer than the 0.49ms int() rounding pymix#165 fixed,
            // and the reason this compares with a tolerance rather than exactly.
            assert.ok(
                Math.abs(back[i].position_ms - expected[i].position_ms) < 0.01,
                `anchor ${i} of ${path.basename(localPath)}: ` +
                    `${back[i].position_ms} != ${expected[i].position_ms}`,
            );
            assert.equal(
                back[i].beats_till_next ?? null,
                expected[i].beats_till_next ?? null,
                `anchor ${i} of ${path.basename(localPath)} should keep its beat count`,
            );
        }
        gridsChecked += 1;
    }
    console.log(`  ${gridsChecked} tracks' grids read back anchor for anchor — OK`);

    // The cues must still be there. Writing two GEOB frames on one file is where
    // tserato#9 went wrong, and a grid write that took the cues with it would
    // otherwise pass every assertion above.
    for (const [localPath, expected] of cueTargets) {
        if (path.extname(localPath).toLowerCase() !== '.mp3') continue;
        const back = readTrackCues(localPath);
        assert.ok(back, `cues must survive the grid write on ${path.basename(localPath)}`);
        assert.equal(
            back.length,
            expected.length,
            `${path.basename(localPath)} lost cues when its grid was written`,
        );
    }
    console.log('  cues survived the grid write — OK');

    // The damage check. tserato#9 was a write that replaced the whole GEOB array,
    // taking the beatgrid and waveform with it.
    console.log(`\nWorkspace kept for inspection:\n  ${workDir}`);
    console.log(`  snapshot it with:  scripts/serato/serato_snapshot.py capture ${seratoFolder}`);
    console.log('\nSerato round trip passed.');
}

// Never reuse a socket. uvicorn's default keep-alive timeout is 5s, and this
// script does seconds of blocking ID3 work between calls -- reading cues and
// grids off every track in the manifest -- so a pooled connection is routinely
// dead by the time the next request goes out. undici writes into it and reports
// `other side closed`, which reads like a server error and is not one.
async function pymix<T>(pathname: string, body: unknown): Promise<T> {
    const res = await fetch(`${PYMIX}${pathname}`, {
        body: JSON.stringify(body),
        headers: {
            Connection: 'close',
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
        },
        method: 'POST',
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
}

async function subsonicPlaylists(): Promise<Array<{ id: string; name: string }>> {
    const url =
        `${SUBSONIC}/rest/getPlaylists?u=${encodeURIComponent(USERNAME)}` +
        `&p=${encodeURIComponent(PASSWORD)}&v=1.16.1&c=serato-roundtrip&f=json`;
    const body = (await (await fetch(url)).json()) as any;
    return body['subsonic-response']?.playlists?.playlist ?? [];
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
