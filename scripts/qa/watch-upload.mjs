import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';

import {
    getCredentials,
    isLoggedOut,
    performLogin,
    resolveAppEntry,
    SNAPSHOT_DIR,
} from '../ui-snapshot-shared.mjs';

// Exerciser: upload music into the dev Subbox library through the real UI + the
// watch-dir uploader (Sync -> Watch), pointed at a source directory of audio
// files. Files are COPIED into a throwaway staging watch dir first, so the
// originals are never touched (the watcher tags each file it sees with a
// SUBBOX_ID *in place* — see getOrCreateSubboxId in
// subbox-app/src/main/features/core/sync/index.ts, so we never let it near the
// source).
//
// It drives the genuine UI path a user takes:
//   1. sidebar "Sync" -> "Watch" tab,
//   2. "Select Directory" — the native folder picker
//      (sync:select-watch-directory -> dialog.showOpenDialog) is stubbed in the
//      MAIN process to return our staging dir, so the real button works headless,
//   3. "Start Watching" — the real handleStartWatch, using the app's own url
//      config (pymix.docker.localhost / filebrowser) and server credentials.
// Then it records sync:watch-progress and waits for the uploader to drain
// (uploading -> idle) before stopping the watcher.
//
// NB uploads land in the logged-in user's per-user container (filebrowser ->
// pymix import -> Navidrome). This WRITES to a live dev user. Local dev stack
// only; never point QA_APP_ENTRY at a staging/prod build.
//
// The watcher only reports upload progress up to the filebrowser hand-off. The
// files then flow through pymix's async import + a Navidrome rescan before they
// appear in the library UI — that lag is expected and NOT covered here.
//
// Env:
//   QA_SOURCE_DIR      REQUIRED. Directory of audio files to upload (recursed).
//   QA_UPLOAD_LIMIT    Max files to copy/upload (default: all found).
//   QA_APP_ENTRY       out/main/index.js to launch (resolveAppEntry, shared by
//                      every driver). Default: this worktree's build. Point at
//                      ../feishin/out/main/index.js to drive an uncommitted build.
//   QA_POLL_MS         Watch poll interval in ms (default 2000; the app default
//                      is 10000 — we poll faster for quicker feedback).
//   QA_WATCH_DIR       Explicit staging dir to copy into (default: a fresh
//                      mkdtemp under the OS temp dir).
//   QA_KEEP_WATCH_DIR  If set, do NOT delete the staging dir on exit (inspect it).
//   QA_UPLOAD_TIMEOUT_MS  Overall cap waiting for the uploader to drain
//                      (default 1_200_000 = 20 min).
//
// Usage:
//   QA_SOURCE_DIR="$HOME/Library/Application Support/subbox/music" \
//   QA_UPLOAD_LIMIT=500 QA_APP_ENTRY=../feishin/out/main/index.js \
//     node scripts/qa/watch-upload.mjs

const AUDIO_EXTENSIONS = new Set([
    '.aac',
    '.flac',
    '.m4a',
    '.mp3',
    '.ogg',
    '.opus',
    '.wav',
    '.wma',
]);

const MAIN_ENTRY = resolveAppEntry();
const SOURCE_DIR = process.env.QA_SOURCE_DIR;
const UPLOAD_LIMIT = process.env.QA_UPLOAD_LIMIT ? Number(process.env.QA_UPLOAD_LIMIT) : Infinity;
const POLL_INTERVAL_MS = Number(process.env.QA_POLL_MS) || 2000;
const KEEP_WATCH_DIR = !!process.env.QA_KEEP_WATCH_DIR;
const UPLOAD_TIMEOUT_MS = Number(process.env.QA_UPLOAD_TIMEOUT_MS) || 1_200_000;

const credentials = getCredentials();

function gatherAudioFiles(dir, out = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) gatherAudioFiles(full, out);
        else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
            out.push(full);
    }
    return out;
}

// Copy up to UPLOAD_LIMIT audio files from SOURCE_DIR into a throwaway staging
// dir, preserving each file's path relative to the source root. Returns the
// staging dir and how many files were copied. Originals are never modified.
function stageWatchDir() {
    if (!SOURCE_DIR) throw new Error('QA_SOURCE_DIR is required');
    const resolvedSource = path.resolve(SOURCE_DIR);
    if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isDirectory())
        throw new Error(`QA_SOURCE_DIR is not a directory: ${resolvedSource}`);

    const all = gatherAudioFiles(resolvedSource).sort();
    if (all.length === 0) throw new Error(`No audio files found under ${resolvedSource}`);
    const chosen = all.slice(0, UPLOAD_LIMIT);

    const watchDir =
        process.env.QA_WATCH_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'subbox-upload-'));
    fs.mkdirSync(watchDir, { recursive: true });

    for (const src of chosen) {
        const rel = path.relative(resolvedSource, src);
        const dest = path.join(watchDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest); // copy, never move — leave originals pristine
    }
    return { copied: chosen.length, found: all.length, source: resolvedSource, watchDir };
}

async function main() {
    const { copied, found, source, watchDir } = stageWatchDir();
    console.log('app entry:  ', MAIN_ENTRY);
    console.log('source dir: ', source, `(${found} audio files found)`);
    console.log('staging dir:', watchDir, `(${copied} copied${UPLOAD_LIMIT !== Infinity ? `, limit ${UPLOAD_LIMIT}` : ''})`);
    console.log(`config: poll=${POLL_INTERVAL_MS}ms timeout=${(UPLOAD_TIMEOUT_MS / 1000).toFixed(0)}s`);

    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });

    const mainLogs = [];
    electronApp.process().stdout.on('data', (d) => mainLogs.push(`[main] ${d}`.trimEnd()));
    electronApp.process().stderr.on('data', (d) => mainLogs.push(`[main:err] ${d}`.trimEnd()));

    // Stub the native folder picker in the MAIN process so the real "Select
    // Directory" button resolves to our staging dir instead of opening a dialog.
    await electronApp.evaluate(async ({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, watchDir);

    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });
    const pageLogs = [];
    page.on('console', (m) => pageLogs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => pageLogs.push(`[pageerror] ${e.message}`));

    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(1000);

    const server = await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('store_authentication')).state.currentServer;
        return { id: s.id, url: s.url, username: s.username };
    });
    console.log('server:     ', server.username, server.id);

    // Record every watch-progress event for reporting + completion detection.
    await page.evaluate(() => {
        window.__watchEvents = [];
        window.api.ipc.on('sync:watch-progress', (_e, prog) => {
            window.__watchEvents.push({ t: Date.now(), ...prog });
        });
    });

    // --- Drive the real UI: Sync -> Watch -> Select Directory -> Start Watching ---
    const syncToggle = page.getByText('Sync', { exact: true }).first();
    if (await syncToggle.isVisible().catch(() => false)) {
        await syncToggle.click();
        await page.waitForTimeout(800);
    }
    const watchTab = page.getByRole('button', { name: /^watch$/i }).first();
    await watchTab.click();
    await page.waitForTimeout(500);

    const selectBtn = page.getByRole('button', { name: /select directory|change directory/i }).first();
    await selectBtn.click();
    // The stubbed dialog resolves immediately; the chosen path renders as text.
    await page.getByText(watchDir, { exact: false }).first().waitFor({ timeout: 10_000 });
    console.log('watch dir selected in UI ✓');

    const startBtn = page.getByRole('button', { name: /^start watching$/i }).first();
    await startBtn.click();
    console.log('clicked Start Watching — uploader is live (app default 10s poll;');
    console.log('the first tick scans and uploads the whole batch in one pass)');

    // --- Wait for the uploader to drain: an 'uploading' burst then back to 'idle' ---
    // The watcher's own poll interval (app default 10s) governs when the first scan
    // fires; QA_POLL_MS below is only how often WE sample window.__watchEvents.
    const deadline = Date.now() + UPLOAD_TIMEOUT_MS;
    let sawUploading = false;
    let lastUploaded = -1;
    let lastLog = 0;
    while (Date.now() < deadline) {
        const events = await page.evaluate(() => window.__watchEvents.slice());
        const latest = events[events.length - 1];
        if (latest) {
            if (latest.phase === 'uploading') sawUploading = true;
            const maxUploaded = Math.max(0, ...events.map((e) => e.uploaded || 0));
            if (maxUploaded !== lastUploaded || Date.now() - lastLog > 15_000) {
                console.log(
                    `  [${new Date().toISOString().slice(11, 19)}] phase=${latest.phase} ` +
                        `uploaded=${maxUploaded}/${latest.total || 0}` +
                        (latest.currentFile ? ` file=${path.basename(latest.currentFile)}` : ''),
                );
                lastUploaded = maxUploaded;
                lastLog = Date.now();
            }
            // Done: we've seen uploads happen and the poller has returned to idle.
            if (sawUploading && latest.phase === 'idle') break;
            // Also done if nothing needed uploading at all (all already present).
            if (!sawUploading && latest.phase === 'idle' && events.length > 3) {
                console.log('  nothing to upload — files already present server-side');
                break;
            }
            if (latest.phase === 'error') {
                console.log('  ERROR phase reported:', latest.currentFile);
            }
        }
        await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    const allEvents = await page.evaluate(() => window.__watchEvents.slice());
    const uploadedTotal = Math.max(0, ...allEvents.map((e) => e.uploaded || 0));
    const timedOut = Date.now() >= deadline;

    await page.evaluate(() => window.api.ipc.invoke('sync:stop-watch')).catch(() => {});
    // Click Stop Watching too, so the UI state matches.
    const stopBtn = page.getByRole('button', { name: /^stop watching$/i }).first();
    if (await stopBtn.isVisible().catch(() => false)) await stopBtn.click().catch(() => {});

    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const shot = path.join(SNAPSHOT_DIR, `watch-upload-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => {});

    console.log('\n--- main [Subbox]/error lines ---');
    console.log(
        mainLogs
            .filter(
                (l) =>
                    /subbox|upload|EPIPE|ECONNRESET|reject|unhandled|watch|filebrowser/i.test(l) &&
                    !/Autofill|GPUCache|WebGPU/i.test(l),
            )
            .slice(-40)
            .join('\n') || '(none)',
    );

    console.log('\nRESULT:');
    console.log(`  copied to watch dir: ${copied}`);
    console.log(`  uploader reported uploaded: ${uploadedTotal}`);
    console.log(`  drained cleanly: ${!timedOut ? 'yes' : 'NO (timed out)'}`);
    console.log(`  screenshot: ${shot}`);
    console.log(
        '\n  NB uploads now flow through pymix import + a Navidrome rescan before ' +
            'appearing in the library UI — that lag is asynchronous and not tracked here.',
    );

    await electronApp.close();
    if (!KEEP_WATCH_DIR) {
        try {
            fs.rmSync(watchDir, { recursive: true, force: true });
        } catch {}
    } else {
        console.log('  staging dir kept:', watchDir);
    }

    // Success = the uploader ran to completion without timing out. uploadedTotal
    // may be < copied when some tracks were already present server-side (deduped).
    const ok = !timedOut;
    console.log(`\nOVERALL: ${ok ? 'DONE' : 'TIMED OUT'}`);
    process.exit(ok ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
