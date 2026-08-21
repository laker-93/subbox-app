import fs from 'fs';
import path from 'path';
import { _electron as electron } from 'playwright';

import {
    getCredentials,
    isLoggedOut,
    performLogin,
    resolveAppEntry,
    SNAPSHOT_DIR,
} from '../ui-snapshot-shared.mjs';

// Regression: the watch-dir uploader must upload each file EXACTLY ONCE.
//
// Four phases against one staging dir, driving the genuine Sync -> Watch UI:
//
//   A  fresh upload   — N untagged files land in the watch dir before the watcher
//                       starts; expect a single 'uploading' burst, uploaded == N.
//   B  linger         — keep the watcher polling for QA_LINGER_MS across many
//                       ticks with the (now tagged) files still sitting in the
//                       watch dir; expect NO second burst. Catches both the
//                       poll re-entrancy amplification and a broken
//                       knownPresentIds/inFlightUploadIds cache.
//   C  dribble        — write one more file in slowly, in chunks, while the
//                       watcher is live; expect it to be tagged + uploaded only
//                       AFTER the last byte lands (subbox-app #108), and exactly
//                       once.
//   D  relaunch       — quit, relaunch, Start Watching on the same dir. The new
//                       process has an empty knownPresentIds, so this exercises
//                       the server-side POST /tracks/presence dedup. Expect zero
//                       uploads.
//
// WRITES to a live dev user (filebrowser -> pymix import -> Navidrome). Local
// dev stack only.
//
// Env:
//   QA_WATCH_DIR    REQUIRED. Staging dir the watcher watches (created if absent).
//   QA_STAGE_DIR    REQUIRED. Dir of files copied in for phase A.
//   QA_DRIBBLE_FILE Optional. File written in slowly during phase C.
//   QA_APP_ENTRY    out/main/index.js to launch.
//   QA_LINGER_MS    Phase B duration (default 45000).
//   QA_DRIBBLE_MS   Phase C write duration (default 24000).
//   QA_DRAIN_TIMEOUT_MS  Cap on waiting for a burst to drain (default 600000).

const MAIN_ENTRY = resolveAppEntry();
const WATCH_DIR = process.env.QA_WATCH_DIR;
const STAGE_DIR = process.env.QA_STAGE_DIR;
const DRIBBLE_FILE = process.env.QA_DRIBBLE_FILE;
const LINGER_MS = Number(process.env.QA_LINGER_MS) || 45_000;
const DRIBBLE_MS = Number(process.env.QA_DRIBBLE_MS) || 24_000;
const DRAIN_TIMEOUT_MS = Number(process.env.QA_DRAIN_TIMEOUT_MS) || 600_000;

const credentials = getCredentials();
const failures = [];
const notes = [];

function check(ok, label, detail = '') {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

function hasSubboxTag(file) {
    try {
        return fs.readFileSync(file).includes(Buffer.from('SUBBOX_ID'));
    } catch {
        return false;
    }
}

async function launchApp() {
    const app = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    const mainLogs = [];
    app.process().stdout.on('data', (d) => mainLogs.push(`[main] ${d}`.trimEnd()));
    app.process().stderr.on('data', (d) => mainLogs.push(`[main:err] ${d}`.trimEnd()));

    await app.evaluate(async ({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, WATCH_DIR);

    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });
    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(1000);
    return { app, mainLogs, page };
}

// Sidebar Sync -> Watch tab -> Select Directory -> (clear stale) -> Start Watching.
async function startWatching(page) {
    const syncToggle = page.getByText('Sync', { exact: true }).first();
    if (await syncToggle.isVisible().catch(() => false)) {
        await syncToggle.click();
        await page.waitForTimeout(800);
    }
    await page
        .getByRole('button', { name: /^watch$/i })
        .first()
        .click();
    await page.waitForTimeout(500);
    await page
        .getByRole('button', { name: /select directory|change directory/i })
        .first()
        .click();
    await page.getByText(WATCH_DIR, { exact: false }).first().waitFor({ timeout: 10_000 });

    const staleStop = page.getByRole('button', { name: /^stop watching$/i }).first();
    if (await staleStop.isVisible().catch(() => false)) {
        await staleStop.click();
        await page.waitForTimeout(500);
    }

    // Register the recorder BEFORE the watcher can emit anything.
    await page.evaluate(() => {
        window.__watchEvents = [];
        window.api.ipc.on('sync:watch-progress', (_e, prog) => {
            window.__watchEvents.push({ t: Date.now(), ...prog });
        });
    });

    await page
        .getByRole('button', { name: /^start watching$/i })
        .first()
        .click();
}

async function stopWatching(page) {
    await page.evaluate(() => window.api.ipc.invoke('sync:stop-watch')).catch(() => {});
    const stop = page.getByRole('button', { name: /^stop watching$/i }).first();
    if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => {});
}

// Contiguous runs of 'uploading' events, each ending at the next 'idle'.
function uploadBursts(events) {
    const bursts = [];
    let current = null;
    for (const e of events) {
        if (e.phase === 'uploading') {
            if (!current) current = { events: [], files: new Set(), start: e.t };
            current.events.push(e);
            if (e.currentFile) current.files.add(path.basename(e.currentFile));
        } else if (current && (e.phase === 'idle' || e.phase === 'error')) {
            current.end = e.t;
            current.uploaded = e.uploaded || 0;
            bursts.push(current);
            current = null;
        }
    }
    if (current) {
        current.end = current.events[current.events.length - 1].t;
        current.uploaded = 0;
        bursts.push(current);
    }
    return bursts;
}

const events = (page) => page.evaluate(() => window.__watchEvents.slice());

async function main() {
    if (!WATCH_DIR || !STAGE_DIR) throw new Error('QA_WATCH_DIR and QA_STAGE_DIR are required');
    fs.mkdirSync(WATCH_DIR, { recursive: true });

    // --- Phase A setup: copy the fixture set in, untagged ---
    const staged = fs
        .readdirSync(STAGE_DIR)
        .filter((f) => !f.startsWith('.'))
        .sort();
    for (const f of staged) fs.copyFileSync(path.join(STAGE_DIR, f), path.join(WATCH_DIR, f));
    const N = staged.length;
    console.log('app entry: ', MAIN_ENTRY);
    console.log('watch dir: ', WATCH_DIR, `(${N} files staged)`);
    const preTagged = staged.filter((f) => hasSubboxTag(path.join(WATCH_DIR, f)));
    check(
        preTagged.length === 0,
        'A0 staged files carry no SUBBOX_ID',
        `tagged: ${preTagged.length}`,
    );

    let { app, mainLogs, page } = await launchApp();
    const server = await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('store_authentication')).state.currentServer;
        return { id: s.id, url: s.url, username: s.username };
    });
    console.log('server:    ', server.username, server.url);

    // ============ PHASE A — fresh upload ============
    console.log(`\n=== PHASE A: fresh upload of ${N} files ===`);
    await startWatching(page);
    const drainA = await waitForDrain(page, { label: 'A' });
    const evsA = await events(page);
    const burstsA = uploadBursts(evsA);
    const uploadedA = Math.max(0, ...evsA.map((e) => e.uploaded || 0));

    check(drainA.drained, 'A1 uploader drained', `uploaded=${uploadedA}/${N}`);
    check(uploadedA === N, 'A2 every staged file uploaded', `${uploadedA} of ${N}`);
    check(burstsA.length === 1, 'A3 exactly one upload burst', `bursts=${burstsA.length}`);
    const filesA = burstsA.flatMap((b) => [...b.files]);
    check(
        new Set(filesA).size === filesA.length,
        'A4 no file appears twice within the burst',
        `${filesA.length} events / ${new Set(filesA).size} distinct`,
    );
    const taggedA = staged.filter((f) => hasSubboxTag(path.join(WATCH_DIR, f)));
    check(taggedA.length === N, 'A5 watcher tagged every file in place', `${taggedA.length}/${N}`);

    const phaseAEnd = Date.now();

    // ============ PHASE B — linger, no re-upload ============
    console.log(`\n=== PHASE B: linger ${LINGER_MS / 1000}s with the same files in place ===`);
    await page.waitForTimeout(LINGER_MS);
    const evsB = (await events(page)).filter((e) => e.t > phaseAEnd);
    const burstsB = uploadBursts(evsB);
    const scansB = evsB.filter((e) => e.phase === 'scanning').length;
    console.log(`  ${evsB.length} events, ${scansB} scan ticks, ${burstsB.length} upload bursts`);
    check(scansB >= 2, 'B1 the poller really ticked while lingering', `${scansB} scans`);
    check(
        burstsB.length === 0,
        'B2 no re-upload of already-present files',
        burstsB.length ? `re-uploaded ${[...burstsB[0].files].join(', ')}` : 'none',
    );
    check(
        evsB.every((e) => e.phase !== 'error'),
        'B3 no error phase while idling',
    );

    // ============ PHASE C — dribble a file in slowly ============
    let dribbleName = null;
    if (DRIBBLE_FILE && fs.existsSync(DRIBBLE_FILE)) {
        dribbleName = path.basename(DRIBBLE_FILE);
        console.log(`\n=== PHASE C: dribble ${dribbleName} in over ${DRIBBLE_MS / 1000}s ===`);
        const dribbleStart = Date.now();
        const src = fs.readFileSync(DRIBBLE_FILE);
        const dest = path.join(WATCH_DIR, dribbleName);
        const chunks = 12;
        const chunkSize = Math.ceil(src.length / chunks);
        const fd = fs.openSync(dest, 'w');
        let taggedWhilePartial = false;
        for (let i = 0; i < chunks; i++) {
            fs.writeSync(fd, src, i * chunkSize, Math.min(chunkSize, src.length - i * chunkSize));
            fs.fsyncSync(fd);
            await page.waitForTimeout(DRIBBLE_MS / chunks);
            if (i < chunks - 1 && hasSubboxTag(dest)) taggedWhilePartial = true;
        }
        fs.closeSync(fd);
        const dribbleEnd = Date.now();
        console.log(`  last byte written at ${new Date(dribbleEnd).toISOString().slice(11, 19)}`);

        check(
            !taggedWhilePartial,
            'C1 partial file never tagged mid-write (subbox-app #108)',
            taggedWhilePartial ? 'SUBBOX_ID appeared before the write finished' : '',
        );

        const drainC = await waitForDrain(page, { label: 'C', since: dribbleStart });
        const evsC = (await events(page)).filter((e) => e.t > dribbleStart);
        const burstsC = uploadBursts(evsC);
        const dribbleEvents = evsC.filter(
            (e) => e.phase === 'uploading' && path.basename(e.currentFile || '') === dribbleName,
        );
        check(drainC.drained, 'C2 dribbled file uploaded and drained');
        check(
            burstsC.length === 1,
            'C3 exactly one upload burst for the dribbled file',
            `bursts=${burstsC.length}`,
        );
        check(
            dribbleEvents.length === 1,
            'C4 the dribbled file was uploaded exactly once',
            `${dribbleEvents.length} upload events`,
        );
        if (dribbleEvents.length) {
            const started = dribbleEvents[0].t;
            check(
                started >= dribbleEnd,
                'C5 upload started only after the last byte landed',
                `upload at +${((started - dribbleEnd) / 1000).toFixed(1)}s relative to write end`,
            );
        }
        check(
            fs.statSync(dest).size >= src.length,
            'C6 staged file is complete on disk',
            `${fs.statSync(dest).size} vs source ${src.length}`,
        );
        notes.push(`dribbled file: ${dribbleName} (${src.length} bytes)`);
    }

    // ============ PHASE D — relaunch, server-side presence dedup ============
    console.log('\n=== PHASE D: relaunch and re-watch the same dir ===');
    await stopWatching(page);
    const logsBeforeClose = mainLogs.slice();
    await app.close();
    await new Promise((r) => setTimeout(r, 3000));

    ({ app, mainLogs, page } = await launchApp());
    await startWatching(page);
    const dStart = Date.now();
    // Give it several poll ticks (app default 10s) to scan and decide.
    await page.waitForTimeout(45_000);
    const evsD = (await events(page)).filter((e) => e.t > dStart);
    const burstsD = uploadBursts(evsD);
    const scansD = evsD.filter((e) => e.phase === 'scanning').length;
    console.log(`  ${evsD.length} events, ${scansD} scan ticks, ${burstsD.length} upload bursts`);
    check(scansD >= 2, 'D1 fresh process really polled the dir', `${scansD} scans`);
    check(
        burstsD.length === 0,
        'D2 nothing re-uploaded after relaunch (server presence dedup)',
        burstsD.length ? `re-uploaded ${[...burstsD[0].files].join(', ')}` : 'none',
    );

    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const shot = path.join(SNAPSHOT_DIR, `watch-dedup-guard-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    await stopWatching(page);
    await app.close();

    console.log('\n--- main [Subbox]/error lines ---');
    console.log(
        [...logsBeforeClose, ...mainLogs]
            .filter(
                (l) =>
                    /subbox|upload|EPIPE|ECONNRESET|reject|unhandled|watch|filebrowser/i.test(l) &&
                    !/Autofill|GPUCache|WebGPU|devtools/i.test(l),
            )
            .slice(-40)
            .join('\n') || '(none)',
    );

    console.log('\nRESULT');
    console.log(`  staged files: ${N}${dribbleName ? ' + 1 dribbled' : ''}`);
    console.log(`  screenshot:   ${shot}`);
    for (const n of notes) console.log(`  ${n}`);
    console.log(`\nOVERALL: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(failures.length === 0 ? 0 : 1);
}

// Wait until an 'uploading' burst has been seen and the poller is back to idle.
// `since` scopes the check to events recorded after that timestamp — without it,
// a later phase's call sees an earlier phase's already-idle-after-upload state as
// the "latest" event and returns drained instantly, never actually waiting for
// the current phase's own upload.
async function waitForDrain(page, { label, requireUpload = true, since = 0 }) {
    const deadline = Date.now() + DRAIN_TIMEOUT_MS;
    let sawUploading = false;
    let lastLine = '';
    while (Date.now() < deadline) {
        const evs = (await events(page)).filter((e) => e.t > since);
        const latest = evs[evs.length - 1];
        if (latest) {
            // Scan the whole recorded list, not just the newest event: a small
            // file's 'uploading' event can come and go between two samples.
            if (evs.some((e) => e.phase === 'uploading')) sawUploading = true;
            const line = `phase=${latest.phase} uploaded=${latest.uploaded || 0}/${latest.total || 0}${
                latest.currentFile ? ` file=${path.basename(latest.currentFile)}` : ''
            }`;
            if (line !== lastLine) {
                console.log(`  [${new Date().toISOString().slice(11, 19)}] ${line}`);
                lastLine = line;
            }
            if (sawUploading && latest.phase === 'idle') return { drained: true, sawUploading };
            if (!requireUpload && !sawUploading && latest.phase === 'idle' && evs.length > 3)
                return { drained: true, sawUploading };
        }
        await page.waitForTimeout(1500);
    }
    console.log(`  ${label}: TIMED OUT waiting to drain`);
    return { drained: false, sawUploading };
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
