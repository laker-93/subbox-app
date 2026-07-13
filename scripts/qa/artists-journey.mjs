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

// QA driver: a real-user Library → Artists journey.
//   grid → open an artist detail → inspect top songs + discography → play.
// Mirrors albums-journey.mjs: clicks like a user and reports what it sees so a
// cycle can spot UX friction (empty states, missing feedback, broken nav)
// rather than assume from source.
//
// Requires a development-mode Electron build (out/main/index.js) pointing at the
// local stack. Usage: node scripts/qa/artists-journey.mjs

const MAIN_ENTRY = resolveAppEntry();
const SNAP = path.join(ROOT, '.ui-snapshots');

const log = (...a) => console.log('[artists-journey]', ...a);

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

    // Persisted state can hide/crowd the library content, the same way it would
    // for a real user returning to the app:
    //  - appMode='sync' gates the whole router Outlet (shows the Sync placeholder).
    //  - sidebar.rightExpanded=true keeps the 600px queue panel open on the right.
    // Land on a clean Library view (right queue collapsed) so the grid has room.
    const stateBefore = await page.evaluate(() => {
        try {
            const s = JSON.parse(localStorage.getItem('store_app') || '{}')?.state || {};
            return { appMode: s.appMode ?? null, rightExpanded: s.sidebar?.rightExpanded ?? null };
        } catch {
            return { appMode: null, rightExpanded: null };
        }
    });
    log('state at launch:', JSON.stringify(stateBefore));
    // Also clear any persisted Artists "Role" filter (e.g. Composer) — a non-empty
    // role surfaces role-only artists (composers) whose album-artist detail page is
    // empty. Clearing it drives the default happy path a fresh user sees.
    const clearedRole = await page.evaluate(() => {
        let cleared = null;
        for (const k of Object.keys(localStorage)) {
            if (!k.endsWith('-filters')) continue;
            try {
                const v = JSON.parse(localStorage.getItem(k) || '{}');
                if (v?.artist?.role) {
                    cleared = v.artist.role;
                    v.artist.role = '';
                    localStorage.setItem(k, JSON.stringify(v));
                }
            } catch {
                /* ignore */
            }
        }
        const app = JSON.parse(localStorage.getItem('store_app') || '{}');
        if (app.state) {
            app.state.appMode = 'library';
            if (app.state.sidebar) app.state.sidebar.rightExpanded = false;
        }
        localStorage.setItem('store_app', JSON.stringify(app));
        return cleared;
    });
    log('cleared persisted artist role filter:', JSON.stringify(clearedRole));
    await page.reload();
    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(800);

    // --- Artists grid ---
    let stuck = await goto(page, '/library/artists');
    if (stuck) {
        await forceFreshLogin(page);
        await performLogin(page, credentials);
        stuck = await goto(page, '/library/artists');
    }
    log('artists route stuck?', stuck);

    const gridInfo = await page.evaluate(() => {
        // On Subsonic/Navidrome an "Artist" card's _itemType is ALBUM_ARTIST, so
        // the card link is /library/album-artists/:id, not /library/artists/:id.
        // Collect both so we see what the grid actually links to.
        const artistAnchors = Array.from(
            document.querySelectorAll('a[href*="/library/artists/"]'),
        ).map((a) => a.getAttribute('href'));
        const albumArtistAnchors = Array.from(
            document.querySelectorAll('a[href*="/library/album-artists/"]'),
        ).map((a) => a.getAttribute('href'));
        const gridCards = document.querySelectorAll(
            '[data-index], [class*="Card" i] [class*="image" i], [class*="grid" i] [role="button"]',
        ).length;
        const spinner = !!document.querySelector('[class*="spinner" i], [class*="Spinner" i]');
        const bodyText = document.body.innerText || '';
        const emptyHint = /no results|nothing|empty|no artists/i.test(bodyText.slice(0, 800));
        return {
            albumArtistLinkCount: albumArtistAnchors.length,
            albumArtistLinks: albumArtistAnchors.slice(0, 3),
            artistLinkCount: artistAnchors.length,
            artistLinks: artistAnchors.slice(0, 3),
            emptyHint,
            gridCards,
            spinner,
        };
    });
    log('grid:', JSON.stringify(gridInfo));
    await page.screenshot({ path: path.join(SNAP, `qa-artists-grid-${Date.now()}.png`) });

    if (gridInfo.gridCards === 0) {
        log('NO artist cards rendered — cannot continue. Dumping body text sample.');
        const sample = await page.evaluate(() => document.body.innerText.slice(0, 500));
        log('body sample:', JSON.stringify(sample));
        await electronApp.close();
        return;
    }

    // --- Artist detail: click the first card like a user, then read where it went ---
    const beforeUrl = page.url();
    const firstCardLink = page
        .locator('a[href*="/library/album-artists/"], a[href*="/library/artists/"]')
        .first();
    let detailUrl = null;
    let artistId = null;
    if (await firstCardLink.count()) {
        const href = await firstCardLink.getAttribute('href');
        detailUrl = href;
        await firstCardLink.click().catch((e) => log('card click failed:', e.message));
        await waitForRouteSettled(page);
        await page.waitForTimeout(1500);
        detailUrl = page.url().split('#')[1] || detailUrl;
        artistId = (detailUrl.match(/\/(?:album-)?artists\/([^/?#]+)/) || [])[1] || null;
    } else {
        log('no card link anchor found despite gridCards>0; cannot open detail');
    }
    log('navigated from', beforeUrl.split('#')[1], '->', detailUrl, 'artistId', artistId);
    stuck = false;
    // Detect whether the artist card routed to the album-artist detail (Subsonic conflation).
    const routedToAlbumArtist = /\/library\/album-artists\//.test(detailUrl || '');
    log('routed to album-artist detail?', routedToAlbumArtist);

    const detailInfo = await page.evaluate(() => {
        const heading =
            document.querySelector('h1, [class*="title" i]')?.textContent?.trim() || null;
        const rows = document.querySelectorAll('[role="row"]');
        // album cards in the discography carousel
        const albumAnchors = document.querySelectorAll('a[href*="/library/albums/"]');
        const playBtn = Array.from(document.querySelectorAll('button')).find((b) =>
            /play/i.test(b.getAttribute('aria-label') || b.textContent || ''),
        );
        // any visible section headings (Top Songs / Discography etc.)
        const sections = Array.from(document.querySelectorAll('h2, h3, [class*="sectionTitle" i]'))
            .map((el) => el.textContent?.trim())
            .filter(Boolean)
            .slice(0, 8);
        const bodyLen = document.body.innerText.length;
        return {
            bodyLen,
            discographyAlbumLinks: albumAnchors.length,
            hasPlayButton: !!playBtn,
            heading,
            sections,
            trackRows: rows.length,
        };
    });
    log('detail:', JSON.stringify(detailInfo));
    await page.screenshot({ path: path.join(SNAP, `qa-artist-detail-${Date.now()}.png`) });

    // Base path to build sub-routes from (whichever the card actually routed to).
    const detailBase = routedToAlbumArtist
        ? `/library/album-artists/${artistId}`
        : `/library/artists/${artistId}`;

    // --- Top songs sub-route ---
    stuck = await goto(page, `${detailBase}/top-songs`);
    await page.waitForTimeout(1200);
    const topSongs = await page.evaluate(() => {
        const rows = document.querySelectorAll('[role="row"]');
        const errorPage = /unable to route request/i.test(document.body.innerText);
        const empty = /no .*songs|nothing|empty/i.test(document.body.innerText.slice(0, 400));
        return { emptyHint: empty, errorPage, rows: rows.length };
    });
    log('top-songs:', JSON.stringify(topSongs), 'stuck?', stuck);
    await page.screenshot({ path: path.join(SNAP, `qa-artist-topsongs-${Date.now()}.png`) });

    // --- Discography sub-route ---
    stuck = await goto(page, `${detailBase}/discography`);
    await page.waitForTimeout(1200);
    const disco = await page.evaluate(() => {
        const albumAnchors = document.querySelectorAll('a[href*="/library/albums/"]');
        const errorPage = /unable to route request/i.test(document.body.innerText);
        return { albumLinks: albumAnchors.length, errorPage };
    });
    log('discography:', JSON.stringify(disco), 'stuck?', stuck);
    await page.screenshot({ path: path.join(SNAP, `qa-artist-discography-${Date.now()}.png`) });

    // --- Play from artist detail ---
    await goto(page, detailBase);
    await page.waitForTimeout(1500);
    const beforeBar = await page.evaluate(() => {
        const bar = document.querySelector('[class*="playerbar" i], [class*="PlayerBar" i]');
        return bar?.textContent?.trim()?.slice(0, 200) || null;
    });
    log('player bar before play:', JSON.stringify(beforeBar));

    const playButton = page.getByRole('button', { name: /^play$/i }).first();
    if (await playButton.isVisible().catch(() => false)) {
        await playButton.click().catch((e) => log('play click failed:', e.message));
        await page.waitForTimeout(3500);
    } else {
        log('no artist Play button visible');
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
    await page.screenshot({ path: path.join(SNAP, `qa-artist-playing-${Date.now()}.png`) });

    await electronApp.close();
    log('done');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
