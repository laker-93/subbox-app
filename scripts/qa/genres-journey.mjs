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

// QA driver: a real-user Library -> Genres journey.
//   grid -> open a genre detail (default target = TRACK -> song list) ->
//   toggle genre target to ALBUM (album grid) -> play a track.
// Mirrors artists-journey.mjs: clicks like a user and reports what it sees so a
// cycle can spot UX friction (empty states, confusing toggle label, broken nav)
// rather than assume from source.
//
// Requires a development-mode Electron build (out/main/index.js) pointing at the
// local stack. Usage: node scripts/qa/genres-journey.mjs

const MAIN_ENTRY = resolveAppEntry();
const SNAP = path.join(ROOT, '.ui-snapshots');

const log = (...a) => console.log('[genres-journey]', ...a);

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

    // Land on a clean Library view (appMode='library', right queue collapsed) so
    // a prior cycle's Sync mode / open queue panel doesn't hide the grid.
    const stateBefore = await page.evaluate(() => {
        try {
            const s = JSON.parse(localStorage.getItem('store_app') || '{}')?.state || {};
            return { appMode: s.appMode ?? null, rightExpanded: s.sidebar?.rightExpanded ?? null };
        } catch {
            return { appMode: null, rightExpanded: null };
        }
    });
    log('state at launch:', JSON.stringify(stateBefore));
    // Force default genre target = TRACK so we drive the documented default first,
    // then toggle to ALBUM ourselves. genreTarget lives in the persisted settings
    // store (store_settings -> state.general.genreTarget: 'track' | 'album').
    const forcedTarget = await page.evaluate(() => {
        const app = JSON.parse(localStorage.getItem('store_app') || '{}');
        if (app.state) {
            app.state.appMode = 'library';
            if (app.state.sidebar) app.state.sidebar.rightExpanded = false;
        }
        localStorage.setItem('store_app', JSON.stringify(app));
        let prev = null;
        try {
            const settings = JSON.parse(localStorage.getItem('store_settings') || '{}');
            prev = settings?.state?.general?.genreTarget ?? null;
            if (settings?.state?.general) {
                settings.state.general.genreTarget = 'track';
                localStorage.setItem('store_settings', JSON.stringify(settings));
            }
        } catch {
            /* ignore */
        }
        return prev;
    });
    log('genreTarget before (forced to track):', JSON.stringify(forcedTarget));
    await page.reload();
    // networkidle can hang on a lingering stream/websocket connection; fall back
    // to domcontentloaded + a fixed settle so the journey still proceeds.
    await page
        .waitForLoadState('networkidle', { timeout: 8000 })
        .catch(() => log('networkidle timed out after reload; continuing on domcontentloaded'));
    await page.waitForTimeout(1500);
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(800);

    // --- Genres grid ---
    let stuck = await goto(page, '/library/genres');
    if (stuck) {
        await forceFreshLogin(page);
        await performLogin(page, credentials);
        stuck = await goto(page, '/library/genres');
    }
    log('genres route stuck?', stuck);

    const gridInfo = await page.evaluate(() => {
        const anchors = Array.from(
            document.querySelectorAll('a[href*="/library/genres/"]'),
        ).map((a) => a.getAttribute('href'));
        const gridCards = document.querySelectorAll(
            '[data-index], [class*="Card" i] [class*="image" i], [class*="grid" i] [role="button"]',
        ).length;
        const rows = document.querySelectorAll('[role="row"]').length;
        const spinner = !!document.querySelector('[class*="spinner" i], [class*="Spinner" i]');
        const bodyText = document.body.innerText || '';
        const emptyHint = /no results|nothing|empty|no genres/i.test(bodyText.slice(0, 800));
        return {
            emptyHint,
            genreLinkCount: anchors.length,
            genreLinks: anchors.slice(0, 5),
            gridCards,
            rows,
            spinner,
        };
    });
    log('grid:', JSON.stringify(gridInfo));
    await page.screenshot({ path: path.join(SNAP, `qa-genres-grid-${Date.now()}.png`) });

    if (gridInfo.genreLinkCount === 0 && gridInfo.gridCards === 0 && gridInfo.rows === 0) {
        log('NO genre cards/rows rendered — cannot continue. Dumping body text sample.');
        const sample = await page.evaluate(() => document.body.innerText.slice(0, 500));
        log('body sample:', JSON.stringify(sample));
        await electronApp.close();
        return;
    }

    // --- Genre detail: click the first genre like a user, read where it went ---
    const beforeUrl = page.url();
    const firstGenreLink = page.locator('a[href*="/library/genres/"]').first();
    let detailUrl = null;
    let genreId = null;
    if (await firstGenreLink.count()) {
        detailUrl = await firstGenreLink.getAttribute('href');
        await firstGenreLink.click().catch((e) => log('genre click failed:', e.message));
        await waitForRouteSettled(page);
        await page.waitForTimeout(1500);
        detailUrl = page.url().split('#')[1] || detailUrl;
        genreId = (detailUrl.match(/\/library\/genres\/([^/?#]+)/) || [])[1] || null;
    } else {
        log('no genre link anchor found; cannot open detail');
    }
    log('navigated from', beforeUrl.split('#')[1], '->', detailUrl, 'genreId', genreId);
    const cardNavWorked = /\/library\/genres\/[^/?#]+/.test(detailUrl || '');
    log('first-card nav reached a genre detail?', cardNavWorked);

    // Watch for stream.view requests from here on so we can prove playback of a
    // genre track actually started (a queue swap fetches a new stream URL).
    const streamReqs = [];
    page.on('request', (r) => {
        if (/\/rest\/stream\.view/.test(r.url())) streamReqs.push(r.url().replace(/^.*id=/, 'id='));
    });

    // The app's first grid genre ("Dance") happens to have only 1 song/1 album —
    // a poor content test. For the detail/toggle/play verification, deep-link to a
    // deterministically rich genre ("Electronic": 146 songs / 60 albums) with the
    // target forced to TRACK so we drive the documented default first.
    const RICH_GENRE = process.env.QA_GENRE_ID || '7bLYq0Np81m1Wgy5N31nuG'; // Electronic
    await page.evaluate(() => {
        try {
            const s = JSON.parse(localStorage.getItem('store_settings') || '{}');
            if (s?.state?.general) {
                s.state.general.genreTarget = 'track';
                localStorage.setItem('store_settings', JSON.stringify(s));
            }
        } catch {
            /* ignore */
        }
    });
    await goto(page, `/library/genres/${RICH_GENRE}`);
    await page.reload();
    await page
        .waitForLoadState('networkidle', { timeout: 8000 })
        .catch(() => {});
    await page.waitForTimeout(2000);

    // Target = TRACK -> a SongListView scoped to this genre. ag-grid data rows are
    // 0-height role=row, so count the on-screen row elements broadly too.
    const trackView = await page.evaluate(() => {
        const dataRows = document.querySelectorAll('.ag-center-cols-container [role="row"]').length;
        const anyRows = document.querySelectorAll('[role="row"]').length;
        const target = (() => {
            try {
                return JSON.parse(localStorage.getItem('store_settings') || '{}')?.state?.general
                    ?.genreTarget;
            } catch {
                return null;
            }
        })();
        const badge = document.querySelector('[class*="badge" i]')?.textContent?.trim() || null;
        const toggle = Array.from(document.querySelectorAll('button')).find((b) =>
            /^(tracks|albums)$/i.test((b.textContent || '').trim()),
        );
        const errorPage = /unable to route request/i.test(document.body.innerText);
        return {
            anyRows,
            badge,
            dataRows,
            errorPage,
            target,
            toggleLabel: toggle ? (toggle.textContent || '').trim() : null,
        };
    });
    log('track view (default target):', JSON.stringify(trackView));
    await page.screenshot({ path: path.join(SNAP, `qa-genre-detail-tracks-${Date.now()}.png`) });

    // --- Genre target toggle: Tracks -> Albums (the distinctive genre control) ---
    // Do this before playback so an open play popover can't intercept the click.
    const readTarget = () =>
        page.evaluate(() => {
            try {
                return JSON.parse(localStorage.getItem('store_settings') || '{}')?.state?.general
                    ?.genreTarget ?? null;
            } catch {
                return null;
            }
        });
    const toggleBtn = page
        .locator('button')
        .filter({ hasText: /^(Tracks|Albums)$/ })
        .first();
    let toggledTo = null;
    if (await toggleBtn.count()) {
        const labelBefore = (await toggleBtn.textContent())?.trim();
        await toggleBtn.click().catch((e) => log('toggle click failed:', e.message));
        await page.waitForTimeout(1800);
        toggledTo = await readTarget();
        log('toggle: label was', JSON.stringify(labelBefore), '-> target now', toggledTo);
    } else {
        log('no genre-target toggle button found');
    }
    const albumView = await page.evaluate(() => {
        const albumAnchors = document.querySelectorAll('a[href*="/library/albums/"]').length;
        const gridCards = document.querySelectorAll(
            '[data-index], [class*="Card" i] [class*="image" i]',
        ).length;
        const badge = document.querySelector('[class*="badge" i]')?.textContent?.trim() || null;
        const toggle = Array.from(document.querySelectorAll('button')).find((b) =>
            /^(tracks|albums)$/i.test((b.textContent || '').trim()),
        );
        return {
            albumLinks: albumAnchors,
            badge,
            gridCards,
            toggleLabel: toggle ? (toggle.textContent || '').trim() : null,
        };
    });
    log('album view (after toggle):', JSON.stringify(albumView));
    await page.screenshot({ path: path.join(SNAP, `qa-genre-detail-albums-${Date.now()}.png`) });

    // Toggle back to Tracks for the playback step.
    const toggleBack = page
        .locator('button')
        .filter({ hasText: /^(Tracks|Albums)$/ })
        .first();
    if ((await toggleBack.count()) && /^Albums$/.test(((await toggleBack.textContent()) || '').trim())) {
        await toggleBack.click().catch(() => {});
        await page.waitForTimeout(1800);
    }
    log('target back to:', await readTarget());

    // --- Play a track from the genre track list ---
    // Primary gesture: double-click the first data row (ag-grid header is
    // aria-rowindex=1, first data row =2). Rows are 0-height so double-click the
    // row-element coordinate.
    const beforeBar = await page.evaluate(() => {
        const bar = document.querySelector('[class*="playerbar" i], [class*="PlayerBar" i]');
        return bar?.textContent?.trim()?.slice(0, 120) || null;
    });
    log('player bar before play:', JSON.stringify(beforeBar));
    const streamsBefore = streamReqs.length;
    const dataRow = page.locator('[role="row"][aria-rowindex="2"]').first();
    if (await dataRow.count()) {
        const box = await dataRow.boundingBox().catch(() => null);
        if (box) {
            // ag-grid rows report height 0 in this build, but the visual row is
            // drawn downward from box.y — double-click ~18px below the top edge.
            const y = box.height > 4 ? box.y + box.height / 2 : box.y + 18;
            await page.mouse.dblclick(box.x + Math.min(box.width / 2, 200), y);
            await page.waitForTimeout(3000);
        } else {
            log('data row has no box');
        }
    } else {
        log('no aria-rowindex=2 data row found');
    }
    // Fallback: header Play button -> popover -> filled Play-Now option.
    if (streamReqs.length === streamsBefore) {
        log('row double-click produced no new stream; trying header Play popover');
        const playButton = page.locator('button[class*="text-button" i]').first();
        if (await playButton.count()) {
            await playButton.click().catch((e) => log('header play click failed:', e.message));
            await page.waitForTimeout(1000);
            const playNow = page.locator('button[class*="play-button-module-fill" i]').first();
            if (await playNow.count()) {
                await playNow.click().catch((e) => log('popover Play Now click failed:', e.message));
                await page.waitForTimeout(3500);
            } else {
                log('popover opened but no filled Play-Now button found');
            }
        }
    }
    const afterPlay = await page.evaluate(() => {
        const audio = document.querySelector('audio');
        const bar = document.querySelector('[class*="playerbar" i], [class*="PlayerBar" i]');
        return {
            audioCurrentTime: audio ? Number(audio.currentTime.toFixed(1)) : null,
            audioPaused: audio ? audio.paused : null,
            audioSrc: audio?.currentSrc ? audio.currentSrc.slice(0, 80) : null,
            barText: bar?.textContent?.trim()?.slice(0, 120) || null,
        };
    });
    log('after play:', JSON.stringify(afterPlay), 'newStreams:', streamReqs.length - streamsBefore);
    await page.screenshot({ path: path.join(SNAP, `qa-genre-playing-${Date.now()}.png`) });

    await electronApp.close();
    log('done');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
