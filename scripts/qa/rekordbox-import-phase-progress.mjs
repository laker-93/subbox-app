// Regression driver for the full-track-upload Rekordbox import path's phase
// reporting (pymix#51, #100/#109/#110 on the backend; #79 on this side): same
// journey as rekordbox-full-upload.mjs, but samples the import-progress screen
// repeatedly and records the progress text over time, so a frozen 100% (the old
// beets-track-count-only percentage) would show up against the phase-by-phase
// version ("Importing into library..." -> "Linking tracks to your library..."
// -> "Applying cue points and metadata...", each with its own n/total).
//
// Needs a fixture with enough tracks that more than one phase is actually
// observable between polls -- see docs/qa/features/rekordbox-import.md for the
// make-test-rekordbox-xml invocation this was verified against (--num-tracks 20).
//
// Env: QA_XML_PATH, QA_APP_ENTRY, QA_LABEL, QA_IMPORT_TIMEOUT_MS
import fs from 'fs';
import os from 'os';
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
const IMPORT_TIMEOUT_MS = Number(process.env.QA_IMPORT_TIMEOUT_MS) || 600_000;
const credentials = {
    password: process.env.UI_SNAPSHOT_PASSWORD,
    username: process.env.UI_SNAPSHOT_USERNAME,
};

if (!XML_PATH || !fs.existsSync(XML_PATH)) throw new Error(`bad QA_XML_PATH: ${XML_PATH}`);

async function main() {
    const outDir = path.join(SNAPSHOT_DIR, `bench-${LABEL}`);
    fs.mkdirSync(outDir, { recursive: true });

    // Cold profile per run: on a warm one the app comes up in library mode with a
    // collapsed sidebar and the Sync switch is unreachable.
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-electron-'));
    const electronApp = await electron.launch({
        args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
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
    if (await isLoggedOut(page)) {
        try {
            await performLogin(page, credentials);
        } catch (e) {
            // The success toast can be missed on a cold start; what matters is
            // whether the login actually took.
            await page.screenshot({ path: path.join(SNAPSHOT_DIR, `bench-${LABEL}-login.png`) })
                .catch(() => {});
            await page.waitForTimeout(3000);
            if (await isLoggedOut(page)) throw e;
            console.log('login toast missed but session is live, continuing');
        }
    }
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
    // Flipping appMode in localStorage + reload doesn't always land on Sync on a
    // warm profile — retry the switch rather than failing the run.
    for (let i = 0; i < 4; i += 1) {
        if (await uploadTab.isVisible().catch(() => false)) break;
        // The header's library/sync segmented control is the reliable switch; the
        // localStorage flip above loses to store hydration on a warm profile.
        const syncSwitch = page.locator('label').filter({ hasText: /^Sync$/ }).first();
        if (await syncSwitch.isVisible().catch(() => false)) {
            await syncSwitch.click().catch(() => {});
            await page.waitForTimeout(2000);
            continue;
        }
        await page.evaluate(() => {
            const raw = localStorage.getItem('store_app');
            if (!raw) return;
            const parsed = JSON.parse(raw);
            parsed.state.appMode = 'sync';
            localStorage.setItem('store_app', JSON.stringify(parsed));
        });
        await page.reload();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2500);
    }
    try {
        await uploadTab.waitFor({ timeout: 30_000 });
    } catch (e) {
        await page.screenshot({ path: path.join(SNAPSHOT_DIR, `bench-${LABEL}-notab.png`) }).catch(() => {});
        console.log('sync page text:', (await page.locator('body').innerText().catch(() => '')).slice(0, 600));
        throw e;
    }
    await uploadTab.click();
    await page.waitForTimeout(500);

    // The two Upload tabs are one tab now, so the format is a control on the first
    // screen rather than part of the tab name. It is persisted, so it also carries over
    // between runs -- select it explicitly instead of trusting what is stored.
    await selectSegment(page, /^rekordbox$/i);
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /select xml file/i }).first().click();
    await page.getByText(/preview changes/i).first().waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: /upload selected playlists/i }).last().click();
    console.log('upload started');

    // Sample the progress screen until the job reaches a terminal state.
    const t0 = Date.now();
    const samples = [];
    let shot = 0;
    let finalState = null;
    while (Date.now() - t0 < IMPORT_TIMEOUT_MS) {
        const done = await page.getByText(/upload complete/i).first().isVisible().catch(() => false);
        const err = await page
            .getByText(/import failed|failed to check import progress|upload failed/i)
            .first().isVisible().catch(() => false);

        const body = await page.locator('body').innerText().catch(() => '');
        const m = body.match(/(Importing into library\.\.\.|Linking tracks to your library\.\.\.|Applying cue points and metadata\.\.\.|Finishing up\.\.\.)\s*\n?\s*([^\n]*tracks[^\n]*)/);
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
        await page.waitForTimeout(1200);
    }

    await page.screenshot({ path: path.join(outDir, 'final.png') }).catch(() => {});
    fs.writeFileSync(path.join(outDir, 'samples.tsv'),
        'elapsed_s\tprogress_text\n' + samples.map((s) => `${s.el}\t${s.line}`).join('\n') + '\n');

    console.log(`\nRESULT ${LABEL}: ${finalState ?? 'TIMED OUT'} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`shots: ${outDir}`);
    await electronApp.close();
    process.exit(finalState === 'done' ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
