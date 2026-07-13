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

// Combined driver: a LARGE watch-dir upload and a LARGE playlist download in the
// SAME main process, overlapping in time. Proves the two workflows coexist
// without breaking each other (change C coordination in
// src/main/features/core/sync/index.ts):
//   - the upload poll drains a big batch of new files (scan -> tag -> presence ->
//     upload) to filebrowser, AND
//   - a download fired while that upload is in flight resolves cleanly
//     (tracksExported set, no hang / EPIPE / ECONNRESET), because the download
//     sets `watchPaused` and awaits the in-flight poll before streaming.
//
// Both must finish: the upload drains to `idle` with every missing file uploaded,
// and the download promise resolves with a numeric tracksExported.
//
// Env:
//   QA_APP_ENTRY     out/main/index.js to launch. Point at ../feishin/out/main/index.js.
//   QA_SOURCE_DIR    REQUIRED. Dir of audio files to stage & upload (recursed).
//   QA_UPLOAD_LIMIT  Max files to stage/upload (default 500).
//   QA_PLAYLIST      Download target: name(s) comma-sep, or __ALL__ (default __ALL__).
//   QA_POLL_MS       Watch poll interval ms (default 1500).
//   QA_FIRE_AFTER    Fire the download once this many files have uploaded (default 25).
//   QA_UPLOAD_TIMEOUT_MS  Cap waiting for the upload to drain (default 900000 = 15m).
//
// NB writes real files to the logged-in dev user's container. Local dev only.

const MAIN_ENTRY = resolveAppEntry();
const SOURCE_DIR = process.env.QA_SOURCE_DIR;
const UPLOAD_LIMIT = process.env.QA_UPLOAD_LIMIT ? Number(process.env.QA_UPLOAD_LIMIT) : 500;
const UPLOAD_OFFSET = Number(process.env.QA_UPLOAD_OFFSET) || 0; // skip the first N (already-uploaded) files
const POLL_INTERVAL_MS = Number(process.env.QA_POLL_MS) || 1500;
const FIRE_AFTER = Number(process.env.QA_FIRE_AFTER) || 25;
const UPLOAD_TIMEOUT_MS = Number(process.env.QA_UPLOAD_TIMEOUT_MS) || 900_000;

const PYMIX_URL = 'https://pymix.docker.localhost';
const FILEBROWSER_URL = 'https://browser.docker.localhost/browser';

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

function stageWatchDir() {
    if (!SOURCE_DIR) throw new Error('QA_SOURCE_DIR is required');
    const resolvedSource = path.resolve(SOURCE_DIR);
    const all = gatherAudioFiles(resolvedSource).sort();
    if (all.length === 0) throw new Error(`No audio files under ${resolvedSource}`);
    const chosen = all.slice(UPLOAD_OFFSET, UPLOAD_OFFSET + UPLOAD_LIMIT);
    const watchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subbox-updl-'));
    for (const src of chosen) {
        const rel = path.relative(resolvedSource, src);
        const dest = path.join(watchDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest); // copy — leave originals pristine
    }
    return { copied: chosen.length, found: all.length, source: resolvedSource, watchDir };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const { copied, found, source, watchDir } = stageWatchDir();
    console.log('app entry:  ', MAIN_ENTRY);
    console.log('source dir: ', source, `(${found} audio files found)`);
    console.log('staging dir:', watchDir, `(${copied} staged, limit ${UPLOAD_LIMIT})`);
    console.log(
        `config: poll=${POLL_INTERVAL_MS}ms fireAfter=${FIRE_AFTER} playlists="${process.env.QA_PLAYLIST || '__ALL__'}"`,
    );

    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });

    const mainLogs = [];
    electronApp.process().stdout.on('data', (d) => mainLogs.push(`[main] ${d}`.trimEnd()));
    electronApp.process().stderr.on('data', (d) => mainLogs.push(`[main:err] ${d}`.trimEnd()));

    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });
    page.on('pageerror', (e) => mainLogs.push(`[pageerror] ${e.message}`));

    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(1000);

    const server = await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('store_authentication')).state.currentServer;
        return {
            credential: s.credential,
            fbToken: s.fbToken ?? '',
            id: s.id,
            url: s.url,
            username: s.username,
        };
    });
    console.log('server:     ', server.username, server.id);

    // Playlist name->id map (in-page fetch trusts the dev cert).
    const playlists = await page.evaluate(async ({ credential, url }) => {
        const res = await fetch(
            `${url}/rest/getPlaylists.view?${credential}&v=1.16.1&c=subbox&f=json`,
        );
        const j = await res.json();
        return (j['subsonic-response']?.playlists?.playlist ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            songCount: p.songCount,
        }));
    }, server);

    const sel = process.env.QA_PLAYLIST || '__ALL__';
    const chosen =
        sel === '__ALL__'
            ? playlists.filter((p) => p.songCount > 0)
            : playlists.filter((p) =>
                  sel
                      .split(',')
                      .map((s) => s.trim())
                      .includes(p.name),
              );
    const playlistIds = chosen.map((p) => p.id);
    const totalPlaylistTracks = chosen.reduce((n, p) => n + (p.songCount || 0), 0);
    console.log(
        'download target:',
        chosen.map((p) => `${p.name}(${p.songCount})`).join(', '),
        `= ${totalPlaylistTracks} track-slots`,
    );
    if (playlistIds.length === 0) {
        console.log('no playlists chosen; aborting');
        await electronApp.close();
        process.exit(1);
    }

    // Bootstrap the pymix session the way a real user does: run Preview Download
    // once through the UI (without it POST /sync/playlists has no session). Do this
    // BEFORE starting the watcher so the (fast) upload does not drain during the
    // bootstrap — we want the download fired while the upload is still in flight.
    const syncToggle = page.getByText('Sync', { exact: true }).first();
    if (await syncToggle.isVisible().catch(() => false)) {
        await syncToggle.click();
        await page.waitForTimeout(800);
    }
    const downloadTab = page.getByText('Download', { exact: true }).first();
    if (await downloadTab.isVisible().catch(() => false)) {
        await downloadTab.click();
        await page.waitForTimeout(800);
    }
    const firstRow = page.getByText(chosen[0].name, { exact: true }).first();
    if (await firstRow.isVisible().catch(() => false)) {
        await firstRow.click();
        await page.waitForTimeout(300);
    }
    const previewButton = page.getByRole('button', { name: /^preview download$/i });
    if (await previewButton.isEnabled().catch(() => false)) {
        await previewButton.click();
        await page
            .getByText('Generating sync plan', { exact: false })
            .first()
            .waitFor({ state: 'hidden', timeout: 120_000 })
            .catch((e) => console.log('still generating after 120s:', e.message));
        console.log('preview complete — pymix session established');
    } else {
        console.log('WARNING: preview button not enabled; session may not bootstrap');
    }

    // Record watch-progress + start the watcher on the 500-file staging dir.
    // FIRE-AND-FORGET: sync:start-watch `await`s its first poll before resolving,
    // so returning that promise here would block until the whole upload drained.
    // We kick it off inside the renderer and let progress events flow while we
    // fire the download mid-upload.
    await page.evaluate(
        ({ pollIntervalMs, server, watchDir }) => {
            window.__watchEvents = [];
            window.api.ipc.on('sync:watch-progress', (_e, prog) => {
                window.__watchEvents.push({ t: Date.now(), ...prog });
            });
            window.api.ipc.invoke('sync:start-watch', {
                filebrowserToken: server.fbToken,
                filebrowserUrl: 'https://browser.docker.localhost/browser',
                pollIntervalMs,
                pymixUrl: 'https://pymix.docker.localhost',
                serverId: server.id,
                username: server.username,
                watchDir,
            });
            // deliberately not returned — do not await the first poll here
        },
        { pollIntervalMs: POLL_INTERVAL_MS, server, watchDir },
    );
    console.log('watcher started — uploading the staged batch...');

    // Wait until the upload is genuinely in flight (>= FIRE_AFTER files uploaded),
    // so the download is fired DURING an active upload.
    const fireDeadline = Date.now() + 120_000;
    let uploadedAtFire = 0;
    let uploadTotal = 0;
    while (Date.now() < fireDeadline) {
        const st = await page.evaluate(() => {
            const evs = window.__watchEvents;
            const latest = evs[evs.length - 1] || {};
            return {
                idle: latest.phase === 'idle',
                maxUploaded: Math.max(0, ...evs.map((e) => e.uploaded || 0)),
                n: evs.length,
                phase: latest.phase,
                total: latest.total || 0,
            };
        });
        uploadedAtFire = st.maxUploaded;
        uploadTotal = st.total;
        if (st.maxUploaded >= FIRE_AFTER) break;
        // If the whole batch was already present server-side it goes straight to idle.
        if (st.idle && st.n > 2 && st.maxUploaded === 0) {
            console.log('WARNING: nothing to upload (batch already present server-side)');
            break;
        }
        await sleep(400);
    }
    console.log(
        `upload in flight: ${uploadedAtFire}/${uploadTotal} uploaded — firing download now`,
    );

    // Fire the LARGE download concurrently and time its promise lifetime.
    const downloadStart = Date.now();
    let dl;
    try {
        const result = await page.evaluate(
            (args) => window.api.ipc.invoke('sync:download-playlists', args),
            {
                filebrowserToken: server.fbToken,
                filebrowserUrl: FILEBROWSER_URL,
                includeRekordboxXml: false,
                playlistIds,
                pymixUrl: PYMIX_URL,
                rekordboxXmlDir: '',
                serverId: server.id,
                username: server.username,
            },
        );
        dl = { ok: true, result };
    } catch (err) {
        dl = { err: String(err), ok: false };
    }
    const downloadEnd = Date.now();
    const downloadOk = dl.ok === true;
    const tracksExported = dl.result?.tracksExported;
    const uploadedAtDownloadEnd = await page.evaluate(() =>
        Math.max(0, ...window.__watchEvents.map((e) => e.uploaded || 0)),
    );
    console.log(
        `download window: ${((downloadEnd - downloadStart) / 1000).toFixed(1)}s ok=${downloadOk} ` +
            `tracksExported=${tracksExported}${dl.err ? ' err=' + dl.err : ''} ` +
            `(upload progressed ${uploadedAtFire}->${uploadedAtDownloadEnd} across the window)`,
    );

    // Wait for the upload to fully drain to idle.
    const upDeadline = Date.now() + UPLOAD_TIMEOUT_MS;
    let drained = false;
    let sawUploading = uploadedAtFire > 0;
    while (Date.now() < upDeadline) {
        const st = await page.evaluate(() => {
            const evs = window.__watchEvents;
            const latest = evs[evs.length - 1] || {};
            return {
                maxUploaded: Math.max(0, ...evs.map((e) => e.uploaded || 0)),
                phase: latest.phase,
                sawError: evs.some((e) => e.phase === 'error'),
                sawUploading: evs.some((e) => e.phase === 'uploading'),
                total: latest.total || 0,
            };
        });
        sawUploading = sawUploading || st.sawUploading;
        if (st.phase === 'idle' && sawUploading) {
            drained = true;
            break;
        }
        if (st.phase === 'idle' && !sawUploading) {
            // nothing was ever uploaded (all deduped) — treat as drained
            drained = true;
            break;
        }
        await sleep(POLL_INTERVAL_MS);
    }

    const allEvents = await page.evaluate(() => window.__watchEvents.slice());
    const finalUploaded = Math.max(0, ...allEvents.map((e) => e.uploaded || 0));
    const finalTotal = Math.max(0, ...allEvents.map((e) => e.total || 0));
    const sawError = allEvents.some((e) => e.phase === 'error');

    await page.evaluate(() => window.api.ipc.invoke('sync:stop-watch')).catch(() => {});

    // Timeline around the download window.
    const active = (e) => e.phase === 'scanning' || e.phase === 'uploading';
    const duringDownload = allEvents.filter(
        (e) => e.t >= downloadStart && e.t <= downloadEnd && active(e),
    );
    const afterDownload = allEvents.filter((e) => e.t > downloadEnd && active(e));

    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const shot = path.join(SNAPSHOT_DIR, `upload-download-concurrency-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => {});

    console.log('\n--- watch-progress summary ---');
    console.log(
        `  events: ${allEvents.length}, uploaded ${finalUploaded}/${finalTotal}, error phase: ${sawError}`,
    );
    console.log(`  active watch ticks inside download window: ${duringDownload.length}`);
    console.log(`  active watch ticks after download window:  ${afterDownload.length}`);

    console.log('\n--- main [Subbox]/error lines ---');
    const badLines = mainLogs.filter(
        (l) =>
            /EPIPE|ECONNRESET|unhandled|Watch poll error|Failed to upload|hang/i.test(l) &&
            !/Autofill|GPUCache|WebGPU/i.test(l),
    );
    console.log(badLines.slice(-30).join('\n') || '(no upload/download stream errors)');

    // Assertions
    const passDownload = downloadOk && typeof tracksExported === 'number';
    const passUploadDrained =
        drained && finalUploaded === finalTotal && finalUploaded > 0 && !sawError;
    const passOverlap = uploadedAtFire > 0 && uploadedAtFire < finalTotal; // download fired mid-upload
    const passNoStreamErr = badLines.length === 0;

    console.log('\nRESULT:');
    console.log(
        `  [${passUploadDrained ? 'PASS' : 'FAIL'}] upload drained fully (${finalUploaded}/${finalTotal} uploaded, reached idle, no error phase)`,
    );
    console.log(
        `  [${passDownload ? 'PASS' : 'FAIL'}] large download completed cleanly (resolved, tracksExported=${tracksExported})`,
    );
    console.log(
        `  [${passOverlap ? 'PASS' : 'FAIL'}] download was fired mid-upload (upload at ${uploadedAtFire}/${finalTotal} when download started)`,
    );
    console.log(
        `  [${passNoStreamErr ? 'PASS' : 'FAIL'}] no EPIPE/ECONNRESET/unhandled/upload-fail in main logs`,
    );
    console.log(`  screenshot: ${shot}`);

    await electronApp.close();
    try {
        fs.rmSync(watchDir, { force: true, recursive: true });
    } catch {
        /* best-effort cleanup */
    }

    const allPass = passUploadDrained && passDownload && passOverlap && passNoStreamErr;
    console.log(`\nOVERALL: ${allPass ? 'PASS' : 'FAIL'}`);
    process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
