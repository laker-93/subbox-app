import path from 'path';
import { _electron as electron } from 'playwright';

import {
    forceFreshLogin,
    getCredentials,
    performLogin,
    resolveAppEntry,
    SNAPSHOT_DIR,
    waitForRouteSettled,
} from '../ui-snapshot-shared.mjs';

// QA driver: the /favorites page's OWN row-level favorite toggle (the inline heart
// ActionIcon in the USER_FAVORITE table column — favorite-column.tsx), as opposed to
// songs-favorites-journey.mjs which only toggles via the player-bar FavoriteButton.
// Uses the row's own heart icon directly (last button in the row) instead of hovering
// for a tooltip, which was slow/flaky against the current large (~2900-track) library.
//
// Usage: node scripts/qa/favorites-row-toggle.mjs

const MAIN_ENTRY = resolveAppEntry();
const log = (...a) => console.log('[fav-toggle]', ...a);
const shot = (page, name) =>
    page.screenshot({ path: path.join(SNAPSHOT_DIR, `qa-fav-toggle-${name}-${Date.now()}.png`) });

async function goto(page, route) {
    const baseUrl = page.url().split('#')[0];
    await page.goto(`${baseUrl}#${route}`);
    await waitForRouteSettled(page);
}

async function dataRows(page) {
    const rows = await page.locator('[role="row"]').all();
    const out = [];
    for (const row of rows) {
        const text = await row.innerText().catch(() => '');
        if (/^\d/.test(text.trim())) out.push(row);
    }
    return out;
}

async function readTitles(page) {
    const rows = await dataRows(page);
    const out = [];
    for (const row of rows) {
        const text = await row.innerText().catch(() => '');
        out.push(text.split('\n')[1] ?? text.slice(0, 60));
    }
    return out;
}

// The `[role="row"]` wrapper itself reports a zero-height bounding box — the grid
// renders each column as an absolutely-positioned sibling `<div>` instead, so hovering
// the row locator directly never lands on real, on-screen pixels (confirmed via
// elementFromPoint: it can land on the sticky page toolbar sitting on top instead, or
// simply never fire pointerover because the row is scrolled out of view). Hover a real
// cell within the row instead — the row-hover state is delegated app-wide via a single
// pointerover/pointerout listener keyed on the shared `data-row-index` attribute
// (use-row-interaction-delegate.ts), so hovering ANY cell in the row reveals the
// hover-only heart icon in every other cell of that same row, same as a real user
// mousing over any part of the row.
//
// The list itself is a `react-window` virtualized `Grid` (item-table-list.tsx), which
// recycles a fixed DOM node pool across scroll positions rather than mounting a fresh
// node per data row. A `Locator` captured *before* scrolling can therefore end up
// pointing at a DOM node that virtualization has since reassigned to a *different* data
// row by the time of the click (confirmed live: a captured "Copy 2" row's heart click
// actually starred "Copy 3" server-side after `scrollIntoView` ran) — the click always
// lands wherever that pooled node scrolled to, not on the original row. A real user
// never hits this: their scroll and their click both act on the same synchronously
// re-rendered view, so what's visually under the cursor always matches what gets
// clicked. To avoid this driver-only staleness, re-locate the row by its expected title
// AFTER scrolling settles, and interact with that freshly-resolved row/cell/heart, not
// the pre-scroll locator.
async function hoverAndClickRowFavorite(page, row, expectedTitle) {
    let cell = row.locator(':scope > div').first();
    // Center the row in the scroll container rather than top-aligning it (the default
    // for scrollIntoViewIfNeeded) — top alignment can still land it underneath the
    // sticky page toolbar, which floats above the scroll area rather than being part
    // of its scrollable content.
    await cell.evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
    await page.waitForTimeout(200);

    // Re-resolve the row post-scroll: virtualization may have recycled the DOM node
    // this locator was bound to onto a different data row during the scroll.
    const freshRows = await dataRows(page);
    let freshRow = null;
    for (const r of freshRows) {
        const text = (await r.innerText().catch(() => '')).split('\n')[1];
        if (text === expectedTitle) {
            freshRow = r;
            break;
        }
    }
    if (!freshRow) throw new Error(`row for "${expectedTitle}" not found after scroll-settle (virtualization recycle?)`);
    row = freshRow;
    cell = row.locator(':scope > div').first();

    let box = await cell.boundingBox();
    if (!box) throw new Error('row cell has no bounding box even after scrollIntoView(center)');
    if (box.y < 150) {
        // Still under the toolbar (e.g. a row near the very start/end of the list that
        // can't be centered) — scroll further and accept whatever position results.
        await page.mouse.wheel(0, -200);
        await page.waitForTimeout(300);
        box = await cell.boundingBox();
        if (!box) throw new Error('row cell lost its bounding box after scrolling past the sticky toolbar');
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    // Re-verify identity one more time right before the click — the extra scroll/wheel
    // fallback above is itself another scroll event that could trigger another recycle.
    const titleNow = (await row.innerText().catch(() => '')).split('\n')[1];
    if (titleNow !== expectedTitle) {
        throw new Error(`row identity drifted right before click: expected "${expectedTitle}", now showing "${titleNow}"`);
    }
    const heart = row.locator('button').last();
    const heartBox = await heart.boundingBox();
    if (!heartBox) throw new Error('heart icon has no bounding box even after row hover');
    log('DIAG heartBox:', JSON.stringify(heartBox), 'cls before click:', await heart.evaluate((el) => el.className));
    // A synthetic mouse.move+down+up sequence at the icon's coordinates does NOT
    // reliably register as a click here (confirmed: 0/2 live trials produced any
    // onFavorite call or network request, vs. 100% via Playwright's own locator
    // click) — likely a pointer-event/synthetic-event mismatch with Mantine's
    // ActionIcon, not a product bug. Use the real locator click instead.
    await heart.click({ force: true, timeout: 5000 });
    await page.waitForTimeout(300);
    log('DIAG cls after click:', await heart.evaluate((el) => el.className).catch((e) => `ERR:${e.message}`));
}

async function main() {
    const credentials = getCredentials();
    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    const page = await electronApp.firstWindow();

    page.on('response', async (res) => {
        const url = res.url();
        if (/star\.view|unstar\.view/.test(url)) {
            const kind = /unstar\.view/.test(url) ? 'unstar' : 'star';
            log(`NET ${kind} -> ${res.status()}`);
        } else if (/\.view\?/.test(url)) {
            log(`NET other -> ${res.status()} ${url.split('?')[0].split('/').pop()}`);
        }
    });
    page.on('console', (msg) => {
        if (msg.type() === 'error') log('CONSOLE ERROR:', msg.text());
    });
    page.on('pageerror', (err) => log('PAGE ERROR:', err.message));

    await page.waitForLoadState('networkidle');
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });

    // Force a fresh login so no leftover playing/paused-track state from a prior
    // driver run complicates this one.
    await forceFreshLogin(page);
    await performLogin(page, credentials);
    log('logged in (fresh)');

    let stuck = await goto(page, '/library/songs');
    if (stuck) {
        await forceFreshLogin(page);
        await performLogin(page, credentials);
        stuck = await goto(page, '/library/songs');
    }

    let rows = await dataRows(page);
    for (let i = 0; i < 5 && rows.length === 0; i++) {
        await page.waitForTimeout(1000);
        rows = await dataRows(page);
    }
    log('songs rows loaded:', rows.length);
    if (rows.length === 0) {
        log('FAIL: no song rows loaded');
        await electronApp.close();
        process.exit(2);
    }

    // Pick the first row whose favorite icon is NOT already filled (class
    // "hover-only" per favorite-column.tsx marks the not-yet-favorited state), skipping
    // any row sitting underneath the page's sticky toolbar (small y) — its own cell
    // bounding box is unaffected, but the toolbar visually covers it, so a synthetic
    // mouse hover there lands on the toolbar (elementFromPoint-confirmed) rather than
    // the row and never reveals the hover-only heart icon.
    let targetRow = null;
    let targetTitle = null;
    for (const row of rows) {
        const heart = row.locator('button').last();
        const isUnfavorited = await heart.evaluate((el) => el.querySelector('.hover-only') !== null || el.className.includes('hover-only')).catch(() => false);
        const svgHoverOnly = await heart.locator('.hover-only').count().catch(() => 0);
        if (svgHoverOnly === 0 && !isUnfavorited) continue;
        const cellBox = await row.locator(':scope > div').first().boundingBox().catch(() => null);
        if (!cellBox || cellBox.y < 150) continue;
        targetRow = row;
        targetTitle = (await row.innerText().catch(() => '')).split('\n')[1] ?? null;
        break;
    }
    if (!targetRow) {
        log('FAIL: could not find an unfavorited row (all rows already favorited?)');
        await shot(page, 'no-unfavorited-row');
        await electronApp.close();
        process.exit(3);
    }
    log('target track (currently NOT favorited):', JSON.stringify(targetTitle));

    // --- Add favorite via the row's own inline heart icon ---
    // The icon is CSS-hidden (opacity via `hover-only`) until the row is hovered —
    // a real user's mouse-over reveals it, so hover before clicking rather than
    // force-clicking an invisible element.
    await shot(page, 'before-add');
    await hoverAndClickRowFavorite(page, targetRow, targetTitle);
    await page.waitForTimeout(1500);
    await shot(page, 'after-add-songs-page');
    log('clicked row heart icon on /library/songs to add favorite');

    // --- Navigate (real fetch) to /favorites and confirm the row is there ---
    await goto(page, '/favorites');
    let favTitles = [];
    let found = false;
    for (let i = 0; i < 6 && !found; i++) {
        favTitles = await readTitles(page);
        found = favTitles.some((t) => t === targetTitle);
        if (!found) {
            await page.waitForTimeout(1000);
            await goto(page, '/favorites');
        }
    }
    log('present in /favorites after navigation:', found, JSON.stringify(favTitles.slice(0, 8)));
    await shot(page, 'on-favorites-page');
    if (!found) {
        log('FAIL: track never appeared in /favorites after adding — cannot continue toggle test');
        await electronApp.close();
        process.exit(4);
    }

    // --- The test: remove from favorites via the row's OWN heart icon, WHILE
    // STAYING on /favorites (no navigation) ---
    const favRows = await dataRows(page);
    let removeRow = null;
    for (const row of favRows) {
        const text = (await row.innerText().catch(() => '')).split('\n')[1];
        if (text === targetTitle) {
            removeRow = row;
            break;
        }
    }
    if (!removeRow) {
        log('FAIL: could not re-locate the row on /favorites to click its heart icon');
        await electronApp.close();
        process.exit(5);
    }

    const buttonDiag = await removeRow.evaluate((el) => Array.from(el.querySelectorAll('button')).map((b) => ({ aria: b.getAttribute('aria-label'), cls: b.className, svg: b.querySelector('svg')?.outerHTML?.slice(0, 200) })));
    log('DIAG buttons in removeRow:', JSON.stringify(buttonDiag));

    await hoverAndClickRowFavorite(page, removeRow, targetTitle);
    log('clicked row heart icon on /favorites to REMOVE favorite (no navigation)');
    await page.waitForTimeout(1500);

    const rowsRightAfter = await readTitles(page);
    const stillPresentRightAfter = rowsRightAfter.includes(targetTitle);
    log('row still present right after remove (no nav)?', stillPresentRightAfter, 'rowCount:', rowsRightAfter.length);
    await shot(page, 'after-remove-no-nav');

    await page.waitForTimeout(4000);
    const rowsAfterWait = await readTitles(page);
    const stillPresentAfterWait = rowsAfterWait.includes(targetTitle);
    log('row still present after extra 4s wait (still no nav)?', stillPresentAfterWait);
    await shot(page, 'after-remove-4s-wait');

    // --- Now force a real refetch (navigate away and back) and confirm it clears ---
    await goto(page, '/library/songs');
    await page.waitForTimeout(500);
    await goto(page, '/favorites');
    await page.waitForTimeout(1000);
    const rowsAfterRenav = await readTitles(page);
    const stillPresentAfterRenav = rowsAfterRenav.includes(targetTitle);
    log('still present after a full re-navigation refetch?', stillPresentAfterRenav);
    await shot(page, 'after-renav');

    await electronApp.close();
    log('done');
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
