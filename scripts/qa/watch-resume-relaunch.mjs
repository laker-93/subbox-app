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

// Regression: after Start Watching -> quit -> relaunch, the app must genuinely
// RE-ARM the watcher, not merely restore the cosmetic "Stop Watching" flag while
// no watcher runs. The auto-resume lives at app boot in app.tsx
// (src/renderer/app.tsx "Auto-resume watch directory on app launch"): it reads
// the persisted watch_active/watch_directory and re-invokes sync:start-watch as
// soon as currentServer.fbToken is hydrated — independent of whether the user
// visits Sync->Watch. This test guards that behaviour (it was mis-reported as
// broken in subbox-app #23, which only inspected sync-watch.tsx and missed the
// app.tsx restore).
//
// The proof is pollution-free: the watch dir is left EMPTY, so no files are ever
// uploaded. The watcher's very first action on (re)start is an immediate poll
// that emits a `scanning` progress event (sync/index.ts runPoll before the
// interval). So on relaunch we expect >=1 sync:watch-progress event
// [scanning,idle] to arrive — even BEFORE navigating to Sync->Watch, since the
// boot restore fires from app.tsx. Zero events would mean the watcher never
// re-armed (the reported-but-nonexistent bug).
//
// The two launches share the app's real userData dir (same binary + env), so the
// electron-store `watch_active` / `watch_directory` persisted by launch 1
// survives into launch 2 exactly as it does for a real quit/relaunch.
//
// Local dev stack only. QA_APP_ENTRY points at the build to drive (default: this
// worktree's out/main/index.js; set to ../feishin/out/main/index.js for an
// uncommitted main-checkout build).

const MAIN_ENTRY = resolveAppEntry();
const credentials = getCredentials();
const RESUME_TIMEOUT_MS = Number(process.env.QA_RESUME_TIMEOUT_MS) || 25_000;

async function gotoSyncWatch(page) {
    const syncToggle = page.getByText('Sync', { exact: true }).first();
    if (await syncToggle.isVisible().catch(() => false)) {
        await syncToggle.click();
        await page.waitForTimeout(800);
    }
    const watchTab = page.getByRole('button', { name: /^watch$/i }).first();
    await watchTab.click();
    await page.waitForTimeout(500);
}

async function launch(watchDir) {
    const app = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    const mainLogs = [];
    app.process().stdout.on('data', (d) => mainLogs.push(`${d}`.trimEnd()));
    app.process().stderr.on('data', (d) => mainLogs.push(`${d}`.trimEnd()));
    // Stub the native folder picker so "Select Directory" resolves to watchDir.
    await app.evaluate(async ({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, watchDir);
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });
    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(1000);
    return { app, mainLogs, page };
}

async function main() {
    const watchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subbox-resume-'));
    console.log('app entry: ', MAIN_ENTRY);
    console.log('watch dir: ', watchDir, '(kept empty — no uploads)');

    let failed = false;

    // ---- Launch 1: Select Directory + Start Watching (persists watch_active) ----
    {
        const { app, page } = await launch(watchDir);
        await recordWatchEvents(page);
        await gotoSyncWatch(page);

        const selectBtn = page
            .getByRole('button', { name: /select directory|change directory/i })
            .first();
        await selectBtn.click();
        await page.getByText(watchDir, { exact: false }).first().waitFor({ timeout: 10_000 });

        // Reset any stale "watching" state from a prior session so we start clean.
        const staleStop = page.getByRole('button', { name: /^stop watching$/i }).first();
        if (await staleStop.isVisible().catch(() => false)) {
            await staleStop.click();
            await page.waitForTimeout(500);
        }

        console.log('launch 1 main pid:', app.process().pid);
        const startBtn = page.getByRole('button', { name: /^start watching$/i }).first();
        await startBtn.click();
        // The watcher's immediate poll should fire a scanning/idle event.
        await page.waitForTimeout(4000);
        const l1Events = await page.evaluate(() => window.__watchEvents.slice());
        const stopVisible = await page
            .getByRole('button', { name: /^stop watching$/i })
            .first()
            .isVisible()
            .catch(() => false);
        console.log(
            `launch 1: started watching (Stop Watching visible=${stopVisible}), ` +
                `watch-progress events=${l1Events.length} [${[...new Set(l1Events.map((e) => e.phase))].join(',')}]`,
        );
        if (!stopVisible || l1Events.length === 0) {
            console.log('  ! launch 1 did not arm the watcher as expected — cannot test resume');
            failed = true;
        }
        await app.close();
    }

    // ---- Launch 2: relaunch, visit Sync->Watch, DO NOT click Start ----
    {
        const { app, mainLogs, page } = await launch(watchDir);
        console.log('launch 2 main pid:', app.process().pid);
        await recordWatchEvents(page);
        // Probe: BEFORE visiting Sync->Watch, do any watch events arrive?
        await page.waitForTimeout(6000);
        const preNav = await page.evaluate(() => window.__watchEvents.slice());
        console.log(
            `  pre-navigation events: ${preNav.length} [${[...new Set(preNav.map((e) => e.phase))].join(',')}]`,
        );
        await gotoSyncWatch(page);

        // Wait for the re-armed watcher's first poll to emit a progress event.
        const deadline = Date.now() + RESUME_TIMEOUT_MS;
        let events = [];
        while (Date.now() < deadline) {
            events = await page.evaluate(() => window.__watchEvents.slice());
            if (events.length > 0) break;
            await page.waitForTimeout(1000);
        }

        const stopVisible = await page
            .getByRole('button', { name: /^stop watching$/i })
            .first()
            .isVisible()
            .catch(() => false);
        const phases = [...new Set(events.map((e) => e.phase))];

        fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
        const shot = path.join(SNAPSHOT_DIR, `watch-resume-${Date.now()}.png`);
        await page.screenshot({ path: shot }).catch(() => {});

        console.log('\n--- launch 2 (relaunch, no manual Start) ---');
        console.log(`  Stop Watching button visible: ${stopVisible}`);
        console.log(`  watch-progress events: ${events.length} [${phases.join(',')}]`);
        console.log(`  screenshot: ${shot}`);
        const startWatchLog = mainLogs.filter((l) => /watch/i.test(l)).slice(-6);
        if (startWatchLog.length)
            console.log('  main watch logs:\n   ' + startWatchLog.join('\n   '));

        // PASS = the UI shows watching AND the watcher actually re-armed (>=1 poll
        // event). A stale "Stop Watching" with zero events would be the regression
        // (watching UI shown while no watcher runs).
        const rearmed = events.length > 0;
        if (!stopVisible) {
            console.log('  FAIL: relaunch did not restore the watching UI');
            failed = true;
        }
        if (!rearmed) {
            console.log('  FAIL: watcher did NOT re-arm on relaunch (zero poll events)');
            failed = true;
        }
        if (stopVisible && rearmed) {
            console.log('  PASS: watching UI restored AND watcher genuinely re-armed');
        }

        await page.evaluate(() => window.api.ipc.invoke('sync:stop-watch')).catch(() => {});
        await app.close();
    }

    try {
        fs.rmSync(watchDir, { force: true, recursive: true });
    } catch {
        /* best-effort */
    }

    console.log(`\nOVERALL: ${failed ? 'FAIL' : 'PASS'}`);
    process.exit(failed ? 1 : 0);
}

// Attach a fresh watch-progress recorder to window.__watchEvents.
async function recordWatchEvents(page) {
    await page.evaluate(() => {
        window.__watchEvents = [];
        window.api.ipc.on('sync:watch-progress', (_e, prog) => {
            window.__watchEvents.push({ t: Date.now(), ...prog });
        });
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
