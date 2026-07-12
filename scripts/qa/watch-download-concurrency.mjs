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

// Regression driver for the "watch-dir upload must not disrupt an in-progress
// download" coordination in src/main/features/core/sync/index.ts.
//
// Background: the watch-dir uploader (`sync:start-watch`) and the playlist
// download (`sync:download-playlists`) are two IPC handlers in the SAME main
// process. Concurrent uploads to the same filebrowser host used to reset the
// download stream mid-transfer; with the old hand-rolled `.pipe()` a source
// error left the download Promise permanently unsettled — the whole download UI
// hung. The fix:
//   1. a module-level `watchPaused` flag the download sets (awaiting any
//      in-flight poll first) and clears in a `finally`; the poller early-returns
//      while it is set, so uploads are DEFERRED for the duration of a download;
//   2. `stream.pipeline` instead of `.pipe()`, so a mid-download source error
//      rejects the Promise instead of hanging.
//
// What this driver proves, end to end:
//   - start the watcher on a folder holding a track (so the poller actively
//     ticks and *wants* to do work), warm it up, then fire a REAL download;
//   - time the download by awaiting the `sync:download-playlists` IPC promise
//     from node (its resolve == the moment the `finally` clears `watchPaused`).
//     NB you cannot monkeypatch window.api.ipc — contextBridge objects are
//     immutable; invoking through the bridge is fine, so we drive it directly;
//   - assert: (a) the download resolves cleanly (no hang, returns
//     tracksExported), (b) ZERO watch scan/upload ticks land inside
//     [downloadStart, downloadEnd] even though several polls would normally fire
//     (proves the pause), (c) the watcher resumes after (proves the finally ran).
//
// The pymix session cookie POST /sync/playlists needs is bootstrapped the way a
// real user does it: by running "Preview Download" once through the UI first.
//
// Env:
//   QA_APP_ENTRY  path to out/main/index.js to launch (resolveAppEntry, shared by
//                 every QA driver). Default: this worktree's build. Point it at
//                 ../feishin/out/main/index.js to test an UNCOMMITTED fix in the
//                 main checkout before it lands here.
//   QA_PLAYLIST   playlist name(s), comma-sep, or __ALL__ (default "Kodzo").
//                 __ALL__ + an emptied library is the "large download" scenario.
//   QA_POLL_MS    watch poll interval in ms (default 800).
//   QA_RB_XML=1   also do the Rekordbox XML export/download (default off — the
//                 XML is a second filebrowser download unrelated to this fix).
//
// Usage:
//   node scripts/qa/watch-download-concurrency.mjs
//   QA_APP_ENTRY=../feishin/out/main/index.js QA_PLAYLIST=__ALL__ \
//     node scripts/qa/watch-download-concurrency.mjs
//
// For the "large amount of missing tracks" window, empty the dev library first
// (BACK IT UP), e.g.:
//   D="$HOME/Library/Application Support/subbox-dev"; cp -a "$D/music" /tmp/mbk
//   rm -rf "$D/music"/*     # ... run with QA_PLAYLIST=__ALL__ ...
//   rm -rf "$D/music"; cp -a /tmp/mbk "$D/music"   # restore

const MAIN_ENTRY = resolveAppEntry();
const POLL_INTERVAL_MS = Number(process.env.QA_POLL_MS) || 800;
const INCLUDE_RB_XML = process.env.QA_RB_XML === '1';

const PYMIX_URL = 'https://pymix.docker.localhost';
const FILEBROWSER_URL = 'https://browser.docker.localhost/browser';

// A track already present in the dev local library, copied into the watch dir so
// the poller has real work to scan. It is already server-present, so no new
// import is triggered — we only need the poller to actively run concurrently.
const SEED_TRACK = path.join(
    os.homedir(),
    'Library/Application Support/subbox-dev/music',
    "Pat Martino/Live at Yoshi's/01 - Pat Martino - Oleo.mp3",
);

const credentials = getCredentials();

function setupWatchDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subbox-watch-'));
    if (fs.existsSync(SEED_TRACK)) fs.copyFileSync(SEED_TRACK, path.join(dir, 'watch-oleo.mp3'));
    else console.warn('seed track missing, watch dir empty:', SEED_TRACK);
    return dir;
}

async function main() {
    const watchDir = setupWatchDir();
    console.log('app entry:', MAIN_ENTRY);
    console.log('watch dir:', watchDir, '->', fs.readdirSync(watchDir));
    console.log(`config: poll=${POLL_INTERVAL_MS}ms rbXml=${INCLUDE_RB_XML} playlists="${process.env.QA_PLAYLIST || 'Kodzo'}"`);

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
    const pageLogs = [];
    page.on('console', (m) => pageLogs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => pageLogs.push(`[pageerror] ${e.message}`));

    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(1000);

    const server = await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('store_authentication')).state.currentServer;
        return { credential: s.credential, fbToken: s.fbToken ?? '', id: s.id, url: s.url, username: s.username };
    });
    console.log('server:', server.username, server.id);

    // Playlist name->id map via Subsonic (in-page fetch trusts the dev cert).
    const playlists = await page.evaluate(async ({ credential, url }) => {
        const res = await fetch(`${url}/rest/getPlaylists.view?${credential}&v=1.16.1&c=subbox&f=json`);
        const j = await res.json();
        return (j['subsonic-response']?.playlists?.playlist ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            songCount: p.songCount,
        }));
    }, server);

    const sel = process.env.QA_PLAYLIST || 'Kodzo';
    const chosen =
        sel === '__ALL__'
            ? playlists.filter((p) => p.songCount > 0)
            : playlists.filter((p) => sel.split(',').map((s) => s.trim()).includes(p.name));
    const playlistIds = chosen.map((p) => p.id);
    console.log('downloading:', chosen.map((p) => `${p.name}(${p.songCount})`).join(', '));
    if (playlistIds.length === 0) {
        console.log('no playlists chosen; aborting');
        await electronApp.close();
        process.exit(1);
    }

    // Recorder + start the watcher (short poll).
    await page.evaluate(
        ({ pollIntervalMs, server, watchDir }) => {
            window.__watchEvents = [];
            window.api.ipc.on('sync:watch-progress', (_e, prog) => {
                window.__watchEvents.push({ t: Date.now(), ...prog });
            });
            return window.api.ipc.invoke('sync:start-watch', {
                filebrowserToken: server.fbToken,
                filebrowserUrl: 'https://browser.docker.localhost/browser',
                pollIntervalMs,
                pymixUrl: 'https://pymix.docker.localhost',
                serverId: server.id,
                username: server.username,
                watchDir,
            });
        },
        { pollIntervalMs: POLL_INTERVAL_MS, server, watchDir },
    );

    // Bootstrap the pymix session the way a real user does — run Preview Download
    // once through the UI. Without it, POST /sync/playlists has no session and
    // pymix rejects ("Must have a username or session ID to identify user").
    const syncToggle = page.getByText('Sync', { exact: true }).first();
    if (await syncToggle.isVisible().catch(() => false)) { await syncToggle.click(); await page.waitForTimeout(800); }
    const downloadTab = page.getByText('Download', { exact: true }).first();
    if (await downloadTab.isVisible().catch(() => false)) { await downloadTab.click(); await page.waitForTimeout(800); }
    const firstRow = page.getByText(chosen[0].name, { exact: true }).first();
    if (await firstRow.isVisible().catch(() => false)) { await firstRow.click(); await page.waitForTimeout(300); }
    const previewButton = page.getByRole('button', { name: /^preview download$/i });
    if (await previewButton.isEnabled().catch(() => false)) {
        await previewButton.click();
        await page.getByText('Generating sync plan', { exact: false }).first()
            .waitFor({ state: 'hidden', timeout: 60_000 })
            .catch((e) => console.log('still generating after 60s:', e.message));
        console.log('preview complete — pymix session established');
    } else {
        console.log('WARNING: preview button not enabled; session may not bootstrap');
    }

    // Warm up so we can confirm the watcher is alive and ticking before download.
    await page.waitForTimeout(POLL_INTERVAL_MS * 3);
    const pre = await page.evaluate(() => window.__watchEvents.slice());
    console.log('watch ticks before download:', pre.length, `[${pre.map((e) => e.phase).join(',')}]`);

    // Fire the download via IPC and time the exact promise lifetime.
    const downloadStart = Date.now();
    let dl;
    try {
        const result = await page.evaluate(
            (args) => window.api.ipc.invoke('sync:download-playlists', args),
            {
                filebrowserToken: server.fbToken,
                filebrowserUrl: FILEBROWSER_URL,
                includeRekordboxXml: INCLUDE_RB_XML,
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
    console.log(`download IPC window: ${((downloadEnd - downloadStart) / 1000).toFixed(1)}s ok=${downloadOk} tracksExported=${tracksExported}${dl.err ? ' err=' + dl.err : ''}`);

    // Let the watcher resume for a couple ticks post-download.
    await page.waitForTimeout(POLL_INTERVAL_MS * 3);
    const allEvents = await page.evaluate(() => window.__watchEvents.slice());
    await page.evaluate(() => window.api.ipc.invoke('sync:stop-watch')).catch(() => {});

    const active = (e) => e.phase === 'scanning' || e.phase === 'uploading';
    const duringDownload = allEvents.filter((e) => e.t >= downloadStart && e.t <= downloadEnd && active(e));
    const afterDownload = allEvents.filter((e) => e.t > downloadEnd);
    const windowTicksExpected = Math.floor((downloadEnd - downloadStart) / POLL_INTERVAL_MS);

    console.log('\n--- watch-progress timeline (rel ms to download start) ---');
    for (const e of allEvents) {
        const rel = e.t - downloadStart;
        const marker = rel >= 0 && e.t <= downloadEnd ? '  <-- DURING DOWNLOAD' : '';
        console.log(`  t+${rel}ms phase=${e.phase} file=${e.currentFile || ''}${marker}`);
    }
    console.log('--- end timeline ---\n');

    const passClean = downloadOk && typeof tracksExported === 'number';
    const passPaused = duringDownload.length === 0;
    const passResumed = afterDownload.length > 0;

    console.log('RESULT:');
    console.log(`  [${passClean ? 'PASS' : 'FAIL'}] download completed cleanly (resolved, tracksExported=${tracksExported})`);
    console.log(`  [${passPaused ? 'PASS' : 'FAIL'}] watcher did NO scan/upload work during download (${duringDownload.length} active ticks; ~${windowTicksExpected} poll(s) would normally fire in this window)`);
    console.log(`  [${passResumed ? 'PASS' : 'FAIL'}] watcher resumed after download (${afterDownload.length} ticks after)`);

    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const shot = path.join(SNAPSHOT_DIR, `watch-download-concurrency-${Date.now()}.png`);
    await page.screenshot({ path: shot });
    console.log('screenshot:', shot);

    console.log('\n--- main [Subbox]/error lines ---');
    console.log(mainLogs.filter((l) => /subbox|EPIPE|ECONNRESET|reject|unhandled|hang|watch poll/i.test(l) && !/Autofill|GPUCache|WebGPU/i.test(l)).join('\n') || '(none)');

    await electronApp.close();
    try { fs.rmSync(watchDir, { recursive: true, force: true }); } catch {}

    const allPass = passClean && passPaused && passResumed;
    console.log(`\nOVERALL: ${allPass ? 'PASS' : 'FAIL'}`);
    process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
