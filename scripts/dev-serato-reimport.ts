import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    nodeKey,
    readCrateTree,
    readTrackCues,
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

async function api<T>(pathname: string, body?: unknown, method = 'POST'): Promise<T> {
    const res = await fetch(`${PYMIX}${pathname}`, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
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
    const { HotCue, HotCueType, Track, V2Mp3Encoder } = await import('tserato');
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
    new V2Mp3Encoder().write(t);
    const onDisk = readTrackCues(victim)!;
    assert.ok(
        onDisk.some((c) => c.name === NEW_CUE.name && c.start_ms === NEW_CUE.start_ms),
        'the new cue should be on the file',
    );

    // ── The manifest, exactly as sync:upload-from-crates builds it ──────────
    const identities: Array<{ crate_path: string; cues?: any[]; subbox_id: string }> = [];
    const seen = new Set<string>();
    for (const node of before) {
        for (const trackPath of node.tracks) {
            if (seen.has(trackPath)) continue;
            seen.add(trackPath);
            const subboxId = readSubboxId(trackPath);
            assert.ok(subboxId, `no SUBBOX_ID on ${path.basename(trackPath)}`);
            const cues = readTrackCues(trackPath);
            identities.push({
                crate_path: trackPath,
                subbox_id: subboxId,
                ...(cues === null ? {} : { cues }),
            });
        }
    }
    const victimId = identities.find((i) => i.crate_path === victim)!.subbox_id;
    console.log(
        `  manifest: ${identities.length} entries, ` +
            `${identities.filter((i) => i.cues && i.cues.length > 0).length} carrying cues`,
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

    clearUploads();
    console.log('\nSerato re-import passed.');
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
