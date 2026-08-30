import fs from 'fs';
import path from 'path';
import { _electron as electron } from 'playwright';

import {
    forceFreshLogin,
    getCredentials,
    isLoggedOut,
    performLogin,
    resolveAppEntry,
    selectSegment,
    SNAPSHOT_DIR,
} from '../ui-snapshot-shared.mjs';

// Coverage driver: subbox-app's "Rekordbox/Serato import-export UI" full track-upload
// path (Sync -> Upload (Rekordbox), NOT metadata-only) — the ipc `sync:upload-from-xml`
// handler, never driven before (rekordbox-metadata-import.mjs only covers the
// metadata-only sub-path). Written to verify PR #31 / issue #33: the XML-upload and
// TUS upload-create calls inside sync:upload-from-xml previously used a raw
// filebrowserToken with no refresh-on-401 retry.
//
//   1. Sync -> "Upload (Rekordbox)" tab (default tab)
//   2. "Select XML File" — native file picker is stubbed in the MAIN process to
//      resolve to QA_XML_PATH (Playwright can't drive a real OS file dialog)
//   3. Preview step — leave "Import metadata only" UNCHECKED, all playlists
//      pre-selected -> "Upload"
//   4. ipc sync:upload-from-xml (uploads XML + each track's audio via TUS to
//      filebrowser) -> PymixController.rbImport -> polls importProgress until done
//
// QA_XML_PATH should point at a self-contained fixture (real audio files at the
// XML's Location paths) — e.g. pymix/scripts/make_test_rekordbox_xml.py — since this
// path uploads the actual files, unlike the metadata-only path which only matches
// existing library tracks by Name/Artist/Album.
//
// Env:
//   QA_XML_PATH           REQUIRED. Local path to the Rekordbox XML to import.
//   QA_APP_ENTRY          out/main/index.js to launch (default: this worktree's build).
//   QA_IMPORT_TIMEOUT_MS  Overall cap waiting for the upload+import job (default 180000).

const MAIN_ENTRY = resolveAppEntry();
const XML_PATH = process.env.QA_XML_PATH;
const IMPORT_TIMEOUT_MS = Number(process.env.QA_IMPORT_TIMEOUT_MS) || 180_000;

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
    // pymix's session_id cookie is short-lived (~5-10 min observed) and a resumed
    // persisted session can silently be stale — force a fresh login so the
    // storage-check pre-flight and the upload itself see a valid session instead of
    // a false "no session" response.
    await forceFreshLogin(page);
    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(1000);

    // --- Navigate to Sync mode + "Upload (Rekordbox)" (its default tab) ---
    await page.evaluate(() => {
        const parsed = JSON.parse(localStorage.getItem('store_app'));
        parsed.state.appMode = 'sync';
        localStorage.setItem('store_app', JSON.stringify(parsed));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const uploadTab = page.getByRole('button', { name: /^upload$/i }).first();
    await uploadTab.click();
    await page.waitForTimeout(500);

    // The two Upload tabs are one tab now, so the format is a control on the first
    // screen rather than part of the tab name. It is persisted, so it also carries over
    // between runs -- select it explicitly instead of trusting what is stored.
    await selectSegment(page, /^rekordbox$/i);
    await page.waitForTimeout(500);

    const selectBtn = page.getByRole('button', { name: /select xml file/i }).first();
    await selectBtn.click();
    console.log('clicked Select XML File (stubbed dialog resolves immediately)');

    // --- Preview step: confirm playlist parsed, leave metadata-only unchecked, submit ---
    await page
        .getByText(/preview changes/i)
        .first()
        .waitFor({ timeout: 15_000 });
    const badges = await page.locator('.mantine-Badge-root, [class*="Badge"]').allTextContents();
    console.log('preview badges:', badges.filter(Boolean));

    const submitBtn = page.getByRole('button', { name: /^upload$/i }).last();
    await submitBtn.click();
    console.log('clicked Upload — uploading XML + audio via TUS + triggering /rekordbox/import');

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
            .getByText(/import failed|failed to check import progress|upload failed/i)
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
    const bodyText = await page
        .locator('body')
        .innerText()
        .catch(() => '');

    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const shot = path.join(SNAPSHOT_DIR, `rekordbox-full-upload-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => {});

    console.log('\n--- main [Subbox]/error lines ---');
    console.log(
        mainLogs
            .filter(
                (l) => /rekordbox|rbimport|import|upload|401|error/i.test(l) && !/Autofill|GPUCache/i.test(l),
            )
            .slice(-60)
            .join('\n') || '(none)',
    );

    console.log('\n--- renderer console/error lines ---');
    console.log(
        pageLogs
            .filter((l) => /error|401|fail/i.test(l))
            .slice(-40)
            .join('\n') || '(none)',
    );

    console.log('\nRESULT:');
    console.log(`  final state: ${finalState ?? 'TIMED OUT'}`);
    console.log(`  screenshot: ${shot}`);
    if (finalState === 'done' || finalState === 'error') {
        console.log(
            `  final screen text (trimmed): ${bodyText.replace(/\s+/g, ' ').slice(0, 400)}`,
        );
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
