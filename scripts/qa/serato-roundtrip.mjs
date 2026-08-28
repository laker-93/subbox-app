import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { _electron as electron } from 'playwright';

import { devRequest, pymixLogin, subsonic } from './dev-http.mjs';
import { resetLibrary } from './reset-library.mjs';
import {
    forceFreshLogin,
    getCredentials,
    isLoggedOut,
    performLogin,
    resolveAppEntry,
    ROOT,
    SNAPSHOT_DIR,
} from '../ui-snapshot-shared.mjs';

// The Serato ↔ Rekordbox round trip, from an empty library, through the app.
//
//   node scripts/qa/serato-roundtrip.mjs
//
// Five phases, each depending on the last, each asserting against the servers
// rather than against what the screen says:
//
//   reset             wipe the account, clear the local download mirror, and
//                     generate a fresh synthetic Serato library to import
//   serato-upload     Sync -> Upload (Serato): read the crates, upload the tracks,
//                     assert the crate tree came back as playlists
//   rekordbox-export  Sync -> Download with "Include Rekordbox XML": assert the XML
//                     carries the same playlists and that every Location resolves
//                     to a file that is actually there
//   rekordbox-import  wipe again, then Sync -> Upload (Rekordbox) with that XML:
//                     the same library, rebuilt from the other format
//   serato-export     Sync -> Download with "Write Serato crates": assert the crates
//                     written read back with the right tree, tracks and cues
//
// The two conversions are deliberately run against each other's output: the XML
// that phase 3 exports is what phase 4 imports, and the crates phase 5 writes are
// compared to the fixture phase 1 generated. A format that silently drops a
// playlist, a track or a cue fails at the far end even when every screen said
// "complete" — which is the whole reason this is one driver and not five.
//
// LOCAL DEV ONLY, and destructive: it empties the account it runs against.
//
// Env:
//   QA_APP_ENTRY        out/main/index.js to launch (default: this worktree's build)
//   QA_PHASES           comma-separated subset of the phases above (default: all)
//   QA_SERATO_TRACKS    fixture size (default 8)
//   QA_IMPORT_TIMEOUT_MS  cap on any one import/download job (default 600000)
//   QA_KEEP_FIXTURE     '1' to reuse the fixture already in .qa-serato instead of
//                       regenerating it (faster when iterating on a later phase)

const MAIN_ENTRY = resolveAppEntry();
const credentials = getCredentials();
const PYMIX_URL = process.env.QA_PYMIX_URL || 'https://pymix.docker.localhost';
const JOB_TIMEOUT_MS = Number(process.env.QA_IMPORT_TIMEOUT_MS) || 600_000;
const NUM_TRACKS = Number(process.env.QA_SERATO_TRACKS) || 8;
const ALL_PHASES = [
    'reset',
    'serato-upload',
    'rekordbox-export',
    'rekordbox-import',
    'serato-export',
];
const phases = (process.env.QA_PHASES || ALL_PHASES.join(',')).split(',').map((p) => p.trim());

// The fixture lives beside the worktree, not in /tmp: a failed nightly run is
// worth being able to open by hand the next morning.
const QA_DIR = path.join(ROOT, '.qa-serato');
const SOURCE_SERATO = path.join(QA_DIR, 'source', '_Serato_');
const SOURCE_AUDIO = path.join(QA_DIR, 'source', 'audio');
const EXPORT_SERATO = path.join(QA_DIR, 'export', '_Serato_');

const WORKSPACE = path.resolve(ROOT, '..', 'subbox-workspace');
const PY = process.env.QA_PYTHON || path.resolve(ROOT, '..', 'pymix', '.venv', 'bin', 'python');
const MAKE_FIXTURE = path.join(WORKSPACE, 'scripts', 'serato', 'make_test_serato_library.py');
const SNAPSHOT_TOOL = path.join(WORKSPACE, 'scripts', 'serato', 'serato_snapshot.py');

// Where a dev build keeps the tracks it downloads. `getAppPath()` appends `-dev`
// when NODE_ENV is development, so this is separate from a real subbox library on
// the same machine — see docs/qa.md.
const LOCAL_MUSIC = path.join(
    process.env.HOME,
    'Library',
    'Application Support',
    'subbox-dev',
    'music',
);

const log = (...a) => console.log('[serato-roundtrip]', ...a);
const checks = [];
const notes = [];
function check(name, ok, detail = '') {
    checks.push({ detail: String(detail), name, ok: Boolean(ok) });
    log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
/** An observation that is already filed against another repo, so it must not turn
 *  this driver permanently red — but must not go unrecorded either. Promote it to a
 *  check() the moment the issue it names is fixed. */
function note(name, detail) {
    notes.push({ detail: String(detail), name });
    log(`NOTE  ${name} — ${detail}`);
}

const py = (args) => execFileSync(PY, args, { encoding: 'utf8' });

// ── Fixture ─────────────────────────────────────────────────────────────────

function generateFixture() {
    fs.rmSync(path.join(QA_DIR, 'source'), { force: true, recursive: true });
    // The generator refuses a --serato-folder with no SubCrates dir, as a guard
    // against a typo'd path silently creating a bogus library somewhere.
    fs.mkdirSync(path.join(SOURCE_SERATO, 'SubCrates'), { recursive: true });
    const out = py([
        MAKE_FIXTURE,
        '--seed',
        '4242',
        '--num-tracks',
        String(NUM_TRACKS),
        '--seconds',
        '30',
        '--serato-folder',
        SOURCE_SERATO,
        '--audio-dir',
        SOURCE_AUDIO,
        '--crate-root',
        'Subbox QA',
        // Nothing here writes to the user's own ~/Music/_Serato_, so a running
        // Serato cannot clobber it and is not a reason to refuse.
        '--force',
    ]);
    log(out.trim().split('\n').slice(0, 3).join('\n'));
    return JSON.parse(fs.readFileSync(path.join(SOURCE_AUDIO, 'fixture.json'), 'utf8'));
}

function snapshot(seratoFolder, outFile) {
    py([SNAPSHOT_TOOL, 'capture', seratoFolder, '-o', outFile]);
    return JSON.parse(fs.readFileSync(outFile, 'utf8'));
}

// ── Server-side assertions ──────────────────────────────────────────────────

async function libraryState() {
    const { password, username } = credentials;
    const cookie = await pymixLogin(PYMIX_URL, username, password);
    const size = (
        await devRequest(`${PYMIX_URL}/user/library_size`, { headers: { cookie } })
    ).json();
    const { playlists } = await subsonic(username, password, 'getPlaylists');
    const list = (playlists?.playlist ?? []).map((p) => ({
        name: p.name,
        songCount: p.songCount,
    }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    let beetTracks = null;
    try {
        beetTracks = Number(
            execFileSync(
                'docker',
                ['exec', `beets${username}`, 'sh', '-c', 'beet ls 2>/dev/null | wc -l'],
                { encoding: 'utf8' },
            ).trim(),
        );
    } catch {
        // Reported as null rather than throwing; the checks below say what it means.
    }
    return { beetTracks, playlists: list, sizeBytes: size.total_size_bytes };
}

/** The crate tree a snapshot describes, in the "A / B" form pymix names playlists.
 *  `serato_snapshot.py` already joins the ancestry into `display_name`; a crate with
 *  no tracks of its own is a folder in Serato and never becomes a playlist. */
function crateNames(snap) {
    return snap.crates
        .filter((c) => c.tracks.length > 0)
        .map((c) => c.display_name)
        .sort();
}

// ── App driving ─────────────────────────────────────────────────────────────

async function launchApp(dialogPath) {
    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    const mainLogs = [];
    electronApp.process().stdout.on('data', (d) => mainLogs.push(`[main] ${d}`.trimEnd()));
    electronApp.process().stderr.on('data', (d) => mainLogs.push(`[main:err] ${d}`.trimEnd()));

    if (dialogPath) {
        await electronApp.evaluate(async ({ dialog }, p) => {
            dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
        }, dialogPath);
    }

    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });
    await page.waitForLoadState('networkidle');
    // pymix's session cookie is short-lived and a resumed session is often already
    // stale, which surfaces as a confusing "no session" mid-upload rather than at login.
    await forceFreshLogin(page);
    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(1000);

    // Sync mode is a store flag, not a route.
    await page.evaluate(() => {
        const parsed = JSON.parse(localStorage.getItem('store_app'));
        parsed.state.appMode = 'sync';
        localStorage.setItem('store_app', JSON.stringify(parsed));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    return { electronApp, mainLogs, page };
}

const shot = (page, name) =>
    page
        .screenshot({ path: path.join(SNAPSHOT_DIR, `serato-roundtrip-${name}-${Date.now()}.png`) })
        .catch(() => {});

/** Poll the screen for whichever of two regexes appears first. */
async function waitForOutcome(page, doneRe, errorRe, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const body = await page
            .locator('body')
            .innerText()
            .catch(() => '');
        if (doneRe.test(body)) return { body, state: 'done' };
        if (errorRe.test(body)) return { body, state: 'error' };
        await page.waitForTimeout(3000);
    }
    const body = await page
        .locator('body')
        .innerText()
        .catch(() => '');
    return { body, state: 'timeout' };
}

// ── Phase 1: reset ──────────────────────────────────────────────────────────

async function phaseReset() {
    const summary = await resetLibrary();
    check('library starts empty', summary.empty, JSON.stringify(summary));

    // The local mirror has to go too. A download only fetches what is missing
    // locally, so tracks left over from a previous run make phase 3 a no-op and
    // leave phase 5's crates pointing at last week's files.
    if (fs.existsSync(LOCAL_MUSIC)) {
        fs.rmSync(LOCAL_MUSIC, { force: true, recursive: true });
        log(`cleared local download mirror ${LOCAL_MUSIC}`);
    }
    fs.rmSync(path.join(QA_DIR, 'export'), { force: true, recursive: true });
    fs.mkdirSync(path.join(EXPORT_SERATO, 'SubCrates'), { recursive: true });

    if (process.env.QA_KEEP_FIXTURE === '1' && fs.existsSync(SOURCE_AUDIO)) {
        log('reusing the existing fixture (QA_KEEP_FIXTURE=1)');
    } else {
        generateFixture();
    }
    const snap = snapshot(SOURCE_SERATO, path.join(QA_DIR, 'fixture-snapshot.json'));
    check(
        'fixture generated',
        snap.crates.length > 0 && Object.keys(snap.tracks ?? {}).length > 0,
        `${snap.crates.length} crates, ${Object.keys(snap.tracks ?? {}).length} tracks`,
    );
    return snap;
}

// ── Phase 2: Serato -> subbox ───────────────────────────────────────────────

async function phaseSeratoUpload(fixtureSnap) {
    const { electronApp, mainLogs, page } = await launchApp(SOURCE_SERATO);
    try {
        await page.getByRole('button', { name: /^upload \(serato\)$/i }).first().click();
        await page.waitForTimeout(500);

        // "Select Serato Folder" / "Choose a Different Folder" — the label depends on
        // whether the app found a default library, which this machine has.
        await page
            .getByRole('button', { name: /select serato folder|choose a different folder/i })
            .first()
            .click();
        await page.getByText(/preview changes/i).first().waitFor({ timeout: 30_000 });

        // innerText applies CSS text-transform, and Mantine badges are uppercase —
        // so these have to be case-insensitive or they silently match a lowercase
        // crate row further down the page instead of the badge.
        const previewText = await page.locator('body').innerText();
        const crateBadge = previewText.match(/(\d+)\s+crates?\b/i);
        const trackBadge = previewText.match(/(\d+)\s+tracks\b/i);
        const expectedCrates = crateNames(fixtureSnap).length;
        check(
            'preview lists every crate that has tracks',
            Number(crateBadge?.[1]) === expectedCrates,
            `screen ${crateBadge?.[1]} vs fixture ${expectedCrates}`,
        );
        check(
            'preview counts each track once across overlapping crates',
            Number(trackBadge?.[1]) === Object.keys(fixtureSnap.tracks).length,
            `screen ${trackBadge?.[1]} vs fixture ${Object.keys(fixtureSnap.tracks).length}`,
        );
        await shot(page, 'serato-preview');

        await page.getByRole('button', { name: /upload selected crates/i }).first().click();
        log('uploading crates…');
        const { body, state } = await waitForOutcome(
            page,
            /import complete/i,
            /import failed|imported, with problems|storage limit/i,
            JOB_TIMEOUT_MS,
        );
        await shot(page, 'serato-upload-done');
        check('Serato import reports complete', state === 'done', body.replace(/\s+/g, ' ').slice(0, 200));
        if (state !== 'done') {
            log(mainLogs.filter((l) => /serato|import|error/i.test(l)).slice(-30).join('\n'));
        }
    } finally {
        await electronApp.close();
    }

    // Navidrome is the oracle, not the done screen.
    const state = await libraryState();
    const expected = crateNames(fixtureSnap);
    const got = state.playlists.map((p) => p.name);
    check(
        'crate tree came back as playlists',
        JSON.stringify(got) === JSON.stringify(expected),
        `got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`,
    );
    check(
        'every fixture track is in the library',
        state.beetTracks === Object.keys(fixtureSnap.tracks).length,
        `beets has ${state.beetTracks}, fixture has ${Object.keys(fixtureSnap.tracks).length}`,
    );
    return state;
}

// ── Phase 3: subbox -> Rekordbox XML ────────────────────────────────────────

async function phaseRekordboxExport(fixtureSnap) {
    const uniqueTracks = Object.keys(fixtureSnap.tracks ?? {}).length;
    const before = Date.now();
    const { electronApp, page } = await launchApp(null);
    try {
        await page.getByRole('button', { name: /^download$/i }).first().click();
        await page.waitForTimeout(1500);
        await page.getByRole('button', { name: /^select all$/i }).first().click();
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: /^preview download$/i }).first().click();
        await page
            .getByText(/generating sync plan/i)
            .first()
            .waitFor({ state: 'hidden', timeout: 120_000 })
            .catch(() => {});
        await page.waitForTimeout(1000);

        const xmlBox = page.getByRole('checkbox', { name: /include rekordbox xml/i });
        await xmlBox.check();
        const tracksBox = page.getByRole('checkbox', { name: /include tracks/i });
        await tracksBox.check();
        await page.waitForTimeout(300);
        await shot(page, 'download-preview');

        await page
            .getByRole('button', { name: /download & extract|download zip|download rekordbox xml/i })
            .first()
            .click();
        log('downloading tracks + XML…');
        const { body, state } = await waitForOutcome(
            page,
            /download complete/i,
            /download failed/i,
            JOB_TIMEOUT_MS,
        );
        await shot(page, 'download-done');
        check('download reports complete', state === 'done', body.replace(/\s+/g, ' ').slice(0, 200));
        const exported = Number(body.match(/(\d+)\s+tracks?\s+exported/i)?.[1] ?? 0);
        if (exported > uniqueTracks) {
            note(
                'the download counts a track once per playlist it is in (pymix#139)',
                `${exported} exported for ${uniqueTracks} unique tracks`,
            );
        }
    } finally {
        await electronApp.close();
    }

    // The XML is written next to the local library by default.
    const xmlPath = newestFile(path.dirname(LOCAL_MUSIC), /\.xml$/i, before);
    check('a Rekordbox XML was written', Boolean(xmlPath), xmlPath ?? 'none found');
    if (!xmlPath) return null;

    const xml = fs.readFileSync(xmlPath, 'utf8');
    const locations = [...xml.matchAll(/Location="([^"]+)"/g)].map((m) =>
        decodeURIComponent(m[1].replace(/^file:\/\/localhost/, '')),
    );
    const missing = locations.filter((p) => !fs.existsSync(p));
    check(
        'every XML Location resolves to a file on disk',
        locations.length > 0 && missing.length === 0,
        `${locations.length} locations, ${missing.length} missing${missing.length ? `: ${missing.slice(0, 3).join(' | ')}` : ''}`,
    );

    const xmlPlaylists = [...xml.matchAll(/<NODE Name="([^"]+)" Type="1"/g)].map((m) => m[1]);
    const state = await libraryState();
    // The XML nests playlists as a folder tree, so a playlist named "A / B" in
    // Navidrome is a node named "B" under a folder "A". Compare leaf names.
    const leafNames = state.playlists.map((p) => p.name.split(' / ').pop()).sort();
    check(
        'the XML carries every playlist',
        JSON.stringify([...xmlPlaylists].sort()) === JSON.stringify(leafNames),
        `xml ${JSON.stringify([...xmlPlaylists].sort())} vs library ${JSON.stringify(leafNames)}`,
    );
    return xmlPath;
}

function newestFile(dir, pattern, sinceMs) {
    if (!fs.existsSync(dir)) return null;
    const hits = fs
        .readdirSync(dir)
        .filter((f) => pattern.test(f))
        .map((f) => path.join(dir, f))
        .map((f) => ({ f, mtime: fs.statSync(f).mtimeMs }))
        .filter((e) => e.mtime >= sinceMs - 5000)
        .sort((a, b) => b.mtime - a.mtime);
    return hits[0]?.f ?? null;
}

// ── Phase 4: Rekordbox XML -> subbox ────────────────────────────────────────

async function phaseRekordboxImport(xmlPath, fixtureSnap) {
    const summary = await resetLibrary();
    check('library empty again before the Rekordbox import', summary.empty, JSON.stringify(summary));

    const { electronApp, mainLogs, page } = await launchApp(xmlPath);
    try {
        await page.getByRole('button', { name: /^upload \(rekordbox\)$/i }).first().click();
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: /select xml file/i }).first().click();
        await page.getByText(/preview changes/i).first().waitFor({ timeout: 30_000 });
        await shot(page, 'rekordbox-preview');

        await page.getByRole('button', { name: /upload selected playlists/i }).last().click();
        log('uploading the exported XML back in…');
        const { body, state } = await waitForOutcome(
            page,
            /upload complete/i,
            /import failed|upload failed|failed to check import progress/i,
            JOB_TIMEOUT_MS,
        );
        await shot(page, 'rekordbox-import-done');
        check('Rekordbox import reports complete', state === 'done', body.replace(/\s+/g, ' ').slice(0, 200));
        if (state !== 'done') {
            log(mainLogs.filter((l) => /rekordbox|import|error/i.test(l)).slice(-30).join('\n'));
        }
    } finally {
        await electronApp.close();
    }

    const state = await libraryState();
    check(
        'the library is back to the same track count',
        state.beetTracks === Object.keys(fixtureSnap.tracks).length,
        `beets has ${state.beetTracks}, fixture has ${Object.keys(fixtureSnap.tracks).length}`,
    );
    check(
        'the same playlists came back through Rekordbox',
        state.playlists.length === crateNames(fixtureSnap).length,
        `got ${JSON.stringify(state.playlists.map((p) => p.name))}`,
    );
    return state;
}

// ── Phase 5: subbox -> Serato crates ────────────────────────────────────────

async function phaseSeratoExport(fixtureSnap) {
    // The local mirror was populated in phase 3 and the account was wiped and
    // refilled in phase 4, so the tracks are on disk but under new subbox ids —
    // exactly the state a real user is in the second time they sync.
    const { electronApp, page } = await launchApp(EXPORT_SERATO);
    try {
        await page.getByRole('button', { name: /^download$/i }).first().click();
        await page.waitForTimeout(1500);
        await page.getByRole('button', { name: /^select all$/i }).first().click();
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: /^preview download$/i }).first().click();
        await page
            .getByText(/generating sync plan/i)
            .first()
            .waitFor({ state: 'hidden', timeout: 120_000 })
            .catch(() => {});
        await page.waitForTimeout(1000);

        // Point the crate writer at the throwaway _Serato_ (the stubbed dialog
        // resolves to it), then tick the box it enables.
        await page
            .getByRole('button', { name: /choose serato folder|change serato folder/i })
            .first()
            .click();
        await page.waitForTimeout(500);
        const crateBox = page.getByRole('checkbox', { name: /write serato crates/i });
        await crateBox.check();
        await page.waitForTimeout(300);
        await shot(page, 'serato-export-preview');

        await page
            .getByRole('button', { name: /download & extract|download zip|download rekordbox xml/i })
            .first()
            .click();
        log('writing Serato crates…');
        const { body, state } = await waitForOutcome(
            page,
            /download complete/i,
            /download failed/i,
            JOB_TIMEOUT_MS,
        );
        await shot(page, 'serato-export-done');
        check('crate write reports complete', state === 'done', body.replace(/\s+/g, ' ').slice(0, 200));
        check(
            'the done screen says how many crates it wrote',
            /serato crate/i.test(body),
            body.replace(/\s+/g, ' ').match(/.{0,80}serato crate.{0,80}/i)?.[0] ?? 'no mention',
        );
    } finally {
        await electronApp.close();
    }

    // Read the crates back with pyserato — the implementation pymix itself parses
    // them with, so this is the same question Serato's next import would ask.
    const after = snapshot(EXPORT_SERATO, path.join(QA_DIR, 'export-snapshot.json'));
    const expected = crateNames(fixtureSnap);
    const got = crateNames(after);
    check(
        'the written crates have the same tree as the fixture',
        JSON.stringify(got) === JSON.stringify(expected),
        `got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`,
    );
    const trackPaths = Object.keys(after.tracks ?? {});
    const absent = trackPaths.filter((p) => !fs.existsSync(p));
    check(
        'every crate entry points at a file that exists',
        trackPaths.length > 0 && absent.length === 0,
        `${trackPaths.length} entries, ${absent.length} missing${absent.length ? `: ${absent.slice(0, 3).join(' | ')}` : ''}`,
    );
    const cueCount = Object.values(after.tracks ?? {}).reduce(
        (n, t) => n + (t.cues?.length ?? 0),
        0,
    );
    const fixtureCues = Object.values(fixtureSnap.tracks ?? {}).reduce(
        (n, t) => n + (t.cues?.length ?? 0),
        0,
    );
    // What this does and does not prove: the files these crates point at still carry
    // their cues after a full round trip, which is the damage a user would actually
    // notice. It is NOT proof that pymix carried the cues back — the client leaves a
    // file that already has cues untouched, and on this path every file does. Proving
    // the server side needs a track whose local copy has no Markers2 frame; see
    // docs/qa/features/serato-roundtrip.md.
    check(
        'crate entries still carry their cues',
        cueCount === fixtureCues,
        `${cueCount} cues on the written crates' tracks vs ${fixtureCues} in the fixture`,
    );
    return after;
}

// ── Run ─────────────────────────────────────────────────────────────────────

async function main() {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    log('app entry:', MAIN_ENTRY);
    log('phases:', phases.join(', '));

    let fixtureSnap = null;
    let xmlPath = null;

    if (phases.includes('reset')) {
        fixtureSnap = await phaseReset();
    } else {
        fixtureSnap = JSON.parse(
            fs.readFileSync(path.join(QA_DIR, 'fixture-snapshot.json'), 'utf8'),
        );
    }

    if (phases.includes('serato-upload')) await phaseSeratoUpload(fixtureSnap);
    if (phases.includes('rekordbox-export')) xmlPath = await phaseRekordboxExport(fixtureSnap);
    if (phases.includes('rekordbox-import')) {
        if (!xmlPath) {
            xmlPath = newestFile(path.dirname(LOCAL_MUSIC), /\.xml$/i, 0);
            log(`reusing the XML already on disk: ${xmlPath}`);
        }
        if (xmlPath) await phaseRekordboxImport(xmlPath, fixtureSnap);
        else check('an XML to import', false, 'no exported XML available');
    }
    if (phases.includes('serato-export')) await phaseSeratoExport(fixtureSnap);

    const failed = checks.filter((c) => !c.ok);
    console.log('\n--- SUMMARY ---');
    console.log(
        JSON.stringify(
            { checks, failed: failed.length, notes, passed: checks.length - failed.length },
            null,
            2,
        ),
    );
    console.log(`\nOVERALL: ${failed.length === 0 ? 'PASS' : `FAIL (${failed.length})`}`);
    process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
