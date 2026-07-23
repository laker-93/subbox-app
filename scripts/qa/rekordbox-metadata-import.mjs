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

// Coverage driver: subbox-app's "Rekordbox/Serato import-export UI" row (Sync ->
// Upload (Rekordbox), metadata-only path) + pymix's POST /rekordbox/import, both
// never driven before. Drives the REAL UI end to end:
//   1. Sync -> "Upload (Rekordbox)" tab (default tab)
//   2. "Select XML File" — native file picker is stubbed in the MAIN process to
//      resolve to QA_XML_PATH (Playwright can't drive a real OS file dialog)
//   3. Preview step — tick "Import metadata only (no track uploads)"
//   4. "Import Metadata Only" -> ipc sync:upload-xml (uploads the XML to
//      filebrowser) -> PymixController.rbImport -> polls importProgress until done
//
// QA_XML_PATH should be a real Rekordbox XML whose tracks already exist in the
// target library (metadata-only matches by Name/Artist/Album via
// SubsonicClient.get_track_match) — see docs/qa/features/rekordbox-import.md for
// how the fixture used in this cycle was built (export -> pyrekordbox edit ->
// reimport), which keeps the data 100% real instead of hand-rolled.
//
// Env:
//   QA_XML_PATH     REQUIRED. Local path to the Rekordbox XML to import.
//   QA_APP_ENTRY     out/main/index.js to launch (default: this worktree's build).
//   QA_IMPORT_TIMEOUT_MS  Overall cap waiting for the import job (default 120000).

const MAIN_ENTRY = resolveAppEntry();
const XML_PATH = process.env.QA_XML_PATH;
const IMPORT_TIMEOUT_MS = Number(process.env.QA_IMPORT_TIMEOUT_MS) || 120_000;

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

    const mainLogs = [];
    electronApp.process().stdout.on('data', (d) => mainLogs.push(`[main] ${d}`.trimEnd()));
    electronApp.process().stderr.on('data', (d) => mainLogs.push(`[main:err] ${d}`.trimEnd()));

    // Stub the native file picker so "Select XML File" resolves to our fixture.
    await electronApp.evaluate(async ({ dialog }, xmlPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [xmlPath] });
    }, XML_PATH);

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

    // --- Navigate to Sync mode + "Upload (Rekordbox)" (its default tab) ---
    // The mode toggle lives in the top-right of the main content area; on this
    // profile the right sidebar (now-playing queue) was left expanded from a
    // prior session and visually overlapped it, so pointer clicks on the "Sync"
    // segmented-control label got intercepted. Flipping the same persisted
    // Zustand store (`store_app`, appMode) the real toggle writes to and
    // reloading is equivalent to the user clicking it, without fighting the
    // unrelated overlap.
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

    // --- Preview step: confirm playlist parsed, tick metadata-only, submit ---
    await page.getByText(/preview changes/i).first().waitFor({ timeout: 15_000 });
    const badges = await page.locator('.mantine-Badge-root, [class*="Badge"]').allTextContents();
    console.log('preview badges:', badges.filter(Boolean));

    const metaCheckbox = page.getByText(/import metadata only/i).first();
    await metaCheckbox.click();
    await page.waitForTimeout(300);

    const submitBtn = page.getByRole('button', { name: /import metadata only/i }).last();
    await submitBtn.click();
    console.log('clicked Import Metadata Only — uploading XML + triggering /rekordbox/import');

    // --- Wait for terminal state: "Upload Complete" (done) or an error string ---
    const deadline = Date.now() + IMPORT_TIMEOUT_MS;
    let finalState = null;
    while (Date.now() < deadline) {
        const doneVisible = await page
            .getByText(/upload complete/i)
            .first()
            .isVisible()
            .catch(() => false);
        if (doneVisible) {
            finalState = 'done';
            break;
        }
        const errorVisible = await page
            .getByText(/import failed|failed to check import progress/i)
            .first()
            .isVisible()
            .catch(() => false);
        if (errorVisible) {
            finalState = 'error';
            break;
        }
        await page.waitForTimeout(2000);
    }

    const timedOut = finalState === null;
    const bodyText = await page.locator('body').innerText().catch(() => '');

    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const shot = path.join(SNAPSHOT_DIR, `rekordbox-metadata-import-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => {});

    console.log('\n--- main [Subbox]/error lines ---');
    console.log(
        mainLogs
            .filter((l) => /rekordbox|rbimport|import|error/i.test(l) && !/Autofill|GPUCache/i.test(l))
            .slice(-40)
            .join('\n') || '(none)',
    );

    console.log('\nRESULT:');
    console.log(`  final state: ${finalState ?? 'TIMED OUT'}`);
    console.log(`  screenshot: ${shot}`);
    if (finalState === 'done' || finalState === 'error') {
        console.log(`  final screen text (trimmed): ${bodyText.replace(/\s+/g, ' ').slice(0, 400)}`);
    }

    await electronApp.close();

    const ok = finalState === 'done';
    console.log(`\nOVERALL: ${ok ? 'DONE' : timedOut ? 'TIMED OUT' : 'ERROR'}`);
    process.exit(ok ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
