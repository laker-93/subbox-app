import path from 'path';
import { _electron as electron } from 'playwright';

import {
    getCredentials,
    isLoggedOut,
    performLogin,
    ROOT,
    SNAPSHOT_DIR,
} from '../ui-snapshot-shared.mjs';
import fs from 'fs';

// One-off QA driver for the SUBBOX_ID sync-matching change (subbox-app #14 +
// pymix #21). Launches the built Electron app, logs in, switches to Sync
// mode, and reports what it finds — this is exploratory (used to see what
// state the test account is actually in), not a permanent script.
//
// Usage: node scripts/qa/sync-smoke.mjs

const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.js');
const credentials = getCredentials();

async function main() {
    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: {
            ...process.env,
            DISABLE_AUTO_UPDATES: '1',
            NODE_ENV: 'development',
        },
    });

    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });
    const consoleMessages = [];
    page.on('console', (msg) => {
        consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
        consoleMessages.push(`[pageerror] ${err.message}`);
    });

    await page.waitForLoadState('networkidle');

    if (await isLoggedOut(page)) {
        await performLogin(page, credentials);
    } else {
        // Persisted session might still be expired even though the login button
        // isn't showing yet (see ui-snapshot-shared) — nudge and see if it sticks.
        await page.waitForTimeout(1000);
    }

    await page.waitForTimeout(1000);

    // Switch to Sync mode via the segmented control.
    const syncToggle = page.getByText('Sync', { exact: true }).first();
    const syncToggleVisible = await syncToggle.isVisible().catch(() => false);
    console.log('sync toggle visible:', syncToggleVisible);

    if (syncToggleVisible) {
        await syncToggle.click();
        await page.waitForTimeout(1500);
    }

    const downloadTab = page.getByText('Download', { exact: true }).first();
    if (await downloadTab.isVisible().catch(() => false)) {
        await downloadTab.click();
        await page.waitForTimeout(1500);
    }
    console.log('clicked Download tab:', await downloadTab.isVisible().catch(() => false));

    // Pick a playlist with real tracks so sync/plan has something to match.
    const targetPlaylist = process.env.QA_PLAYLIST || 'Kodzo';
    const playlistRow = page.getByText(targetPlaylist, { exact: true }).first();
    if (await playlistRow.isVisible().catch(() => false)) {
        await playlistRow.click();
        await page.waitForTimeout(500);
    }
    console.log(`selected playlist "${targetPlaylist}":`, await playlistRow.isVisible().catch(() => false));

    const previewButton = page.getByRole('button', { name: /^preview download$/i });
    const previewEnabled = await previewButton.isEnabled().catch(() => false);
    console.log('preview download button enabled:', previewEnabled);
    if (previewEnabled) {
        await previewButton.click();
        // First run has no on-disk subboxId cache yet, so the client has to open
        // every local file with TagLib before it even calls sync/plan — poll instead
        // of guessing a fixed wait.
        const generating = page.getByText('Generating sync plan', { exact: false }).first();
        await generating.waitFor({ state: 'hidden', timeout: 60_000 }).catch((e) => {
            console.log('still generating after 60s:', e.message);
        });
    }

    if (process.env.QA_DOWNLOAD === '1') {
        const downloadButton = page.getByRole('button', { name: /^download & extract$/i });
        const downloadEnabled = await downloadButton.isEnabled().catch(() => false);
        console.log('download & extract button enabled:', downloadEnabled);
        if (downloadEnabled) {
            await downloadButton.click();
            // Real network transfer (zip download from filebrowser + unzip) — poll
            // rather than guess a fixed wait.
            const downloading = page.getByText(/downloading|extracting/i).first();
            await downloading
                .waitFor({ state: 'hidden', timeout: 120_000 })
                .catch((e) => console.log('still downloading after 120s:', e.message));
            await page.waitForTimeout(1000);
        }
    }

    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const shotPath = path.join(SNAPSHOT_DIR, `qa-sync-smoke-${Date.now()}.png`);
    await page.screenshot({ path: shotPath });
    console.log('screenshot:', shotPath);

    // Dump whatever text is on screen so we can see what state sync mode is in
    // (server picker? playlist list? empty state?) without guessing from source.
    const bodyText = await page.locator('body').innerText().catch(() => '(failed to read body text)');
    console.log('--- visible text (sync mode) ---');
    console.log(bodyText.slice(0, 2000));
    console.log('--- end visible text ---');

    console.log('--- console/page errors ---');
    console.log(consoleMessages.filter((m) => /error|warn/i.test(m)).join('\n') || '(none)');
    console.log('--- end console/page errors ---');

    await electronApp.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
