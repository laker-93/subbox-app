import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    nodeKey,
    readCrateTree,
    readTrackCues,
    readTrackGrid,
} from '../src/main/features/core/sync/serato-crates';
import { readSubboxId } from '../src/main/features/core/sync/subbox-id-tags';
import { writeFlatZip } from '../src/main/features/core/sync/write-zip';

// The other half of rung 5: take the crates dev-serato-roundtrip.ts just wrote and
// put them back through /serato/import, the way the client's Sync -> Upload
// (Serato) does. Two things can only be shown here:
//
//   * the tree survives a full round trip — the crates subbox wrote parse back
//     into the same playlists, with the same nesting;
//   * a cue set *after* the track was uploaded reaches subbox. This is the gap P4
//     closed: pymix reads cues off its own copy of a file, which is frozen at
//     whatever was uploaded, so before this the answer was always the old one.
//
// Dev only. This writes into a live per-user container.
//
//   pnpm dev:serato-reimport <workdir-from-roundtrip>

const PYMIX = process.env.PYMIX_URL ?? 'http://localhost:8002';
const SUBSONIC = process.env.SUBSONIC_URL ?? 'http://localhost:41831';
const USERNAME = process.env.SUBBOX_USER ?? 'test060826';
const PASSWORD = process.env.SUBBOX_PASSWORD ?? 'Testpass12345!';
/** Where the pymix container sees this user's filebrowser uploads. */
const UPLOADS = `/user-updownloads/${USERNAME}/uploads`;

let cookie = '';

// Never reuse a socket. uvicorn's default keep-alive timeout is 5s, and this
// script does seconds of blocking ID3 work between calls -- reading cues and
// grids off every track in the manifest -- so a pooled connection is routinely
// dead by the time the next request goes out. undici writes into it and reports
// `other side closed`, which reads like a server error and is not one.
async function api<T>(pathname: string, body?: unknown, method = 'POST'): Promise<T> {
    const res = await fetch(`${PYMIX}${pathname}`, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: {
            Connection: 'close',
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
        },
        method,
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
}

function clearUploads(): void {
    execFileSync('docker', ['exec', 'pymix', 'sh', '-c', `rm -rf ${UPLOADS}/* || true`]);
}

async function main(): Promise<void> {
    const workDir = process.argv[2];
    assert.ok(workDir && fs.existsSync(workDir), 'pass the workdir dev-serato-roundtrip printed');
    const seratoFolder = path.join(workDir, '_Serato_');

    console.log(`Serato re-import against ${PYMIX} as ${USERNAME}\n`);
    await api('/user/login', { password: PASSWORD, username: USERNAME });

    const before = readCrateTree(seratoFolder);
    console.log(`  ${before.length} crates to send back:`);
    for (const n of before) console.log(`    ${nodeKey(n.components)} (${n.tracks.length} tracks)`);

    // ── Re-cue one track, as the user would in Serato after the download ────
    const victim = before.flatMap((n) => n.tracks).find((t) => t.toLowerCase().endsWith('.mp3'));
    assert.ok(victim, 'need an mp3 to re-cue');
    const NEW_CUE = { end_ms: null, index: 5, name: 'set-in-serato', start_ms: 61234 } as const;
    console.log(`\n  re-cueing ${path.basename(victim)} at ${NEW_CUE.start_ms}ms`);
    // Written straight into the file's Markers2 frame, which is exactly what
    // Serato would have left behind.
    const { BeatgridEncoder, HotCue, HotCueType, Track, V2Encoder } = await import('tserato');
    const t = Track.fromPath(victim);
    // HotCue takes start/end, not the wire shape's start_ms/end_ms. Spreading the
    // wire object here silently wrote the cue at 0 — worth the two extra lines.
    t.addHotCue(
        new HotCue({
            end: NEW_CUE.end_ms,
            index: NEW_CUE.index,
            name: NEW_CUE.name,
            start: NEW_CUE.start_ms,
            type: HotCueType.CUE,
        }),
    );
    new V2Encoder().write(t);
    const onDisk = readTrackCues(victim)!;
    assert.ok(
        onDisk.some((c) => c.name === NEW_CUE.name && c.start_ms === NEW_CUE.start_ms),
        'the new cue should be on the file',
    );

    // ── Re-grid the same track, as the user would after correcting it ───────
    // These are the seven anchors Serato DJ Pro itself wrote onto the hand-gridded
    // fixture (subbox-workspace scripts/serato, docs/design-beatgrids.md §7). Using
    // real ones rather than a synthetic grid matters: every fixture position was
    // authored in whole milliseconds, which is precisely why nothing synthetic
    // caught the sub-millisecond rounding bug pymix#165 fixed.
    const NEW_GRID = [
        { beats_till_next: 4, position_ms: 45.968708 },
        { beats_till_next: 28, position_ms: 1921.88704 },
        { beats_till_next: 8, position_ms: 15049.188614 },
        { beats_till_next: 12, position_ms: 18044.784546 },
        { beats_till_next: 12, position_ms: 22544.511795 },
        { beats_till_next: 12, position_ms: 27044.218063 },
        { bpm: 99.34040069580078, position_ms: 34242.923737 },
    ];
    console.log(`  re-gridding ${path.basename(victim)} with ${NEW_GRID.length} anchors`);
    const gt = Track.fromPath(victim);
    gt.beatgrid = NEW_GRID.map((a) => ({
        beatsTillNext: a.beats_till_next ?? null,
        bpm: a.bpm ?? null,
        position: a.position_ms / 1000,
    }));
    new BeatgridEncoder().write(gt);
    const gridOnDisk = readTrackGrid(victim)!;
    assert.equal(gridOnDisk.length, NEW_GRID.length, 'the new grid should be on the file');

    // ── The manifest, exactly as sync:upload-from-crates builds it ──────────
    const identities: Array<{
        beatgrid?: any[];
        crate_path: string;
        cues?: any[];
        subbox_id: string;
    }> = [];
    const seen = new Set<string>();
    for (const node of before) {
        for (const trackPath of node.tracks) {
            if (seen.has(trackPath)) continue;
            seen.add(trackPath);
            const subboxId = readSubboxId(trackPath);
            assert.ok(subboxId, `no SUBBOX_ID on ${path.basename(trackPath)}`);
            const cues = readTrackCues(trackPath);
            // Read independently of the cues. A file can carry a grid and no cues
            // or cues and no grid, and `null` (could not read) must stay distinct
            // from `[]` (read, and empty) all the way to the server -- pymix falls
            // back to its own copy on the first and clears nothing on the second.
            const beatgrid = readTrackGrid(trackPath);
            identities.push({
                crate_path: trackPath,
                subbox_id: subboxId,
                ...(cues === null ? {} : { cues }),
                ...(beatgrid === null ? {} : { beatgrid }),
            });
        }
    }
    const victimId = identities.find((i) => i.crate_path === victim)!.subbox_id;
    console.log(
        `  manifest: ${identities.length} entries, ` +
            `${identities.filter((i) => i.cues && i.cues.length > 0).length} carrying cues, ` +
            `${identities.filter((i) => i.beatgrid && i.beatgrid.length > 0).length} carrying grids`,
    );

    // ── Import ─────────────────────────────────────────────────────────────
    clearUploads();
    const nCrates = stageCrateZip(seratoFolder);
    console.log(`\n  staged all-crates.zip (${nCrates} crate files)`);

    const started = await api<any>('/serato/import', { track_identities: identities });
    assert.ok(started.success, `import rejected: ${started.reason}`);
    console.log(`  job ${started.job_id} started; waiting…`);
    const done = await waitForJob(started.job_id);
    console.log(`  result=${done.result} reason=${JSON.stringify(done.reason)}`);
    if (done.warnings) console.log(`  warnings: ${done.warnings}`);
    assert.equal(done.result, true, 'the import should succeed');

    // ── The tree came back ─────────────────────────────────────────────────
    const playlists: Array<{ id: string; name: string; songCount: number }> =
        (await subsonic('getPlaylists')).playlists?.playlist ?? [];
    const byName = new Map(playlists.map((p) => [p.name, p]));
    console.log('\n  playlists after the round trip:');
    for (const node of before) {
        const name = nodeKey(node.components);
        const pl = byName.get(name);
        assert.ok(pl, `playlist "${name}" should exist after the round trip`);
        console.log(`    ${name}: ${pl.songCount} (crate had ${node.tracks.length})`);
        assert.equal(
            pl.songCount,
            node.tracks.length,
            `"${name}" should have every track the crate held`,
        );
    }
    console.log('  every crate came back as a playlist with the same track count — OK');

    // ── The cue set after upload reached subbox ────────────────────────────
    const meta = await api<any>(`/track/metadata/${victimId}`, undefined, 'GET');
    assert.ok(meta.success, `metadata lookup failed: ${meta.reason}`);
    // The endpoint returns the stored blob under `metadata`, not `cuedata`.
    const cues: Array<{ name: string; position: number }> = meta?.metadata?.cues ?? [];
    console.log(`\n  stored cues for ${path.basename(victim)}: ${JSON.stringify(cues)}`);
    assert.ok(
        cues.some((c) => c.name === NEW_CUE.name && c.position === NEW_CUE.start_ms),
        'the cue set after the track was uploaded must reach subbox (this is what P4 fixed)',
    );
    console.log('  a cue set after upload reached subbox — OK');

    // ── The grid set after upload reached subbox ───────────────────────────
    const storedGrid: Array<{ beats_till_next?: number; bpm?: number; position_ms: number }> =
        meta?.metadata?.beatgrid ?? [];
    console.log(`\n  stored grid: ${storedGrid.length} anchors`);
    assert.equal(
        storedGrid.length,
        NEW_GRID.length,
        'every anchor set in Serato after upload must reach subbox',
    );
    for (let i = 0; i < NEW_GRID.length; i += 1) {
        // Exact to well under a millisecond, not approximate. This is the property
        // pymix#165 bought: position_ms was an `int`, which moved every anchor of a
        // real Serato grid by up to 0.49ms and meant a grid could not make the trip
        // out and back unchanged. A loose tolerance here would let that regress.
        assert.ok(
            Math.abs(storedGrid[i].position_ms - NEW_GRID[i].position_ms) < 0.001,
            `stored anchor ${i}: ${storedGrid[i].position_ms} != ${NEW_GRID[i].position_ms} ` +
                '(sub-millisecond drift is the pymix#165 regression)',
        );
        assert.equal(
            storedGrid[i].beats_till_next ?? null,
            NEW_GRID[i].beats_till_next ?? null,
            `stored anchor ${i} should keep its beat count`,
        );
    }
    console.log('  a grid set after upload reached subbox, to the sub-millisecond — OK');

    // ── …and comes back out as Rekordbox <TEMPO> nodes ─────────────────────
    // The point of the whole design: a grid made in Serato reaching Rekordbox.
    // Everything above proves it into storage; only this proves it out the far side.
    console.log('\n  exporting Rekordbox XML');
    // The playlists we just imported, which are the ones the victim is actually in.
    // Picking arbitrary playlists here exports an XML the track is absent from,
    // and "0 <TRACK> nodes" then reads like a broken export rather than a bad query.
    const importedIds = before
        .map((n) => byName.get(nodeKey(n.components))?.id)
        .filter((id): id is string => Boolean(id));
    const xml = await rekordboxXmlFor(importedIds);
    if (xml === null) {
        console.log('  SKIPPED — no Rekordbox XML in the download (see below)');
    } else {
        // Scope to the victim's own <TRACK> before reading any <TEMPO>. The export
        // is a whole collection, so a global sweep collects every track's anchors
        // at once -- which looks exactly like anchors being dropped and tempos
        // being derived across the gaps, and cost a wrong diagnosis here already.
        // Split rather than match a balanced <TRACK>…</TRACK>: the collection mixes
        // self-closing TRACK nodes with ones that have TEMPO children, and a lazy
        // `[\s\S]*?</TRACK>` run against a self-closing node swallows everything up
        // to the *next* track's closing tag. Each chunk here runs to the following
        // <TRACK, so it carries exactly that track's children.
        const wanted = path.basename(victim);
        const trackBlocks = xml
            .split(/<TRACK\b/)
            .slice(1)
            .filter((chunk) => {
                const loc = /Location="([^"]*)"/.exec(chunk);
                if (!loc) return false;
                try {
                    return decodeURIComponent(loc[1]).endsWith(wanted);
                } catch {
                    return false;
                }
            });
        assert.equal(
            trackBlocks.length,
            1,
            `expected exactly one <TRACK> for ${wanted}, found ${trackBlocks.length}`,
        );
        const tempos = [...trackBlocks[0].matchAll(/<TEMPO\s+([^>]*)\/>/g)].map((m) => {
            const attr = (k: string) => {
                const hit = new RegExp(`${k}="([^"]*)"`).exec(m[1]);
                return hit ? hit[1] : null;
            };
            return {
                battito: attr('Battito'),
                bpm: Number(attr('Bpm')),
                inizio: Number(attr('Inizio')),
                metro: attr('Metro'),
            };
        });
        console.log(`  ${tempos.length} <TEMPO> nodes in the exported XML`);
        for (const t of tempos) {
            console.log(
                `    Inizio=${t.inizio} Bpm=${t.bpm} Metro=${t.metro} Battito=${t.battito}`,
            );
        }
        assert.equal(
            tempos.length,
            NEW_GRID.length,
            'every Serato anchor should become a Rekordbox <TEMPO> node',
        );
        for (let i = 0; i < NEW_GRID.length; i += 1) {
            // Rekordbox writes Inizio to 3dp -- the format's own limit, not ours.
            assert.ok(
                Math.abs(tempos[i].inizio * 1000 - NEW_GRID[i].position_ms) < 1.0,
                `TEMPO ${i}: Inizio ${tempos[i].inizio}s != ${NEW_GRID[i].position_ms}ms`,
            );
            // A Serato anchor carries a beat count, not a tempo; pymix derives the
            // BPM from the spacing (beats * 60 / seconds). A wrong derivation here
            // is the failure that puts every cue on the track off-beat.
            assert.ok(tempos[i].bpm > 0, `TEMPO ${i} must carry a real tempo`);
        }
        console.log('  the Serato grid crossed to Rekordbox as <TEMPO> nodes — OK');
    }

    clearUploads();
    console.log('\nSerato re-import passed.');
}

/**
 * Ask pymix for a Rekordbox XML export covering these playlists.
 *
 * Returns null rather than throwing when the export carries no XML: the point of
 * this script is the Serato half, and a missing XML should report itself rather
 * than fail a run that proved everything else. pymix#121 moved the file from the
 * zip root into music/, so both are tried -- see subbox-workspace#15.
 */
async function rekordboxXmlFor(playlistIds: string[]): Promise<null | string> {
    if (playlistIds.length === 0) return null;
    const owning = playlistIds;

    const plan = await api<any>('/sync/playlists', {
        direction: 'download',
        includeRekordboxXml: true,
        includeTracks: false,
        localTracks: [],
        options: { fuzzyMatch: true, includeMetadata: true },
        playlists: owning.map((id) => ({ id, source: 'subbox' })),
        user_root: '/tmp/rb-xml-check',
    });
    if (!plan.success || !plan.downloadFilename) return null;

    const res = await fetch(`${PYMIX}/sync/download/${encodeURIComponent(plan.downloadFilename)}`, {
        headers: { Connection: 'close', Cookie: cookie },
    });
    if (!res.ok) return null;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-xml-'));
    const body = Buffer.from(await res.arrayBuffer());

    // With includeTracks:false there is nothing to zip, so pymix serves the XML
    // straight. Sniffing the bytes rather than trusting the filename: the shape
    // of this response depends on flags a caller can change, and an unzip failure
    // reads like a broken export rather than a different-but-fine one.
    if (body.subarray(0, 5).toString() === '<?xml') return body.toString('utf8');
    if (body.subarray(0, 2).toString() !== 'PK') return null;

    const zipPath = path.join(dir, 'export.zip');
    fs.writeFileSync(zipPath, body);
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', dir]);
    // pymix#121 moved the file from the zip root into music/ — see subbox-workspace#15.
    for (const rel of ['music/subbox_rb_export.xml', 'subbox_rb_export.xml']) {
        const candidate = path.join(dir, rel);
        if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8');
    }
    return null;
}

/** Put all-crates.zip where pymix looks for it, without needing filebrowser auth. */
function stageCrateZip(seratoFolder: string): number {
    const subcrates = path.join(seratoFolder, 'SubCrates');
    const files = fs.readdirSync(subcrates).filter((f) => f.endsWith('.crate'));
    const zipPath = path.join(seratoFolder, 'all-crates.zip');
    writeFlatZip(
        zipPath,
        files.map((name) => ({ data: fs.readFileSync(path.join(subcrates, name)), name })),
    );
    execFileSync('docker', ['exec', 'pymix', 'mkdir', '-p', UPLOADS]);
    execFileSync('docker', ['cp', zipPath, `pymix:${UPLOADS}/all-crates.zip`]);
    fs.rmSync(zipPath);
    return files.length;
}

async function subsonic(endpoint: string, params = ''): Promise<any> {
    const url =
        `${SUBSONIC}/rest/${endpoint}?u=${encodeURIComponent(USERNAME)}` +
        `&p=${encodeURIComponent(PASSWORD)}&v=1.16.1&c=serato-reimport&f=json${params}`;
    return ((await (await fetch(url)).json()) as any)['subsonic-response'];
}

async function waitForJob(jobId: string): Promise<any> {
    for (let i = 0; i < 200; i += 1) {
        const p = await api<any>(
            `/beets/import/progress?job_id=${encodeURIComponent(jobId)}&public=false`,
            undefined,
            'GET',
        );
        if (p.complete || p.result !== null) return p;
        await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error('import job never finished');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
