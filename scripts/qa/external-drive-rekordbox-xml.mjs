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

// Verifies the External Drive Comparison flow after clarifying its intended design
// (see subbox-app GH issue #27): the drive folder is compare-only, downloads always
// land in the app's Subbox library (like a normal playlist download), and a new
// "Include Rekordbox XML" option lets the user import the compared playlist(s)
// straight into Rekordbox instead of hunting through the library folder.
//
// Asserts, against a real local dev stack:
//   1. The scratch "drive" folder stays empty after download (compare-only, not a
//      copy target) — the opposite of what an earlier, now-superseded driver
//      (external-drive-download.mjs) asserted.
//   2. Real audio files land in the app's music folder.
//   3. A Rekordbox XML is written next to them when the checkbox is ticked.
//   4. The "Show Music" / "Show Rekordbox XML" reveal buttons appear on the done screen.
//
// Usage: QA_APP_ENTRY=../feishin/out/main/index.js node scripts/qa/external-drive-rekordbox-xml.mjs

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
    console.log('Electron main entry:', MAIN_ENTRY);
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-external-drive-xml-'));
    console.log('scratch "drive" dir (should stay empty):', destDir);

    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: {
            ...process.env,
            DISABLE_AUTO_UPDATES: '1',
            NODE_ENV: 'development',
        },
    });

    // Mock the native folder picker to return our scratch dir deterministically.
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

    // The app's music folder, per its own default-XML-directory IPC handler
    // (getAppPath()) — this is where downloads and the default XML should land.
    const appPath = await page.evaluate(() => window.api.ipc.invoke('sync:get-default-xml-directory'));
    const musicPath = path.join(appPath, 'music');
    console.log('app music folder:', musicPath);

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

    // Sanity-check the clarified copy landed (issue #27 follow-up).
    const clarifiedCopyVisible = await page
        .getByText(/downloaded tracks are saved to your Subbox library/i)
        .isVisible()
        .catch(() => false);
    console.log('clarified "downloads go to Subbox library" copy visible:', clarifiedCopyVisible);

    const selectFolderButton = page.getByRole('button', { name: /select folder/i });
    await selectFolderButton.click();
    await page.waitForTimeout(500);

    const playlistRow = page.getByText(PLAYLIST, { exact: true }).first();
    const playlistVisible = await playlistRow.isVisible().catch(() => false);
    console.log(`playlist "${PLAYLIST}" visible:`, playlistVisible);
    if (!playlistVisible) throw new Error(`playlist ${PLAYLIST} not found in list`);
    await playlistRow.click();
    await page.waitForTimeout(300);

    const compareButton = page.getByRole('button', { name: /^compare$/i });
    if (!(await compareButton.isEnabled().catch(() => false))) {
        throw new Error('Compare button not enabled');
    }
    await compareButton.click();

    const previewTitle = page.getByText('Comparison Preview', { exact: true });
    await previewTitle.waitFor({ state: 'visible', timeout: 30_000 });
    console.log('reached comparison preview');

    const xmlCheckbox = page.getByLabel('Include Rekordbox XML');
    const xmlCheckboxVisible = await xmlCheckbox.isVisible().catch(() => false);
    const xmlCheckboxChecked = xmlCheckboxVisible && (await xmlCheckbox.isChecked().catch(() => false));
    console.log('Include Rekordbox XML checkbox visible:', xmlCheckboxVisible, 'checked by default:', xmlCheckboxChecked);
    if (!xmlCheckboxVisible) throw new Error('Include Rekordbox XML checkbox not found');

    const downloadButton = page.getByRole('button', { name: /^download missing tracks$/i });
    if (!(await downloadButton.isEnabled().catch(() => false))) {
        throw new Error('Download Missing Tracks disabled — expected an empty scratch dir to show missing tracks');
    }
    await downloadButton.click();

    const doneTitle = page.getByText('Download Complete', { exact: true });
    const errorText = page.locator('text=/download failed/i');
    const result = await Promise.race([
        doneTitle.waitFor({ state: 'visible', timeout: 120_000 }).then(() => 'done'),
        errorText.waitFor({ state: 'visible', timeout: 120_000 }).then(() => 'error'),
    ]).catch(() => 'timeout');
    console.log('download terminal state:', result);

    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const shotPath = path.join(SNAPSHOT_DIR, `qa-external-drive-rekordbox-xml-${Date.now()}.png`);
    await page.screenshot({ path: shotPath });
    console.log('screenshot:', shotPath);

    if (result !== 'done') {
        const bodyText = await page.locator('body').innerText().catch(() => '(unreadable)');
        console.log('--- visible text on non-done result ---');
        console.log(bodyText.slice(0, 1500));
        console.log('--- console/page errors ---');
        console.log(consoleMessages.filter((m) => /error|warn/i.test(m)).join('\n') || '(none)');
        await electronApp.close();
        throw new Error(`download did not complete: ${result}`);
    }

    const showMusicVisible = await page.getByRole('button', { name: /^show music$/i }).isVisible().catch(() => false);
    const showXmlVisible = await page.getByRole('button', { name: /^show rekordbox xml$/i }).isVisible().catch(() => false);
    console.log('Show Music button visible:', showMusicVisible);
    console.log('Show Rekordbox XML button visible:', showXmlVisible);

    await electronApp.close();

    const driveAudioCount = countAudioFiles(destDir);
    const musicAudioCount = countAudioFiles(musicPath);
    const xmlPath = path.join(appPath, 'subbox_rb_export.xml');
    const xmlExists = fs.existsSync(xmlPath);
    console.log(`audio files in scratch "drive" dir (expect 0): ${driveAudioCount}`);
    console.log(`audio files in app music folder (expect >0): ${musicAudioCount}`);
    console.log(`Rekordbox XML exists at ${xmlPath}: ${xmlExists}`);

    fs.rmSync(destDir, { recursive: true, force: true });

    const failures = [];
    if (driveAudioCount !== 0) failures.push('drive folder should stay empty (compare-only) but has audio files');
    if (musicAudioCount === 0) failures.push('no audio files landed in the app music folder');
    if (!xmlExists) failures.push('Rekordbox XML was not created');
    if (!xmlCheckboxChecked) failures.push('Include Rekordbox XML checkbox was not checked by default');
    if (!showMusicVisible) failures.push('Show Music button missing on done screen');
    if (!showXmlVisible) failures.push('Show Rekordbox XML button missing on done screen');
    if (!clarifiedCopyVisible) failures.push('clarified "downloads go to Subbox library" copy not found on select screen');

    if (failures.length > 0) {
        throw new Error(`FAIL:\n - ${failures.join('\n - ')}`);
    }
    console.log(`PASS: ${musicAudioCount} audio file(s) in the library, XML exported, drive left untouched.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
