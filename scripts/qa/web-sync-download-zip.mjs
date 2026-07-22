import path from 'path';
import { chromium } from 'playwright';

import { getCredentials, performLogin, SNAPSHOT_DIR } from '../ui-snapshot-shared.mjs';

// Drives the WEB build's Sync -> Download flow (not Electron) to check whether the
// browser download of the synced playlist zip actually succeeds.
//
// Run against `pnpm dev:web` (port 4343) — that origin is in pymix's CORS
// allowlist (registration.py). The docker `player` container at
// https://www.docker.localhost is NOT allowlisted, so logging in there fails on
// a CORS-blocked /user/login before this flow is even reachable.
//
// This caught two real, stacked bugs (both fixed in sync-download.tsx):
//   1. pymix's zipPath response field omits the .zip extension (the real file on
//      disk is "music.zip") — the Electron main-process path already knew to
//      append it; the web path didn't.
//   2. filebrowser authenticates via a custom X-Auth header, which a plain
//      `<a href>` to a cross-origin URL can never carry — every download 401'd
//      regardless of (1). Fixed by fetching the file as a blob via the (already
//      existing but previously unused) FilebrowserController.download, then
//      triggering the save from an object URL.
//
// Passing run: exactly one 200 response for the zip filename, nTracksExported
// tracks in the downloaded blob's size ballpark, no 401/404.

const APP_URL = process.env.UI_SNAPSHOT_APP_URL || 'http://localhost:4343';
const shot = (name) => path.join(SNAPSHOT_DIR, `web-sync-download-${name}-${Date.now()}.png`);

async function main() {
    const credentials = getCredentials();
    const browser = await chromium.launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    const downloadResponses = [];
    page.on('response', (res) => {
        if (res.url().includes('/api/raw/downloads/')) {
            downloadResponses.push({ status: res.status(), url: res.url() });
            console.log(`[driver] download response: ${res.status()} ${res.url()}`);
        }
    });
    page.on('console', (m) => {
        const t = m.text();
        if (/error|fail/i.test(t)) console.log(`[renderer:${m.type()}] ${t}`);
    });

    await page.goto(APP_URL);
    await page.getByRole('button', { name: /^login$/i }).waitFor({ timeout: 20_000 });
    await performLogin(page, credentials);

    await page
        .getByText(/^Sync$/)
        .first()
        .click();
    await page.getByRole('button', { name: /^Download$/ }).click();

    await page
        .getByText(/playlists?$/)
        .first()
        .waitFor({ timeout: 15_000 });

    // Select just "Dance Mix" (3 tracks, ~63MB) to keep this fast — not Select all.
    await page.getByText('Dance Mix', { exact: true }).click();
    await page.screenshot({ path: shot('01-selected') });

    const previewBtn = page.getByRole('button', { name: /^Preview Download$/ });
    if (await previewBtn.isDisabled()) {
        console.error('[driver] Preview Download disabled. Aborting.');
        await browser.close();
        process.exit(2);
    }
    await previewBtn.click();

    const downloadBtn = page.getByRole('button', { name: /^Download Zip$/ });
    await downloadBtn.waitFor({ state: 'visible', timeout: 30_000 });
    await page.screenshot({ path: shot('02-preview') });

    // The fixed flow fetches the file as a blob (an XHR the page makes, so the
    // response listener above still sees it) then triggers the save from a
    // same-origin blob: URL — which Playwright DOES surface as a 'download' event.
    const downloadEventPromise = page
        .waitForEvent('download', { timeout: 30_000 })
        .catch(() => null);
    await downloadBtn.click();

    const download = await downloadEventPromise;
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: shot('03-after-click') });

    console.log(
        `[driver] Playwright download event: ${download ? download.suggestedFilename() : 'NONE'}`,
    );
    console.log(`[driver] page URL after click: ${page.url()}`);
    console.log(`[driver] captured download responses: ${JSON.stringify(downloadResponses)}`);

    await browser.close();

    const badResponse = downloadResponses.some((r) => r.status !== 200);
    const ok = download && !badResponse && downloadResponses.length > 0;
    process.exit(ok ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(3);
});
