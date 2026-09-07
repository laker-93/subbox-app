import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { readTrackGrid, SeratoBeatgridWire } from '../src/main/features/core/sync/serato-crates';

// The third rung, and the leg the other two do not cover: Rekordbox -> subbox
// -> Serato.
//
// dev-serato-reimport.ts proves a grid made in *Serato* reaches storage and comes
// back out as Rekordbox <TEMPO> nodes. dev-serato-roundtrip.ts proves a grid
// already in storage reaches a Serato file. Neither proves the direction a
// Rekordbox user actually travels, because in both of them the grid entered
// subbox through the Serato door. This one starts where Rekordbox does: an XML,
// uploaded.
//
// The conversion is the whole point and it is not symmetric. A Rekordbox anchor
// carries its own tempo; a Serato anchor carries the whole number of beats until
// the next one. So going this way subbox has to *derive* the beat counts
// (`beats = span_s * bpm / 60`, rounded) rather than copy anything -- and where
// that rounding loses something, or where Metro and Battito have nowhere to go,
// it has to say so instead of quietly dropping it.
//
// Metadata-only: the tracks are already in the library, so no audio is uploaded
// and the XML is matched to them by Name/Artist/Album.
//
// Dev only. This writes into a live per-user container, and the Rekordbox import
// replaces the stored cuedata blob wholesale -- so it will overwrite anything a
// Serato import put on the same track.
//
//   pnpm dev:rekordbox-grid

const PYMIX = process.env.PYMIX_URL ?? 'http://localhost:8002';
const SUBSONIC = process.env.SUBSONIC_URL ?? 'http://localhost:41831';
const USERNAME = process.env.SUBBOX_USER ?? 'test060826';
const PASSWORD = process.env.SUBBOX_PASSWORD ?? 'Testpass12345!';
const UPLOADS = `/user-updownloads/${USERNAME}/uploads`;

/** Which playlist to pull a target track from. Any one with tracks will do. */
const PLAYLIST = process.env.PLAYLIST ?? 'Genres / Techno';

// A deliberately variable tempo, because a constant one exercises none of the
// conversion: with one anchor there is no span to measure a beat count over and
// the terminal-anchor case is the only case. 128 -> 160 -> 100, the same shape
// as the hand-gridded Serato fixture, but expressed the way Rekordbox does --
// every anchor carrying its own tempo.
//
// The second anchor's span is chosen to divide into whole beats and the third's
// deliberately is not, so the run exercises both the clean conversion and the
// one that has to round and report.
const GRID = [
    { battito: 1, bpm: 128.0, inizio: 0.0, metro: '4/4' },
    { battito: 1, bpm: 160.0, inizio: 15.0, metro: '4/4' },
    // 3/4 and a downbeat that is not beat 1: neither survives Serato, and both
    // must come back as a note rather than vanishing.
    { battito: 3, bpm: 100.0, inizio: 27.5, metro: '3/4' },
];
const CUES = [
    { name: 'RB CUE 1s', num: 0, start: 1.0 },
    { name: 'RB CUE 5s', num: 1, start: 5.0 },
    { name: 'RB CUE 12s', num: 2, start: 12.0 },
];
const LOOP = { end: 24.0, name: 'RB LOOP 20-24s', num: 0, start: 20.0 };
/** Deliberately not a whole number: phase 0 was about this surviving unrounded. */
const AVERAGE_BPM = 128.9;

let cookie = '';

// Never reuse a socket. uvicorn's default keep-alive timeout is 5s and this
// script waits on an import job between calls, so a pooled connection is
// routinely dead by the next request; undici writes into it and reports
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

/** A Rekordbox collection XML for one track, the way Rekordbox itself writes one. */
function buildXml(track: { album: string; artist: string; title: string }): string {
    const tempos = GRID.map(
        (t) =>
            `\t\t\t<TEMPO Inizio="${t.inizio}" Bpm="${t.bpm}" Metro="${t.metro}" ` +
            `Battito="${t.battito}"/>`,
    ).join('\n');
    // Type 0 is a cue and type 4 is a loop, which is the only thing that
    // distinguishes them -- a loop written as type 0 silently loses its end.
    const marks = [
        ...CUES.map(
            (c) =>
                `\t\t\t<POSITION_MARK Name="${xmlEscape(c.name)}" Type="0" ` +
                `Start="${c.start}" Num="${c.num}"/>`,
        ),
        `\t\t\t<POSITION_MARK Name="${xmlEscape(LOOP.name)}" Type="4" ` +
            `Start="${LOOP.start}" End="${LOOP.end}" Num="${LOOP.num}"/>`,
    ].join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
\t<PRODUCT Name="rekordbox" Version="5.8.7" Company="Pioneer DJ"/>
\t<COLLECTION Entries="1">
\t\t<TRACK TrackID="1" Name="${xmlEscape(track.title)}" Artist="${xmlEscape(track.artist)}" \
Album="${xmlEscape(track.album)}" AverageBpm="${AVERAGE_BPM}" TotalTime="300" \
Location="file://localhost/Users/dj/Music/${encodeURIComponent(track.title)}.mp3">
${tempos}
${marks}
\t\t</TRACK>
\t</COLLECTION>
\t<PLAYLISTS>
\t\t<NODE Type="0" Name="ROOT" Count="1">
\t\t\t<NODE Name="RB Grid QA" Type="1" KeyType="0" Entries="1">
\t\t\t\t<TRACK Key="1"/>
\t\t\t</NODE>
\t\t</NODE>
\t</PLAYLISTS>
</DJ_PLAYLISTS>
`;
}

async function main(): Promise<void> {
    console.log(`Rekordbox grid upload against ${PYMIX} as ${USERNAME}\n`);
    await api('/user/login', { password: PASSWORD, username: USERNAME });

    // ── Pick a target that is already in the library ────────────────────────
    const playlists: Array<{ id: string; name: string }> =
        (await subsonic('getPlaylists')).playlists?.playlist ?? [];
    const pl = playlists.find((p) => p.name === PLAYLIST);
    assert.ok(pl, `playlist "${PLAYLIST}" not found`);

    const structure = await api<any>('/serato/export', { playlistIds: [pl.id] });
    assert.ok(structure.success, 'serato/export should succeed');
    const candidates = (structure.crates as any[])
        .flatMap((c) => c.tracks)
        .filter((t) => t.subbox_id && t.relative_path?.toLowerCase().endsWith('.mp3'));
    assert.ok(candidates.length > 0, 'need a tagged mp3 in the playlist to target');
    const target = candidates[0];
    console.log(`  target: ${target.title} — ${target.artist} (${target.subbox_id})`);

    // ── Upload a Rekordbox XML carrying cues, a loop and a grid ─────────────
    const xml = buildXml({ album: target.album, artist: target.artist, title: target.title });
    stageXml(xml);
    console.log(
        `  staged rekordbox.xml: ${GRID.length} TEMPO nodes, ` +
            `${CUES.length} cues, 1 loop, AverageBpm=${AVERAGE_BPM}`,
    );

    const started = await api<any>('/rekordbox/import', { playlistNames: null });
    assert.ok(started.success, `import rejected: ${started.reason}`);
    console.log(`  job ${started.job_id} started; waiting…`);
    const done = await waitForJob(started.job_id);
    console.log(`  result=${done.result} reason=${JSON.stringify(done.reason)}`);
    assert.equal(done.result, true, 'the Rekordbox import should succeed');

    // ── What landed in storage ─────────────────────────────────────────────
    const meta = await api<any>(`/track/metadata/${target.subbox_id}`, undefined, 'GET');
    assert.ok(meta.success, `metadata lookup failed: ${meta.reason}`);
    const stored = meta.metadata ?? {};
    console.log(
        `\n  stored: ${(stored.cues ?? []).length} cues, ${(stored.loops ?? []).length} loops, ` +
            `${(stored.beatgrid ?? []).length} anchors, bpm=${stored.bpm}`,
    );

    assert.equal((stored.cues ?? []).length, CUES.length, 'every cue should reach storage');
    for (const [i, cue] of CUES.entries()) {
        assert.equal(
            stored.cues[i].position,
            Math.round(cue.start * 1000),
            `cue ${i} should be at ${cue.start}s`,
        );
    }
    // A loop stored as a cue loses its end, which is the failure that made
    // SeratoCue keep `type` explicit (laker-93/tserato#11).
    assert.equal((stored.loops ?? []).length, 1, 'the loop should reach storage as a loop');
    assert.equal(stored.loops[0].start, LOOP.start * 1000, 'loop start');
    assert.equal(stored.loops[0].end, LOOP.end * 1000, 'loop end');

    // Phase 0: the XML's own tempo, unrounded. beets can only hold the integer,
    // so cuedata is the only place 128.9 survives as 128.9 rather than 128.
    assert.equal(stored.bpm, AVERAGE_BPM, `AverageBpm should survive unrounded as ${AVERAGE_BPM}`);

    assert.equal((stored.beatgrid ?? []).length, GRID.length, 'every TEMPO node should be stored');
    for (const [i, anchor] of GRID.entries()) {
        const got = stored.beatgrid[i];
        assert.ok(
            Math.abs(got.position_ms - anchor.inizio * 1000) < 0.001,
            `anchor ${i}: ${got.position_ms} != ${anchor.inizio * 1000}`,
        );
        assert.equal(got.bpm, anchor.bpm, `anchor ${i} keeps its own tempo`);
        // Metro and Battito have nowhere to go in Serato, but they must survive
        // a trip that stays on the Rekordbox side.
        assert.equal(got.metro, anchor.metro, `anchor ${i} keeps its meter`);
        assert.equal(got.battito, anchor.battito, `anchor ${i} keeps its downbeat`);
    }
    console.log('  cues, loop, unrounded bpm and every anchor reached storage — OK');

    // ── The conversion out to Serato ───────────────────────────────────────
    // Rekordbox anchors carry tempos; Serato anchors carry beat counts. This is
    // where subbox has to derive them, and the only place the arithmetic runs.
    const after = await api<any>('/serato/export', { playlistIds: [pl.id] });
    const exported = (after.crates as any[])
        .flatMap((c) => c.tracks)
        .find((t) => t.subbox_id === target.subbox_id);
    assert.ok(exported, 'the target should still be in the Serato export');

    const grid: SeratoBeatgridWire[] = exported.beatgrid ?? [];
    console.log(`\n  Serato-shaped export: ${grid.length} anchors`);
    for (const [i, a] of grid.entries()) {
        console.log(
            `    ${i}: ${a.position_ms}ms  beats_till_next=${a.beats_till_next ?? '-'}  ` +
                `bpm=${a.bpm ?? '-'}`,
        );
    }
    for (const note of exported.beatgrid_notes ?? []) console.log(`    note: ${note}`);

    assert.equal(grid.length, GRID.length, 'the grid should convert anchor for anchor');
    // 15.000s at 128 BPM is exactly 32 beats -- a clean derivation.
    assert.equal(grid[0].beats_till_next, 32, 'first span is 32 whole beats at 128 BPM');
    assert.equal(grid[0].bpm ?? null, null, 'a non-terminal anchor carries a count, not a tempo');
    // 12.500s at 160 BPM is 33.33 beats. It must round *and say so*.
    assert.equal(grid[1].beats_till_next, 33, 'second span rounds to 33 beats');
    // The terminal anchor is the structurally special one: it carries a tempo and
    // no count, and mistyping it by list position is the bug that shape guards against.
    assert.equal(grid[2].beats_till_next ?? null, null, 'the terminal anchor carries no count');
    assert.equal(grid[2].bpm, 100.0, 'the terminal anchor carries its own tempo');

    const notes = (exported.beatgrid_notes ?? []).join(' | ');
    assert.ok(notes.includes('3/4'), `the dropped meter should be reported: ${notes}`);
    assert.ok(/beat 3|battito/i.test(notes), `the non-downbeat should be reported: ${notes}`);
    assert.ok(/round|33/.test(notes), `the rounded beat span should be reported: ${notes}`);
    console.log('  derived beat counts, terminal anchor, and every lossy edge named — OK');

    // ── And onto a real file, which is what Serato will read ───────────────
    const workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rb-grid-')));
    const local = path.join(workDir, 'target.mp3');
    fs.copyFileSync(
        process.env.SAMPLE_MP3 ??
            path.join(
                os.homedir(),
                'Music/SubboxSeratoQA/Subbox Grid QA',
                '01 - Variable Tempo 128-160-100.mp3',
            ),
        local,
    );
    const { BeatgridMp3Encoder, Track } = await import('tserato');
    const encoder = new BeatgridMp3Encoder();
    // Clear to the analysed-but-ungridded state so the write guard permits the
    // write -- the same state Serato leaves a track it analysed and never gridded.
    const cleared = Track.fromPath(local);
    cleared.beatgrid = [];
    encoder.write(cleared);

    const { writeTrackGrid } = await import('../src/main/features/core/sync/serato-crates');
    const result = writeTrackGrid([{ beatgrid: grid, localPath: local }]);
    assert.equal(result.written, 1, `the grid should be written: ${JSON.stringify(result.failed)}`);
    const back = readTrackGrid(local)!;
    assert.equal(back.length, grid.length, 'the file should carry every anchor');
    for (const [i, a] of grid.entries()) {
        assert.ok(
            Math.abs(back[i].position_ms - a.position_ms) < 0.01,
            `file anchor ${i}: ${back[i].position_ms} != ${a.position_ms}`,
        );
        assert.equal(
            back[i].beats_till_next ?? null,
            a.beats_till_next ?? null,
            `file anchor ${i} keeps its beat count`,
        );
    }
    console.log(`  written to a real mp3 and read back anchor for anchor — OK\n    ${local}`);

    execFileSync('docker', ['exec', 'pymix', 'sh', '-c', `rm -rf ${UPLOADS}/* || true`]);
    console.log('\nRekordbox grid upload passed.');
}

function stageXml(xml: string): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-upload-'));
    const local = path.join(dir, 'rekordbox.xml');
    fs.writeFileSync(local, xml, 'utf8');
    execFileSync('docker', ['exec', 'pymix', 'sh', '-c', `rm -rf ${UPLOADS}/* || true`]);
    execFileSync('docker', ['exec', 'pymix', 'mkdir', '-p', UPLOADS]);
    execFileSync('docker', ['cp', local, `pymix:${UPLOADS}/rekordbox.xml`]);
}

async function subsonic(endpoint: string, params = ''): Promise<any> {
    const url =
        `${SUBSONIC}/rest/${endpoint}?u=${encodeURIComponent(USERNAME)}` +
        `&p=${encodeURIComponent(PASSWORD)}&v=1.16.1&c=rekordbox-grid&f=json${params}`;
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

function xmlEscape(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
