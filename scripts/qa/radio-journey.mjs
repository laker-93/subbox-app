import path from 'path';
import { _electron as electron } from 'playwright';

import {
    forceFreshLogin,
    getCredentials,
    isLoggedOut,
    performLogin,
    resolveAppEntry,
    ROOT,
    waitForRouteSettled,
} from '../ui-snapshot-shared.mjs';

// QA driver: real-user Radio journey (`/radio`) — the last unchecked README
// coverage row. Internet radio stations (Subsonic createInternetRadioStation),
// distinct from the subbox artist/track/album "radio" context-menu actions.
// Drives: empty/list state -> create a station -> play it -> confirm player-bar
// metadata -> stop -> edit/delete permission check -> delete the scratch station.
//
// Uses a real, long-running public Icecast test stream (SomaFM Groove Salad)
// so playback can be verified against genuine audio, not a stub URL.
//
// Requires a development-mode Electron build (out/main/index.js) pointing at
// the local stack. Usage: node scripts/qa/radio-journey.mjs

const MAIN_ENTRY = resolveAppEntry();
const SNAP = path.join(ROOT, '.ui-snapshots');
const TEST_STREAM_URL = 'https://ice1.somafm.com/groovesalad-128-mp3';
const TEST_STATION_NAME = `QA Radio Test ${Date.now()}`;

const log = (...a) => console.log('[radio-journey]', ...a);

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

    // Force a fresh login: a persisted session from an older cycle can carry a
    // stale isAdmin value, which would incorrectly hide the edit/delete controls
    // this driver exercises below.
    await forceFreshLogin(page);
    await performLogin(page, credentials);

    let stuck = await goto(page, '/radio');
    if (stuck) {
        await forceFreshLogin(page);
        await performLogin(page, credentials);
        stuck = await goto(page, '/radio');
    }
    await page.waitForTimeout(1200);
    log('radio route stuck?', stuck);

    const initialState = await page.evaluate(() => {
        const bodyText = document.body.innerText || '';
        return {
            createBtnVisible: /create radio station/i.test(bodyText),
            emptyHint: /no results|nothing|empty|no radio/i.test(bodyText.slice(0, 800)),
        };
    });
    log('initial state:', JSON.stringify(initialState));
    await page.screenshot({ path: path.join(SNAP, `qa-radio-list-${Date.now()}.png`) });

    // --- Create a station ---
    const createBtn = page.getByRole('button', { name: /create radio station/i });
    if (!(await createBtn.isVisible().catch(() => false))) {
        log('NO create-station button visible — cannot continue.');
        await electronApp.close();
        return;
    }
    await createBtn.click();
    await page.waitForTimeout(500);

    const nameInput = page.getByLabel(/name/i).first();
    const streamInput = page.getByLabel(/stream url/i).first();
    const modalVisible = await nameInput.isVisible().catch(() => false);
    log('create-station modal opened?', modalVisible);
    if (!modalVisible) {
        await page.screenshot({ path: path.join(SNAP, `qa-radio-modal-missing-${Date.now()}.png`) });
        await electronApp.close();
        return;
    }
    await nameInput.fill(TEST_STATION_NAME);
    await streamInput.fill(TEST_STREAM_URL);
    await page.screenshot({ path: path.join(SNAP, `qa-radio-create-form-${Date.now()}.png`) });

    const submitBtn = page.getByRole('button', { name: /^create$/i });
    await submitBtn.click();
    await page.waitForTimeout(1500);

    const afterCreate = await page.evaluate((stationName) => {
        return {
            errorToast: /failed|error/i.test(document.body.innerText.slice(-800)),
            modalClosed: !document.body.innerText.includes('Stream Url'),
            stationVisible: document.body.innerText.includes(stationName),
        };
    }, TEST_STATION_NAME);
    log('after create:', JSON.stringify(afterCreate));
    await page.screenshot({ path: path.join(SNAP, `qa-radio-after-create-${Date.now()}.png`) });

    if (!afterCreate.stationVisible) {
        log('created station not visible in list — stopping here.');
        await electronApp.close();
        return;
    }

    // --- Play the created station ---
    // Scope to the list-row button specifically — the player bar also renders a
    // link back to /radio with the same station-name text once playing, and an
    // unscoped text locator matches both (strict-mode violation).
    const stationRow = page.getByRole('button', { name: new RegExp(TEST_STATION_NAME) });
    await stationRow.click().catch((e) => log('station click failed:', e.message));
    await page.waitForTimeout(4000);

    const playingState = await page.evaluate((stationName) => {
        const audio = document.querySelector('audio, video');
        const barText = document.body.innerText || '';
        return {
            audioCurrentTime: audio ? Number(audio.currentTime.toFixed(1)) : null,
            audioPaused: audio ? audio.paused : null,
            audioSrc: audio ? audio.currentSrc : null,
            stationNameInPlayerBar: barText.includes(stationName),
        };
    }, TEST_STATION_NAME);
    log('playing state:', JSON.stringify(playingState));
    await page.screenshot({ path: path.join(SNAP, `qa-radio-playing-${Date.now()}.png`) });

    // --- Stop playback (click the same row again) ---
    await stationRow.click().catch((e) => log('stop click failed:', e.message));
    await page.waitForTimeout(1500);
    const stoppedState = await page.evaluate(() => {
        const audio = document.querySelector('audio, video');
        return { audioPaused: audio ? audio.paused : null };
    });
    log('stopped state:', JSON.stringify(stoppedState));

    // --- Permission check + cleanup: edit/delete ActionIcons render with no
    // aria-label/title (Mantine Tooltip is portal-only, hover-triggered) — scope
    // to the station's own row container and take the buttons after the play
    // button (play, edit, delete in DOM order per radio-list-items.tsx).
    const rowContainer = page
        .locator('[class*="radio-item" i]:not([class*="button" i])')
        .filter({ hasText: TEST_STATION_NAME });
    const rowButtons = rowContainer.locator('button');
    const rowButtonCount = await rowButtons.count();
    log('permissions: buttons in row (1=play only, 3=play+edit+delete):', rowButtonCount);

    if (rowButtonCount >= 3) {
        const deleteBtn = rowButtons.last();
        await deleteBtn.click();
        await page.waitForTimeout(500);
        const confirmBtn = page.getByRole('button', { name: /^delete$/i }).last();
        if (await confirmBtn.isVisible().catch(() => false)) {
            await confirmBtn.click();
            await page.waitForTimeout(1500);
        }
        const afterDelete = await page.evaluate((stationName) => {
            return { stationStillVisible: document.body.innerText.includes(stationName) };
        }, TEST_STATION_NAME);
        log('after delete:', JSON.stringify(afterDelete));
        await page.screenshot({ path: path.join(SNAP, `qa-radio-after-delete-${Date.now()}.png`) });
    } else {
        log('edit/delete controls not present on this row — scratch station NOT cleaned up automatically (needs manual/API cleanup)');
    }

    await electronApp.close();
    log('done');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
