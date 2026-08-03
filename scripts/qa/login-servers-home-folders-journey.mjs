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

// QA driver: closes out the README's last unchecked upstream rows in one pass —
// "Login / servers" (/login, /servers) + "Home / explore" (/, /explore) +
// "Library — folders" (/library/folders).
//
// The real subbox login path is the pre-login LandingPage -> PymixAuthModal (every
// other driver's performLogin already exercises it). This driver specifically probes
// whether the *classic* Feishin /login + /servers routes (a separate, SERVER_LOCK-
// gated manual-server-entry flow inherited from upstream) are actually reachable/
// functional in a subbox build, since nothing in the app links to them.
//
// Requires a development-mode Electron build (out/main/index.js) pointing at the
// local stack. Usage: node scripts/qa/login-servers-home-folders-journey.mjs

const MAIN_ENTRY = resolveAppEntry();
const SNAP = path.join(ROOT, '.ui-snapshots');

const log = (...a) => console.log('[login-servers-home-folders]', ...a);

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
    await page.waitForTimeout(800);

    // --- /login while already authenticated: code says it should bounce to Home ---
    let stuck = await goto(page, '/login');
    log('/login (authenticated) -> url:', page.url().split('#')[1], 'stuck?', stuck);
    await page.screenshot({ path: path.join(SNAP, `qa-login-route-authed-${Date.now()}.png`) });

    // --- /servers while authenticated: route isn't mounted at all -> InvalidRoute ---
    stuck = await goto(page, '/servers');
    const serversBody = await page.evaluate(() => document.body.innerText.slice(0, 300));
    log('/servers (authenticated) -> url:', page.url().split('#')[1], 'stuck?', stuck);
    log('/servers body sample:', JSON.stringify(serversBody));
    await page.screenshot({ path: path.join(SNAP, `qa-servers-route-authed-${Date.now()}.png`) });

    // --- /login with NO current server (real subbox logout, not just a route hop):
    //     does the classic manual-server-entry form actually work, or is it inert? ---
    await forceFreshLogin(page);
    await page.waitForTimeout(1000);
    stuck = await goto(page, '/login');
    const loginBody = await page.evaluate(() => document.body.innerText.slice(0, 500));
    const hasUsernameField = await page
        .getByLabel(/username/i)
        .isVisible()
        .catch(() => false);
    log('/login (logged out) -> url:', page.url().split('#')[1], 'stuck?', stuck);
    log(
        '/login (logged out) has username field?',
        hasUsernameField,
        'body:',
        JSON.stringify(loginBody),
    );
    await page.screenshot({ path: path.join(SNAP, `qa-login-route-loggedout-${Date.now()}.png`) });

    // Re-establish a real session via the actual subbox flow (LandingPage -> PymixAuthModal)
    // for the rest of the journey. Explicitly reset the hash to '/' first — reload() alone
    // preserves the current '#/login' hash, and that broken error page has no "Login" button
    // for isLoggedOut() to detect, which would silently skip re-authentication.
    await page.evaluate(() => {
        window.location.hash = '/';
    });
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    else log('WARNING: not on the landing page after reset+reload; login may be skipped');
    await page.waitForTimeout(800);

    // --- Home (/) ---
    stuck = await goto(page, '/');
    if (stuck) {
        await forceFreshLogin(page);
        await performLogin(page, credentials);
        stuck = await goto(page, '/');
    }
    const homeInfo = await page.evaluate(() => {
        const carousels = document.querySelectorAll('[class*="carousel" i]').length;
        const cards = document.querySelectorAll('[class*="Card" i] [class*="image" i]').length;
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
            .map((h) => h.textContent?.trim())
            .filter(Boolean)
            .slice(0, 10);
        return { cards, carousels, headings };
    });
    log('/ (home) stuck?', stuck, 'info:', JSON.stringify(homeInfo));
    await page.screenshot({ path: path.join(SNAP, `qa-home-route-${Date.now()}.png`) });

    // --- Explore (/explore) ---
    stuck = await goto(page, '/explore');
    const exploreInfo = await page.evaluate(() => {
        const carousels = document.querySelectorAll('[class*="carousel" i]').length;
        const cards = document.querySelectorAll('[class*="Card" i] [class*="image" i]').length;
        const bodyText = document.body.innerText || '';
        const emptyHint = /no results|nothing|empty/i.test(bodyText.slice(0, 800));
        return { cards, carousels, emptyHint };
    });
    log('/explore stuck?', stuck, 'info:', JSON.stringify(exploreInfo));
    await page.screenshot({ path: path.join(SNAP, `qa-explore-route-${Date.now()}.png`) });

    // --- Library -> Folders (/library/folders) ---
    stuck = await goto(page, '/library/folders');
    const foldersInfo = await page.evaluate(() => {
        const rows = document.querySelectorAll('[role="row"]').length;
        const links = Array.from(document.querySelectorAll('a[href*="/library/folders"]')).map(
            (a) => a.getAttribute('href'),
        );
        const bodyText = document.body.innerText || '';
        const errorPage = /unable to route request|error/i.test(bodyText.slice(0, 200));
        return { errorPage, folderLinks: links.slice(0, 5), rows };
    });
    log('/library/folders stuck?', stuck, 'info:', JSON.stringify(foldersInfo));
    await page.screenshot({ path: path.join(SNAP, `qa-folders-route-${Date.now()}.png`) });

    // Folders is an ag-grid-style list (like genres/songs), not anchor-based nav —
    // double-click the first data row (row 1 = header, row 2 = first data row) to
    // descend into it, mirroring genres-journey.mjs's play gesture.
    const urlBeforeFolderClick = page.url();
    const folderRow = page.locator('[role="row"][aria-rowindex="2"]').first();
    if (await folderRow.count()) {
        const box = await folderRow.boundingBox().catch(() => null);
        if (box) {
            const y = box.height > 4 ? box.y + box.height / 2 : box.y + 18;
            await page.mouse.dblclick(box.x + Math.min(box.width / 2, 200), y);
            await page.waitForTimeout(1500);
        }
        const detailUrl = page.url().split('#')[1];
        const navigated = page.url() !== urlBeforeFolderClick;
        const detailInfo = await page.evaluate(() => ({
            breadcrumb: document.body.innerText.split('\n').slice(0, 6),
            rows: document.querySelectorAll('[role="row"]').length,
        }));
        log(
            'folder double-click -> url:',
            detailUrl,
            'navigated?',
            navigated,
            JSON.stringify(detailInfo),
        );
        await page.screenshot({ path: path.join(SNAP, `qa-folders-detail-${Date.now()}.png`) });
    } else {
        log('no aria-rowindex=2 folder row found to double-click');
    }

    await electronApp.close();
    log('done');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
