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

// QA driver: a real-user Library → Album Artists journey, driven via the
// dedicated /library/album-artists nav item (not via an Artists-grid card
// click, which artists-journey.mjs already covers and which happens to land
// on the same detail route). Confirms:
//   - the Album Artists grid itself (the clean album-artist index, distinct
//     from the native "Artists" list which includes role-only artists)
//   - detail page reached directly from this list
//   - the sub-routes unique to this route family: songs, favorite-songs,
//     top-songs, discography
//
// Requires a development-mode Electron build (out/main/index.js) pointing at
// the local stack. Usage: node scripts/qa/album-artists-journey.mjs

const MAIN_ENTRY = resolveAppEntry();
const SNAP = path.join(ROOT, '.ui-snapshots');

const log = (...a) => console.log('[album-artists-journey]', ...a);

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

    // Land on a clean Library view — same reasoning as artists-journey.mjs
    // (persisted sync mode / expanded queue panel can hide the grid).
    await page.evaluate(() => {
        const app = JSON.parse(localStorage.getItem('store_app') || '{}');
        if (app.state) {
            app.state.appMode = 'library';
            if (app.state.sidebar) app.state.sidebar.rightExpanded = false;
        }
        localStorage.setItem('store_app', JSON.stringify(app));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(800);

    // --- Album Artists grid ---
    let stuck = await goto(page, '/library/album-artists');
    if (stuck) {
        await forceFreshLogin(page);
        await performLogin(page, credentials);
        stuck = await goto(page, '/library/album-artists');
    }
    log('album-artists route stuck?', stuck);

    const gridInfo = await page.evaluate(() => {
        const links = Array.from(
            document.querySelectorAll('a[href*="/library/album-artists/"]'),
        ).map((a) => a.getAttribute('href'));
        const gridCards = document.querySelectorAll(
            '[data-index], [class*="Card" i] [class*="image" i], [class*="grid" i] [role="button"]',
        ).length;
        const spinner = !!document.querySelector('[class*="spinner" i], [class*="Spinner" i]');
        const bodyText = document.body.innerText || '';
        const emptyHint = /no results|nothing|empty|no artists/i.test(bodyText.slice(0, 800));
        // Sort/filter controls a real user would notice on this list page.
        const hasSortControl = !!document.querySelector(
            'button[aria-label*="sort" i], [class*="sort" i] button',
        );
        return {
            emptyHint,
            gridCards,
            hasSortControl,
            linkCount: links.length,
            sampleLinks: [...new Set(links)].slice(0, 3),
            spinner,
        };
    });
    log('grid:', JSON.stringify(gridInfo));
    await page.screenshot({ path: path.join(SNAP, `qa-album-artists-grid-${Date.now()}.png`) });

    if (gridInfo.gridCards === 0) {
        log('NO album-artist cards rendered — cannot continue. Dumping body sample.');
        const sample = await page.evaluate(() => document.body.innerText.slice(0, 500));
        log('body sample:', JSON.stringify(sample));
        await electronApp.close();
        return;
    }

    // --- Detail: click the first card like a user ---
    const beforeUrl = page.url();
    const firstCardLink = page.locator('a[href*="/library/album-artists/"]').first();
    let detailUrl = null;
    let artistId = null;
    if (await firstCardLink.count()) {
        const href = await firstCardLink.getAttribute('href');
        detailUrl = href;
        await firstCardLink.click().catch((e) => log('card click failed:', e.message));
        await waitForRouteSettled(page);
        await page.waitForTimeout(1500);
        detailUrl = page.url().split('#')[1] || detailUrl;
        artistId = (detailUrl.match(/\/album-artists\/([^/?#]+)/) || [])[1] || null;
    } else {
        log('no card link anchor found despite gridCards>0; cannot open detail');
    }
    log('navigated from', beforeUrl.split('#')[1], '->', detailUrl, 'artistId', artistId);

    const detailInfo = await page.evaluate(() => {
        const heading =
            document.querySelector('h1, [class*="title" i]')?.textContent?.trim() || null;
        const statLine = document.body.innerText.match(/\d+\s*albums?\s*[•·]\s*\d+\s*tracks?/i)?.[0] || null;
        const playBtn = Array.from(document.querySelectorAll('button')).find((b) =>
            /play/i.test(b.getAttribute('aria-label') || b.textContent || ''),
        );
        return { hasPlayButton: !!playBtn, heading, statLine };
    });
    log('detail:', JSON.stringify(detailInfo));
    await page.screenshot({ path: path.join(SNAP, `qa-album-artist-detail-${Date.now()}.png`) });

    if (!artistId) {
        log('no artistId resolved; skipping sub-routes');
        await electronApp.close();
        return;
    }
    const detailBase = `/library/album-artists/${artistId}`;

    // --- Sub-routes unique to this detail family ---
    for (const sub of ['songs', 'favorite-songs', 'top-songs', 'discography']) {
        stuck = await goto(page, `${detailBase}/${sub}`);
        await page.waitForTimeout(1200);
        const info = await page.evaluate(() => {
            const rows = document.querySelectorAll('[role="row"]');
            const albumAnchors = document.querySelectorAll('a[href*="/library/albums/"]');
            const errorPage = /unable to route request/i.test(document.body.innerText);
            const emptyHint = /no .*(songs|tracks)|nothing|empty/i.test(
                document.body.innerText.slice(0, 400),
            );
            return { albumLinks: albumAnchors.length, emptyHint, errorPage, rows: rows.length };
        });
        log(`sub-route ${sub}:`, JSON.stringify(info), 'stuck?', stuck);
        await page.screenshot({ path: path.join(SNAP, `qa-album-artist-${sub}-${Date.now()}.png`) });
    }

    // --- Play from the detail page ---
    await goto(page, detailBase);
    await page.waitForTimeout(1500);
    const playButton = page.getByRole('button', { name: /^play$/i }).first();
    if (await playButton.isVisible().catch(() => false)) {
        await playButton.click().catch((e) => log('play click failed:', e.message));
        await page.waitForTimeout(3500);
    } else {
        log('no album-artist Play button visible');
    }
    const afterPlay = await page.evaluate(() => {
        const audio = document.querySelector('audio');
        const bar = document.querySelector('[class*="playerbar" i], [class*="PlayerBar" i]');
        return {
            audioCurrentTime: audio ? Number(audio.currentTime.toFixed(1)) : null,
            audioPaused: audio ? audio.paused : null,
            barText: bar?.textContent?.trim()?.slice(0, 200) || null,
        };
    });
    log('after play:', JSON.stringify(afterPlay));
    await page.screenshot({ path: path.join(SNAP, `qa-album-artist-playing-${Date.now()}.png`) });

    await electronApp.close();
    log('done');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
