import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';

import {
    forceFreshLogin,
    getCredentials,
    performLogin,
    resolveAppEntry,
    ROOT,
    waitForRouteSettled,
} from '../ui-snapshot-shared.mjs';

// QA driver: a real-user Settings journey.
//   Open /settings -> click through every tab (General, Playback, Hotkeys,
//   Window, Advanced) checking each renders content, not a blank/crashed
//   panel -> drive the one subbox-authored control (Advanced -> Export/Import
//   settings backup: export subbox-settings.json, then import it back).
//
// Requires a development-mode Electron build (out/main/index.js) pointing at
// the local stack. Usage: node scripts/qa/settings-journey.mjs

const MAIN_ENTRY = resolveAppEntry();
const SNAP = path.join(ROOT, '.ui-snapshots');

const log = (...a) => console.log('[settings-journey]', ...a);

async function goto(page, route) {
    const baseUrl = page.url().split('#')[0];
    await page.goto(`${baseUrl}#${route}`);
    const stuck = await waitForRouteSettled(page);
    return stuck;
}

async function main() {
    const credentials = getCredentials();
    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('networkidle');
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });

    await forceFreshLogin(page);
    await performLogin(page, credentials);
    log('logged in');

    let stuck = await goto(page, '/settings');
    if (stuck) {
        await forceFreshLogin(page);
        await performLogin(page, credentials);
        stuck = await goto(page, '/settings');
    }
    log('settings route stuck?', stuck);
    await page.waitForTimeout(1200);

    const tabs = ['general', 'playback', 'hotkeys', 'window', 'advanced'];
    const results = {};
    for (const tab of tabs) {
        const tabBtn = page.getByRole('tab', { name: new RegExp(`^${tab}$`, 'i') });
        const count = await tabBtn.count();
        if (!count) {
            results[tab] = { present: false };
            log(`tab "${tab}" not found in tab list (expected for non-electron on window)`);
            continue;
        }
        await tabBtn.first().click().catch((e) => log(`click "${tab}" failed:`, e.message));
        await page.waitForTimeout(1800);
        const info = await page.evaluate(() => {
            const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
            const visible = panels.filter((p) => p.offsetParent !== null || p.getClientRects().length > 0);
            const panel = visible[visible.length - 1] || panels[panels.length - 1] || null;
            const text = panel?.innerText?.trim() || '';
            const errorText = /error|crashed|something went wrong/i.test(text) && text.length < 200;
            return {
                errorLike: errorText,
                panelCount: panels.length,
                textLen: text.length,
                textSample: text.slice(0, 150),
            };
        });
        results[tab] = { present: true, ...info };
        log(`tab "${tab}":`, JSON.stringify(info));
        await page.screenshot({ path: path.join(SNAP, `qa-settings-${tab}-${Date.now()}.png`) });
    }

    // --- Advanced tab: subbox-authored Export/Import settings backup ---
    const advTab = page.getByRole('tab', { name: /^advanced$/i });
    if (await advTab.count()) {
        await advTab.first().click();
        await page.waitForTimeout(600);
    }

    // Read the theme toggle's real starting state (readSystemTheme) so we can
    // flip it, then prove import restores the exported (original) value —
    // exercises the full export -> mutate -> import round trip, not just
    // "the modal opens".
    const readGeneralSettings = () =>
        page.evaluate(() => {
            try {
                return JSON.parse(localStorage.getItem('store_settings') || '{}')?.state?.general ?? null;
            } catch {
                return null;
            }
        });
    const generalBefore = await readGeneralSettings();
    log('general settings before export:', JSON.stringify(generalBefore));

    // Electron's default download behavior for an <a download> click saves
    // straight to the OS Downloads dir with NO 'will-download' handler wired up
    // in src/main — confirmed no page-level Playwright 'download' event fires,
    // but the file really does land (verified once manually: ~/Downloads/subbox-settings.json,
    // valid JSON, ~53KB, correct top-level keys). So: poll the real Downloads dir
    // instead of waiting on a page event.
    const downloadsDir = path.join(os.homedir(), 'Downloads');
    const exportPath = path.join(downloadsDir, 'subbox-settings.json');
    fs.rmSync(exportPath, { force: true }); // in case a prior cycle/user run left one
    const exportBtn = page.locator('button', { hasText: /export/i }).first();
    let downloadInfo = null;
    if (await exportBtn.count()) {
        await exportBtn.click().catch((e) => log('export click failed:', e.message));
        const deadline = Date.now() + 20000;
        while (!fs.existsSync(exportPath) && Date.now() < deadline) {
            await page.waitForTimeout(300);
        }
        log('export file appeared after', 20000 - (deadline - Date.now()), 'ms (approx)');
        if (fs.existsSync(exportPath)) {
            const content = fs.readFileSync(exportPath, 'utf-8');
            let parsed = null;
            try {
                parsed = JSON.parse(content);
            } catch {
                /* leave null */
            }
            downloadInfo = { parsedOk: !!parsed, path: exportPath, sizeBytes: content.length };
        } else {
            downloadInfo = { downloadFired: false };
        }
    } else {
        log('export button not found on advanced tab');
    }
    log('export/import settings backup: export ->', JSON.stringify(downloadInfo));

    // --- Complete the round trip: flip a setting, import the export, confirm revert ---
    let roundTrip = null;
    if (downloadInfo?.parsedOk) {
        const systemThemeToggle = page
            .locator('text=Use system theme')
            .locator('xpath=ancestor::*[self::div][1]')
            .locator('input[type="checkbox"], button[role="switch"]')
            .first();
        const toggleLocator = (await systemThemeToggle.count())
            ? systemThemeToggle
            : page.getByRole('switch').first();
        await toggleLocator.click().catch((e) => log('theme toggle click failed:', e.message));
        await page.waitForTimeout(400);
        const generalAfterFlip = await readGeneralSettings();
        log('general settings after flipping a toggle:', JSON.stringify(generalAfterFlip));

        const importBtn = page.locator('button', { hasText: /import/i }).first();
        await importBtn.click().catch((e) => log('import click failed:', e.message));
        await page.waitForTimeout(800);
        const modalOpenInfo = await page.evaluate(() => {
            const modal = document.querySelector('[role="dialog"]');
            return { modalOpen: !!modal, modalText: modal?.innerText?.trim()?.slice(0, 150) || null };
        });
        log('import modal opened:', JSON.stringify(modalOpenInfo));

        const fileInput = page.locator('input[type="file"]');
        await fileInput.setInputFiles(exportPath).catch((e) => log('setInputFiles failed:', e.message));
        await page.waitForTimeout(800);
        const diffScreenInfo = await page.evaluate(() => {
            const modal = document.querySelector('[role="dialog"]');
            return { text: modal?.innerText?.trim()?.slice(0, 300) || null };
        });
        log('diff-visualiser screen:', JSON.stringify(diffScreenInfo));
        await page.screenshot({ path: path.join(SNAP, `qa-settings-import-diff-${Date.now()}.png`) });

        const importConfirmBtn = page.locator('button', { hasText: /^import$/i }).last();
        await importConfirmBtn.click().catch((e) => log('import-confirm click failed:', e.message));
        await page.waitForTimeout(600);
        const completeText = await page.evaluate(
            () => document.querySelector('[role="dialog"]')?.innerText?.trim() || null,
        );
        log('import-complete screen text:', JSON.stringify(completeText));
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(400);

        const generalAfterImport = await readGeneralSettings();
        roundTrip = {
            completeText,
            matchesOriginal: JSON.stringify(generalAfterImport) === JSON.stringify(generalBefore),
        };
        log('round trip result:', JSON.stringify(roundTrip));
    }

    // Clean up the file we left in the user's real ~/Downloads.
    fs.rmSync(exportPath, { force: true });

    await electronApp.close();
    log('done. tab results:', JSON.stringify(results), 'roundTrip:', JSON.stringify(roundTrip));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
