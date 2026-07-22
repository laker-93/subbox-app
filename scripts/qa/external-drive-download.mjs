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

// Regression driver for the "External Drive Comparison" download bug: the
// screen lets a user pick a destination folder (drivePath), compares it
// against server playlists, then a "Download Missing Tracks" button that —
// before the fix — silently ignored drivePath and wrote into the app's own
// internal library folder instead. This drives the real UI against an empty
// scratch destination directory (so every track in the chosen playlist shows
// "missing") and asserts real audio files land inside that destination.
//
// Usage: node scripts/qa/external-drive-download.mjs

const MAIN_ENTRY = resolveAppEntry();
const credentials = getCredentials();
const PLAYLIST = process.env.QA_PLAYLIST || 'Kodzo';

function countAudioFiles(dir) {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            count += countAudioFiles(full);
        } else if (/\.(mp3|flac|m4a|wav|aiff|ogg)$/i.test(entry.name)) {
            count += 1;
        }
    }
    return count;
}

async function main() {
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-external-drive-'));
    console.log('scratch destination dir:', destDir);

    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: {
            ...process.env,
            DISABLE_AUTO_UPDATES: '1',
            NODE_ENV: 'development',
        },
    });

    // Mock the native folder picker to return our scratch dir deterministically
    // instead of driving an OS-native dialog.
    await electronApp.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, destDir);

    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });

    const consoleMessages = [];
    page.on('console', (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => consoleMessages.push(`[pageerror] ${err.message}`));

    await page.waitForLoadState('networkidle');

    if (await isLoggedOut(page)) {
        await performLogin(page, credentials);
    } else {
        await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(1000);

    const syncToggle = page.getByText('Sync', { exact: true }).first();
    if (await syncToggle.isVisible().catch(() => false)) {
        await syncToggle.click();
        await page.waitForTimeout(1500);
    }

    const externalDriveTab = page.getByText('External Drive', { exact: true }).first();
    const tabVisible = await externalDriveTab.isVisible().catch(() => false);
    console.log('External Drive tab visible:', tabVisible);
    if (!tabVisible) throw new Error('External Drive tab not found');
    await externalDriveTab.click();
    await page.waitForTimeout(1000);

    const selectFolderButton = page.getByRole('button', { name: /select folder/i });
    await selectFolderButton.click();
    await page.waitForTimeout(500);

    const drivePathShown = await page
        .getByText(destDir, { exact: false })
        .isVisible()
        .catch(() => false);
    console.log('drive path shown in UI:', drivePathShown);

    const playlistRow = page.getByText(PLAYLIST, { exact: true }).first();
    const playlistVisible = await playlistRow.isVisible().catch(() => false);
    console.log(`playlist "${PLAYLIST}" visible:`, playlistVisible);
    if (!playlistVisible) throw new Error(`playlist ${PLAYLIST} not found in list`);
    await playlistRow.click();
    await page.waitForTimeout(300);

    const compareButton = page.getByRole('button', { name: /^compare$/i });
    const compareEnabled = await compareButton.isEnabled().catch(() => false);
    console.log('compare button enabled:', compareEnabled);
    if (!compareEnabled) throw new Error('Compare button not enabled');
    await compareButton.click();

    // Comparing involves a directory scan + a server round trip — poll for the
    // preview screen rather than guessing a fixed wait.
    const previewTitle = page.getByText('Comparison Preview', { exact: true });
    await previewTitle.waitFor({ state: 'visible', timeout: 30_000 });
    console.log('reached comparison preview');

    const downloadButton = page.getByRole('button', { name: /^download missing tracks$/i });
    const downloadEnabled = await downloadButton.isEnabled().catch(() => false);
    console.log('download button enabled:', downloadEnabled);
    if (!downloadEnabled) {
        // Nothing missing (unexpected for a brand-new empty scratch dir) — bail
        // loudly rather than declaring a false pass.
        throw new Error(
            'Download Missing Tracks disabled — expected an empty scratch dir to show missing tracks',
        );
    }
    await downloadButton.click();

    // Real network transfer (zip export + filebrowser download + unzip) vs. a
    // hang — race the terminal "Download Complete" state against a bounded
    // timeout; a timeout here is a real failure (a hang), not a slow pass.
    const doneTitle = page.getByText('Download Complete', { exact: true });
    const errorText = page.locator('text=/download failed/i');
    const result = await Promise.race([
        doneTitle.waitFor({ state: 'visible', timeout: 120_000 }).then(() => 'done'),
        errorText.waitFor({ state: 'visible', timeout: 120_000 }).then(() => 'error'),
    ]).catch(() => 'timeout');
    console.log('download terminal state:', result);

    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const shotPath = path.join(SNAPSHOT_DIR, `qa-external-drive-download-${Date.now()}.png`);
    await page.screenshot({ path: shotPath });
    console.log('screenshot:', shotPath);

    if (result !== 'done') {
        const bodyText = await page
            .locator('body')
            .innerText()
            .catch(() => '(unreadable)');
        console.log('--- visible text on non-done result ---');
        console.log(bodyText.slice(0, 1500));
        console.log('--- console/page errors ---');
        console.log(consoleMessages.filter((m) => /error|warn/i.test(m)).join('\n') || '(none)');
        await electronApp.close();
        throw new Error(`download did not complete: ${result}`);
    }

    const audioFileCount = countAudioFiles(destDir);
    console.log(`audio files found in scratch destination dir (${destDir}):`, audioFileCount);

    await electronApp.close();

    fs.rmSync(destDir, { force: true, recursive: true });

    if (audioFileCount === 0) {
        throw new Error(
            'FAIL: no audio files landed in the selected destination directory — the drivePath-ignored bug is NOT fixed',
        );
    }
    console.log(
        `PASS: ${audioFileCount} audio file(s) correctly extracted into the selected destination directory`,
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
