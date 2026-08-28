// Regression driver for subbox-app#109 / pymix#133: the metadata-only Rekordbox
// import path ALWAYS reports n_tracks_for_import: 0 (it never uploads audio), so
// it is the primary real-world repro for #55 ("success was unfalsifiable" — the
// client used to skip straight to 'done' the instant the upload POST returned,
// before pymix's background playlist/metadata passes had even started). This
// samples the progress screen the same way rekordbox-import-phase-progress.mjs
// does for the full-upload path, and captures the final toast/body text so the
// exact wording (should be "Library updated from your Rekordbox XML", NOT
// "Imported 0 tracks") can be confirmed.
//
// QA_XML_PATH's tracks must already exist in the target library (metadata-only
// matches by Name/Artist/Album) -- e.g. run rekordbox-import-phase-progress.mjs
// or rekordbox-full-upload.mjs against the same fixture first.
//
// Env: QA_XML_PATH, QA_APP_ENTRY, QA_LABEL, QA_IMPORT_TIMEOUT_MS
import fs from 'fs';
import path from 'path';
import { _electron as electron } from 'playwright';

import {
    forceFreshLogin,
    isLoggedOut,
    performLogin,
    resolveAppEntry,
    selectSegment,
    SNAPSHOT_DIR,
} from '../ui-snapshot-shared.mjs';

const MAIN_ENTRY = resolveAppEntry();
const XML_PATH = process.env.QA_XML_PATH;
const LABEL = process.env.QA_LABEL || 'run';
const IMPORT_TIMEOUT_MS = Number(process.env.QA_IMPORT_TIMEOUT_MS) || 120_000;
const credentials = {
    password: process.env.UI_SNAPSHOT_PASSWORD,
    username: process.env.UI_SNAPSHOT_USERNAME,
};

if (!XML_PATH || !fs.existsSync(XML_PATH)) throw new Error(`bad QA_XML_PATH: ${XML_PATH}`);

async function main() {
    const outDir = path.join(SNAPSHOT_DIR, `bench-${LABEL}`);
    fs.mkdirSync(outDir, { recursive: true });

    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    await electronApp.evaluate(async ({ dialog }, xmlPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [xmlPath] });
    }, XML_PATH);

    const page = await electronApp.firstWindow();
    page.on('console', (m) => console.log(`[renderer:${m.type()}] ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`.slice(0, 300)));
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });
    await page.waitForLoadState('networkidle');
    await forceFreshLogin(page);
    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
        const raw = localStorage.getItem('store_app');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        parsed.state.appMode = 'sync';
        localStorage.setItem('store_app', JSON.stringify(parsed));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const uploadTab = page.getByRole('button', { name: /^upload$/i }).first();
    await uploadTab.waitFor({ timeout: 30_000 });
    await uploadTab.click();
    await page.waitForTimeout(500);

    // The two Upload tabs are one tab now, so the format is a control on the first
    // screen rather than part of the tab name. It is persisted, so it also carries over
    // between runs -- select it explicitly instead of trusting what is stored.
    await selectSegment(page, /^rekordbox$/i);
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: /select xml file/i }).first().click();
    await page.getByText(/preview changes/i).first().waitFor({ timeout: 20_000 });

    // Tick "Import metadata only" — this is the whole point: it always uploads
    // zero audio, so n_tracks_for_import will be 0 and #55's bug (skip-to-done)
    // fires on every single run of this path, not just an edge case.
    await page.getByText(/import metadata only/i).first().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /import metadata only/i }).last().click();
    console.log('submitted metadata-only import (n_tracks_for_import will be 0)');

    const t0 = Date.now();
    const samples = [];
    let shot = 0;
    let finalState = null;
    let sawProgressScreen = false;
    while (Date.now() - t0 < IMPORT_TIMEOUT_MS) {
        const done = await page.getByText(/upload complete/i).first().isVisible().catch(() => false);
        const err = await page
            .getByText(/import failed|failed to check import progress|imported, with problems/i)
            .first().isVisible().catch(() => false);

        const body = await page.locator('body').innerText().catch(() => '');
        if (/importing into library|linking tracks to your library|applying cue points/i.test(body)) {
            sawProgressScreen = true;
        }
        const m = body.match(/(Importing into library\.\.\.|Linking tracks to your library\.\.\.|Applying cue points and metadata\.\.\.|Finishing up\.\.\.)\s*\n?\s*([^\n]*)/);
        const line = m ? `${m[1]} | ${m[2]}` : '';
        const el = ((Date.now() - t0) / 1000).toFixed(1);
        if (line && samples.at(-1)?.line !== line) {
            samples.push({ el, line });
            shot += 1;
            await page.screenshot({ path: path.join(outDir, `${String(shot).padStart(2, '0')}-${el}s.png`) })
                .catch(() => {});
            console.log(`[${el}s] ${line}`);
        }
        if (done) { finalState = 'done'; break; }
        if (err) { finalState = 'error'; break; }
        await page.waitForTimeout(500);
    }

    await page.waitForTimeout(500); // let any toast finish animating in
    const finalBody = await page.locator('body').innerText().catch(() => '');
    await page.screenshot({ path: path.join(outDir, 'final.png') }).catch(() => {});
    fs.writeFileSync(path.join(outDir, 'samples.tsv'),
        'elapsed_s\tprogress_text\n' + samples.map((s) => `${s.el}\t${s.line}`).join('\n') + '\n');

    console.log(`\nsawProgressScreen (did NOT skip straight to done): ${sawProgressScreen}`);
    console.log(`RESULT ${LABEL}: ${finalState ?? 'TIMED OUT'} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`final body (trimmed): ${finalBody.replace(/\s+/g, ' ').slice(0, 500)}`);
    console.log(`shots: ${outDir}`);
    await electronApp.close();
    process.exit(finalState === 'done' ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
