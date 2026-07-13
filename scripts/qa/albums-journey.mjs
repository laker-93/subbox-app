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

// QA driver: a real-user Library → Albums journey.
//   grid  → open an album detail → play a track → check the now-playing bar/queue.
// Observational + interactive: it clicks like a user and reports what it sees,
// so a cycle can spot UX friction (empty states, missing feedback, broken nav)
// rather than assume from source.
//
// Requires a development-mode Electron build (out/main/index.js) pointing at the
// local stack. Usage: node scripts/qa/albums-journey.mjs

const MAIN_ENTRY = resolveAppEntry();

const log = (...a) => console.log('[albums-journey]', ...a);

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

    if (await isLoggedOut(page)) await performLogin(page, credentials);

    // The app has a persisted Library/Sync appMode toggle that gates the whole
    // router Outlet (main-content.tsx) — if it's 'sync', every library route
    // shows the Sync placeholder. A real user clicks "Library"; do the same.
    const modeBefore = await page.evaluate(() => {
        try {
            return JSON.parse(localStorage.getItem('store_app') || '{}')?.state?.appMode ?? null;
        } catch {
            return null;
        }
    });
    log('appMode at launch:', modeBefore);
    if (modeBefore !== 'library') {
        await page.evaluate(() => {
            const raw = JSON.parse(localStorage.getItem('store_app') || '{}');
            if (raw.state) raw.state.appMode = 'library';
            localStorage.setItem('store_app', JSON.stringify(raw));
        });
        await page.reload();
        await page.waitForLoadState('networkidle');
        if (await isLoggedOut(page)) await performLogin(page, credentials);
        await page.waitForTimeout(500);
    }

    // --- Albums grid ---
    let stuck = await goto(page, '/library/albums');
    if (stuck) {
        await forceFreshLogin(page);
        await performLogin(page, credentials);
        stuck = await goto(page, '/library/albums');
    }
    log('albums route stuck?', stuck);

    // What does the grid render? Album cards are anchors to /library/albums/:id.
    const gridInfo = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href*="/library/albums/"]'));
        const ids = [
            ...new Set(
                anchors
                    .map(
                        (a) =>
                            (a.getAttribute('href') || '').match(
                                /\/library\/albums\/([^/?#]+)/,
                            )?.[1],
                    )
                    .filter(Boolean),
            ),
        ];
        // header/title text on the page
        const title =
            document.querySelector('[class*="PageHeader"], header')?.textContent?.trim() || null;
        return {
            anchorCount: anchors.length,
            title,
            totalUnique: ids.length,
            uniqueAlbumIds: ids.slice(0, 5),
        };
    });
    log('grid:', JSON.stringify(gridInfo));

    await page.screenshot({
        path: path.join(ROOT, '.ui-snapshots', `qa-albums-grid-${Date.now()}.png`),
    });

    if (gridInfo.totalUnique === 0) {
        log('NO album cards found — cannot continue detail/play steps. Dumping body text sample.');
        const sample = await page.evaluate(() => document.body.innerText.slice(0, 500));
        log('body sample:', JSON.stringify(sample));
        await electronApp.close();
        return;
    }

    // --- Album detail ---
    const albumId = gridInfo.uniqueAlbumIds[0];
    stuck = await goto(page, `/library/albums/${albumId}`);
    log('detail route stuck?', stuck, 'albumId', albumId);

    const detailInfo = await page.evaluate(() => {
        const rows = document.querySelectorAll('[role="row"]');
        const playBtn = Array.from(document.querySelectorAll('button')).find((b) =>
            /play/i.test(b.getAttribute('aria-label') || b.textContent || ''),
        );
        const heading =
            document.querySelector('h1, [class*="title" i]')?.textContent?.trim() || null;
        return { hasPlayButton: !!playBtn, heading, rowCount: rows.length };
    });
    log('detail:', JSON.stringify(detailInfo));
    await page.screenshot({
        path: path.join(ROOT, '.ui-snapshots', `qa-album-detail-${Date.now()}.png`),
    });

    // --- Play a track: double-click first track row, then inspect the player bar ---
    const beforeBar = await page.evaluate(() => {
        const bar = document.querySelector('[class*="playerbar" i], [class*="PlayerBar" i]');
        return bar?.textContent?.trim()?.slice(0, 200) || null;
    });
    log('player bar before play:', JSON.stringify(beforeBar));

    // The album header has an explicit "Play" button — the obvious user action.
    const playButton = page.getByRole('button', { name: /^play$/i }).first();
    if (await playButton.isVisible().catch(() => false)) {
        await playButton.click().catch((e) => log('play click failed:', e.message));
        await page.waitForTimeout(3500);
    } else {
        log('no album Play button visible');
    }

    const afterPlay = await page.evaluate(() => {
        const bar = document.querySelector('[class*="playerbar" i], [class*="PlayerBar" i]');
        const audio = document.querySelector('audio');
        return {
            audioCurrentTime: audio ? Number(audio.currentTime.toFixed(1)) : null,
            audioPaused: audio ? audio.paused : null,
            audioSrc: audio?.currentSrc ? audio.currentSrc.slice(0, 80) : null,
            barText: bar?.textContent?.trim()?.slice(0, 200) || null,
        };
    });
    log('after play:', JSON.stringify(afterPlay));
    await page.screenshot({
        path: path.join(ROOT, '.ui-snapshots', `qa-album-playing-${Date.now()}.png`),
    });

    // --- Now-playing / queue route (real route is /now-playing; /playing is a
    //     dead enum value nothing navigates to) ---
    stuck = await goto(page, '/now-playing');
    const queueInfo = await page.evaluate(() => {
        const rows = document.querySelectorAll('[role="row"]');
        const bodyText = document.body.innerText;
        const errorPage = /unable to route request/i.test(bodyText);
        return { errorPage, rowCount: rows.length };
    });
    log('/now-playing queue rows:', JSON.stringify(queueInfo), 'stuck?', stuck);
    await page.screenshot({
        path: path.join(ROOT, '.ui-snapshots', `qa-nowplaying-queue-${Date.now()}.png`),
    });

    await electronApp.close();
    log('done');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
