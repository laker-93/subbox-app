import { _electron as electron } from 'playwright';

import {
    getCredentials,
    isLoggedOut,
    performLogin,
    resolveAppEntry,
    SNAPSHOT_DIR,
} from '../ui-snapshot-shared.mjs';
import fs from 'fs';
import path from 'path';

// One-off repro/verify driver for laker-93/subbox-app#32: the Rekordbox sync
// "Preview Changes" screen's "N tracks" badge summed each selected playlist's
// trackCount with no dedup across playlists. Loads a fixture XML with several
// overlapping playlists (all selected by default after parse) and reads the
// "N tracks" badge straight off the preview screen -- does NOT submit an
// upload/import, so it's safe to run against either the buggy or fixed build.
//
// Env:
//   QA_XML_PATH      REQUIRED. Local path to the Rekordbox XML fixture.
//   QA_APP_ENTRY      out/main/index.js to launch (default: this worktree's build).

const MAIN_ENTRY = resolveAppEntry();
const XML_PATH = process.env.QA_XML_PATH;

if (!XML_PATH || !fs.existsSync(XML_PATH)) {
    throw new Error(`QA_XML_PATH must point at an existing file (got: ${XML_PATH})`);
}

const credentials = getCredentials();

async function main() {
    console.log('app entry:', MAIN_ENTRY);
    console.log('xml path: ', XML_PATH);

    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });

    await electronApp.evaluate(async ({ dialog }, xmlPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [xmlPath] });
    }, XML_PATH);

    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });

    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
        const parsed = JSON.parse(localStorage.getItem('store_app'));
        parsed.state.appMode = 'sync';
        localStorage.setItem('store_app', JSON.stringify(parsed));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const uploadTab = page.getByRole('button', { name: /^upload \(rekordbox\)$/i }).first();
    await uploadTab.click();
    await page.waitForTimeout(500);

    const selectBtn = page.getByRole('button', { name: /select xml file/i }).first();
    await selectBtn.click();
    console.log('clicked Select XML File (stubbed dialog resolves immediately)');

    await page.getByText(/preview changes/i).first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);

    const badges = await page.locator('.mantine-Badge-root, [class*="Badge"]').allTextContents();
    const cleanBadges = badges.filter(Boolean);
    console.log('preview badges:', cleanBadges);

    const tracksBadge = cleanBadges.find((b) => /tracks$/i.test(b.trim()));
    const selectedBadge = cleanBadges.find((b) => /selected$/i.test(b.trim()));

    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const shot = path.join(SNAPSHOT_DIR, `rekordbox-preview-dedup-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => {});

    console.log('\nRESULT:');
    console.log(`  ${selectedBadge ?? '(no selected-count badge found)'}`);
    console.log(`  ${tracksBadge ?? '(no tracks badge found)'}`);
    console.log(`  screenshot: ${shot}`);

    await electronApp.close();
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
