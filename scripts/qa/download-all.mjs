import path from 'path';
import { _electron as electron } from 'playwright';

import {
    forceFreshLogin,
    getCredentials,
    isLoggedOut,
    performLogin,
    ROOT,
    SNAPSHOT_DIR,
    waitForRouteSettled,
} from '../ui-snapshot-shared.mjs';

// Drives a real "download all playlists" end-to-end in the built Electron app
// against the LOCAL dev stack (build:electron points at pymix.docker.localhost),
// to verify the sync:download-playlists main-process path — the streaming zip
// download (now via stream.pipeline) and the watch-poller gating (watchPaused).
//
// The whole point is to catch a HANG: if the download never reaches the "Download
// Complete" (done) screen or an error state within the timeout, we exit non-zero.
//
// Run `pnpm run build:electron` first.

const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.js');
const DOWNLOAD_TIMEOUT_MS = 180_000;
const shot = (name) => path.join(SNAPSHOT_DIR, `download-all-${name}-${Date.now()}.png`);

async function main() {
    const credentials = getCredentials();

    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });

    // Mirror the Electron MAIN-process console to our stdout so we can see the
    // [Subbox] download logs / any thrown error and prove the flow progressed.
    const proc = electronApp.process();
    proc.stdout.on('data', (d) => process.stdout.write(`[main] ${d}`));
    proc.stderr.on('data', (d) => process.stderr.write(`[main:err] ${d}`));

    electronApp.on('close', () => console.error('[driver] electronApp CLOSED'));
    proc.on('exit', (code, sig) =>
        console.error(`[driver] main process EXIT code=${code} sig=${sig}`),
    );

    const page = await electronApp.firstWindow();
    page.on('close', () => console.error('[driver] page CLOSED'));
    page.on('crash', () => console.error('[driver] page CRASHED'));
    page.on('pageerror', (e) => console.error('[driver] pageerror:', e.message));
    page.on('console', (m) => {
        const t = m.text();
        if (/error|fail|subbox/i.test(t)) console.log(`[renderer:${m.type()}] ${t}`);
    });
    await page.waitForLoadState('networkidle');

    // Always start from a clean session: the Electron-dev profile may still carry
    // a stale login from a prior run against a different backend. Clear it, then
    // log in fresh against the dev stack.
    await forceFreshLogin(page);
    if (await isLoggedOut(page)) {
        await performLogin(page, credentials);
    }

    // Mount the default layout at the base route (mirrors ui-snapshot-electron),
    // so the mode toggle is reliably present before we interact.
    const baseUrl = page.url().split('#')[0];
    await page.goto(`${baseUrl}#/`);
    if (await waitForRouteSettled(page)) {
        await forceFreshLogin(page);
        await performLogin(page, credentials);
        await page.goto(`${baseUrl}#/`);
        await waitForRouteSettled(page);
    }

    // Enter Sync mode, then the Download tab.
    await page
        .getByText(/^Sync$/)
        .first()
        .click();
    await page.getByRole('button', { name: /^Download$/ }).click();

    // Select step: grab the playlist count, select all, preview.
    await page
        .getByText(/playlists?$/)
        .first()
        .waitFor({ timeout: 15_000 });
    const countText = await page
        .getByText(/\d+ playlists?/)
        .first()
        .innerText();
    console.log(`[driver] playlist badge: "${countText}"`);

    await page.getByRole('button', { name: /^Select all$/ }).click();
    await page.screenshot({ path: shot('01-selected') });

    const previewBtn = page.getByRole('button', { name: /^Preview Download$/ });
    if (await previewBtn.isDisabled()) {
        console.error('[driver] Preview Download disabled — no playlists to select. Aborting.');
        await electronApp.close();
        process.exit(2);
    }
    await previewBtn.click();

    // Preview step: wait for the plan, then trigger the actual download.
    const downloadBtn = page.getByRole('button', { name: /^Download & Extract$/ });
    await downloadBtn.waitFor({ state: 'visible', timeout: 60_000 });
    await page.screenshot({ path: shot('02-preview') });
    console.log('[driver] preview rendered; clicking Download & Extract');
    await downloadBtn.click();

    // The critical wait: either the done screen or a surfaced error must appear.
    // If neither does before the timeout, the flow HUNG — the exact bug we fixed.
    const done = page.getByText(/Download Complete/i);
    const errorText = page.locator('text=/Download failed/i');
    const started = Date.now();
    const outcome = await Promise.race([
        done.waitFor({ state: 'visible', timeout: DOWNLOAD_TIMEOUT_MS }).then(() => 'done'),
        errorText
            .first()
            .waitFor({ state: 'visible', timeout: DOWNLOAD_TIMEOUT_MS })
            .then(() => 'error'),
    ]).catch(() => 'hang');

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    await page.screenshot({ path: shot(`03-${outcome}`) });

    if (outcome === 'done') {
        const summary = await page
            .getByText(/exported\.?$/i)
            .innerText()
            .catch(() => '');
        console.log(`[driver] ✅ download completed in ${secs}s — "${summary}"`);
    } else if (outcome === 'error') {
        console.error(
            `[driver] ⚠️ download surfaced an ERROR after ${secs}s (no hang — error was forwarded to the client).`,
        );
    } else {
        console.error(
            `[driver] ❌ HANG: no done/error state after ${secs}s — the client is stuck.`,
        );
    }

    await electronApp.close();
    process.exit(outcome === 'done' ? 0 : outcome === 'error' ? 1 : 3);
}

main().catch((err) => {
    console.error(err);
    process.exit(3);
});
