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

// QA driver: a real-user full-page Search journey (`/search/:itemType`).
//   deep-link search → verify results per tab (Tracks / Albums / Artists) →
//   drive the live SearchInput (collapse→expand→type, 200ms debounce) →
//   exercise edge states (no-match empty, cleared query).
// Observational + interactive — reports what it sees so a cycle can spot
// UX friction (missing empty state, stale results, broken tab nav) rather than
// assume from source. Client-only; hits Navidrome search, not pymix.
//
// Requires a development-mode Electron build (out/main/index.js) pointing at the
// local stack. Usage: node scripts/qa/search-journey.mjs

const MAIN_ENTRY = resolveAppEntry();
const MATCH_TERM = 'Hamdi'; // matches songs (Damager (Hamdi Edit)…), an album, + the Hamdi artist
const NOMATCH_TERM = 'zzqqxnomatchzz';

const log = (...a) => console.log('[search-journey]', ...a);

async function goto(page, route) {
    const baseUrl = page.url().split('#')[0];
    await page.goto(`${baseUrl}#${route}`);
    const stuck = await waitForRouteSettled(page);
    return stuck;
}

// The full-page SearchInput is a collapse-to-expand magnifier ActionIcon at the
// top-right of the content header (idx0 sidebar "Search" box is the SEPARATE global
// command palette). Automating the expand+type widget is flaky, but SearchContent
// reads `?query=` from the URL directly, so deep-linking the query is the reliable,
// behaviour-equivalent programmatic entry — that's what this driver uses. Tab
// switching below is still driven by real button clicks.

// Snapshot what the search results area is showing right now.
async function readResults(page) {
    return page.evaluate(() => {
        const rows = document.querySelectorAll('[role="row"]');
        // grid-card anchors (albums/artists render as cards or rows depending on display)
        const albumAnchors = document.querySelectorAll('a[href*="/library/albums/"]');
        const artistAnchors = document.querySelectorAll('a[href*="/library/album-artists/"]');
        const body = document.body.innerText;
        const emptyState =
            /no results|nothing found|no items|empty/i.test(body) &&
            rows.length === 0 &&
            albumAnchors.length === 0;
        const inputVal =
            document.querySelector('input[type="text"], input:not([type])')?.value ?? null;
        return {
            albumAnchorCount: albumAnchors.length,
            artistAnchorCount: artistAnchors.length,
            emptyStateText: emptyState ? body.slice(0, 200) : null,
            inputVal,
            mentionsDamager: /damager/i.test(body),
            rowCount: rows.length,
        };
    });
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

    // appMode gates the router Outlet; a real user is in Library mode.
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

    const shot = (name) =>
        page.screenshot({
            path: path.join(ROOT, '.ui-snapshots', `qa-search-${name}-${Date.now()}.png`),
        });

    // --- 1. Deep-link song search (searchParams.query drives SearchContent) ---
    let stuck = await goto(page, `/search/song?query=${MATCH_TERM}`);
    if (stuck) {
        await forceFreshLogin(page);
        await performLogin(page, credentials);
        stuck = await goto(page, `/search/song?query=${MATCH_TERM}`);
    }
    await page.waitForTimeout(1500);
    const songRes = await readResults(page);
    log(`songs "${MATCH_TERM}" (stuck=${stuck}):`, JSON.stringify(songRes));
    await shot('songs-match');

    // --- 2. Albums tab (query persists via searchParams) ---
    const albumsTab = page.getByRole('button', { name: /^albums$/i }).first();
    if (await albumsTab.isVisible().catch(() => false)) {
        await albumsTab.click().catch((e) => log('albums tab click failed:', e.message));
        await page.waitForTimeout(1500);
    } else {
        // fall back to direct nav
        await goto(page, `/search/album?query=${MATCH_TERM}`);
        await page.waitForTimeout(1500);
    }
    const albumRes = await readResults(page);
    log(`albums "${MATCH_TERM}":`, JSON.stringify(albumRes));
    await shot('albums-match');

    // --- 3. Artists tab ---
    const artistsTab = page.getByRole('button', { name: /^artists$/i }).first();
    if (await artistsTab.isVisible().catch(() => false)) {
        await artistsTab.click().catch((e) => log('artists tab click failed:', e.message));
        await page.waitForTimeout(1500);
    } else {
        await goto(page, `/search/albumArtist?query=${MATCH_TERM}`);
        await page.waitForTimeout(1500);
    }
    const artistRes = await readResults(page);
    log(`artists "${MATCH_TERM}":`, JSON.stringify(artistRes));
    await shot('artists-match');

    // --- 4. Edge: no-match query → empty state, no crash ---
    stuck = await goto(page, `/search/song?query=${NOMATCH_TERM}`);
    await page.waitForTimeout(1500);
    const emptyRes = await page.evaluate(() => {
        const rows = document.querySelectorAll('[role="row"]');
        // exclude header rows: ag-grid header has role=row too, so count data rows
        const dataRows = document.querySelectorAll('.ag-center-cols-container [role="row"]');
        const body = document.body.innerText;
        const crashed = /unable to route|something went wrong|error boundary/i.test(body);
        return {
            allRowCount: rows.length,
            crashed,
            dataRowCount: dataRows.length,
            bodySample: body.slice(0, 240),
        };
    });
    log(`no-match "${NOMATCH_TERM}" (stuck=${stuck}):`, JSON.stringify(emptyRes));
    await shot('no-match-empty');

    // --- 5. Edge: empty query (cleared) → should render the full/library list, no crash ---
    stuck = await goto(page, `/search/song?query=`);
    await page.waitForTimeout(1500);
    const clearedRes = await readResults(page);
    log(`empty query (stuck=${stuck}):`, JSON.stringify(clearedRes));
    await shot('empty-query');

    await electronApp.close();
    log('done');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
