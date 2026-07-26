import { _electron as electron } from 'playwright';

import {
    forceFreshLogin,
    getCredentials,
    performLogin,
    resolveAppEntry,
    waitForRouteSettled,
} from '../ui-snapshot-shared.mjs';

// QA driver: three still-unchecked wishlist client sub-flows (README row noted them
// unchecked: bulk actions, parse-link, Google-Sheet sync status).
//   1. Sheet sync status badge — read-only: compares the UI tooltip against the real
//      GET /wishlist/sheet/status server state (this account's linked sheet is
//      currently broken — deleted/unshared — so this is a live "error" state, not
//      synthetic).
//   2. Bulk actions — creates 2 scratch items via the header "+" modal, selects both via
//      row checkboxes, bulk "Mark downloaded" then bulk delete via WishlistBulkActions.
//   3. Parse-link single-track prefill — pastes a stable YouTube link into the create
//      modal's Link field, blurs, checks artist/title auto-fill, cancels without
//      creating (no scratch row left behind).
//
// Everything created is scratch, tracked by wishlist_id and cleaned up at the end
// (falls back to a direct DELETE if the UI bulk-delete step itself is what's broken).
//
// Usage: node scripts/qa/wishlist-bulk-and-sheet.mjs

const MAIN_ENTRY = resolveAppEntry();
const PYMIX = 'https://pymix.docker.localhost';
const STAMP = Date.now();
const SCRATCH_A = `QA Bulk A ${STAMP}`;
const SCRATCH_B = `QA Bulk B ${STAMP}`;
// A long-lived, stable public video — Rick Astley "Never Gonna Give You Up".
const YOUTUBE_LINK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

const log = (...a) => console.log('[wishlist-bulk]', ...a);
const fail = (msg) => {
    console.error('[wishlist-bulk] FAIL:', msg);
    process.exitCode = 1;
};

// pymix auth is cookie-only (session_id) — routers/auth.py's require_user has no
// ?username= fallback (tightened, per pymix-qa's 2026-07-24 stale-doc note). A bare
// Node-side fetch carries no cookies and silently gets a 401 body, so every API check
// here runs inside the authenticated page context instead, via page.evaluate.
async function apiList(page) {
    const body = await page.evaluate(
        async (url) => (await fetch(url, { credentials: 'include' })).json(),
        `${PYMIX}/wishlist`,
    );
    return body.items ?? [];
}

async function apiSheetStatus(page) {
    return page.evaluate(
        async (url) => (await fetch(url, { credentials: 'include' })).json(),
        `${PYMIX}/wishlist/sheet/status`,
    );
}

async function apiDelete(page, id) {
    await page.evaluate(
        async ([url]) => fetch(url, { method: 'DELETE', credentials: 'include' }),
        [`${PYMIX}/wishlist/${id}`],
    );
}

async function goto(page, route) {
    const baseUrl = page.url().split('#')[0];
    await page.goto(`${baseUrl}#${route}`);
    await waitForRouteSettled(page);
}

const dataRows = (page) => page.locator('table tbody tr');

async function createScratchItem(page, artist, title) {
    await page
        .locator('button:has-text("Offline Wishlist")')
        .locator('xpath=following-sibling::button[1]')
        .click();
    await page.waitForTimeout(600);
    const modal = page.locator('[role="dialog"]').last();
    await modal.getByLabel(/^Artist$/i).fill(artist);
    await modal.getByLabel(/^Title$/i).fill(title);
    await modal.getByRole('button', { name: /^Create$/i }).click();
    await page.waitForTimeout(2500);
}

(async () => {
    const electronApp = await electron.launch({ args: [MAIN_ENTRY] });
    electronApp.process().stdout?.on('data', (d) => process.stdout.write('[main] ' + d));
    electronApp.process().stderr?.on('data', (d) => process.stdout.write('[main:err] ' + d));

    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    const calls = [];
    page.on('response', async (res) => {
        const url = res.url();
        if (!url.includes('/wishlist')) return;
        calls.push({ method: res.request().method(), status: res.status(), url });
    });
    const callsSince = (n) => calls.slice(n);

    await forceFreshLogin(page);
    await performLogin(page, getCredentials());
    log('logged in');

    await goto(page, '/wishlist');
    await page.waitForTimeout(2000);

    // ---- Part 1: Sheet sync status badge (read-only) ------------------------------
    const serverSheet = await apiSheetStatus(page);
    log(`server sheet status: configured=${serverSheet.configured} status=${serverSheet.status} error=${JSON.stringify(serverSheet.error)}`);

    const errorIcon = page.locator('[class*="color-error"]').first();
    const iconVisible = await errorIcon.isVisible().catch(() => false);
    if (serverSheet.status === 'error') {
        if (!iconVisible) {
            fail('server sheet status is "error" but no error-colored badge icon is visible in the header');
        } else {
            await errorIcon.hover();
            await page.waitForTimeout(500);
            const tooltip = page.locator('[role="tooltip"]');
            const tooltipText = await tooltip.innerText().catch(() => null);
            log(`badge tooltip text: ${JSON.stringify(tooltipText)}`);
            if (!tooltipText || (serverSheet.error && !tooltipText.includes(serverSheet.error))) {
                fail(`badge tooltip does not surface the real server error verbatim (got ${JSON.stringify(tooltipText)}, expected to include ${JSON.stringify(serverSheet.error)})`);
            } else {
                log('PART 1 sheet status badge: OK — error state surfaced verbatim to the user');
            }
        }
    } else {
        log(`sheet status is "${serverSheet.status}", not "error" — skipping the error-tooltip assertion (nothing to compare)`);
    }

    // ---- Part 2: bulk actions -------------------------------------------------------
    let mark = calls.length;
    await createScratchItem(page, 'QA Bulk Artist', SCRATCH_A);
    await createScratchItem(page, 'QA Bulk Artist', SCRATCH_B);

    let items = await apiList(page);
    const itemA = items.find((i) => i.title === SCRATCH_A);
    const itemB = items.find((i) => i.title === SCRATCH_B);
    if (!itemA || !itemB) {
        fail('one or both scratch items missing server-side after create — aborting bulk-action test');
    } else {
        log(`created scratch ids A=${itemA.wishlist_id} B=${itemB.wishlist_id}`);

        const rowA = dataRows(page).filter({ hasText: SCRATCH_A }).first();
        const rowB = dataRows(page).filter({ hasText: SCRATCH_B }).first();
        await rowA.getByRole('checkbox').click();
        await rowB.getByRole('checkbox').click();
        await page.waitForTimeout(500);

        const bulkBar = page.getByText(/selected/i).first();
        if (!(await bulkBar.isVisible().catch(() => false))) {
            fail('WishlistBulkActions toolbar did not appear after selecting 2 rows');
        } else {
            log('bulk toolbar appeared for 2 selected rows');
        }

        mark = calls.length;
        await page.getByRole('button', { name: /Mark downloaded/i }).click();
        await page.waitForTimeout(2500);
        const patches = callsSince(mark).filter((c) => c.method === 'PATCH');
        log(`bulk mark-downloaded fired ${patches.length} PATCH call(s)`);
        if (patches.length !== 2) fail(`expected 2 PATCH calls for bulk mark-downloaded, got ${patches.length}`);

        items = await apiList(page);
        const afterA = items.find((i) => i.wishlist_id === itemA.wishlist_id);
        const afterB = items.find((i) => i.wishlist_id === itemB.wishlist_id);
        if (afterA?.status !== 'downloaded' || afterB?.status !== 'downloaded') {
            fail(`bulk status update did not apply to both rows (A=${afterA?.status}, B=${afterB?.status})`);
        } else {
            log('PART 2a bulk status update: OK — both rows transitioned to downloaded');
        }

        // re-select (selection was cleared on success) and bulk delete
        await rowA.getByRole('checkbox').click();
        await rowB.getByRole('checkbox').click();
        await page.waitForTimeout(500);
        mark = calls.length;
        await page.getByRole('button', { name: /^Delete$/i }).click();
        await page.waitForTimeout(600);
        // confirm modal
        await page.getByRole('button', { name: /^Delete$/i }).last().click();
        await page.waitForTimeout(2500);

        const deletes = callsSince(mark).filter((c) => c.method === 'DELETE');
        log(`bulk delete fired ${deletes.length} DELETE call(s)`);
        if (deletes.length !== 2) fail(`expected 2 DELETE calls for bulk delete, got ${deletes.length}`);

        items = await apiList(page);
        const stillA = items.find((i) => i.wishlist_id === itemA.wishlist_id);
        const stillB = items.find((i) => i.wishlist_id === itemB.wishlist_id);
        if (stillA || stillB) fail('bulk delete did not remove both scratch items server-side');
        else log('PART 2b bulk delete: OK — both rows gone server + client-side');
    }

    // cleanup fallback in case anything above failed mid-way
    items = await apiList(page);
    for (const title of [SCRATCH_A, SCRATCH_B]) {
        const leftover = items.find((i) => i.title === title);
        if (leftover) {
            log(`cleanup: deleting leftover scratch item "${title}" (${leftover.wishlist_id})`);
            await apiDelete(page, leftover.wishlist_id);
        }
    }

    // ---- Part 3: parse-link single-track prefill ------------------------------------
    await page
        .locator('button:has-text("Offline Wishlist")')
        .locator('xpath=following-sibling::button[1]')
        .click();
    await page.waitForTimeout(600);
    let modal = page.locator('[role="dialog"]').last();
    const linkInput = modal.getByLabel(/Link/i);
    await linkInput.fill(YOUTUBE_LINK);
    mark = calls.length;
    await modal.getByLabel(/^Artist$/i).click(); // real focus move → fires the link input's onBlur
    await page.waitForTimeout(3000);

    const artistVal = await modal.getByLabel(/^Artist$/i).inputValue();
    const titleVal = await modal.getByLabel(/^Title$/i).inputValue();
    log(`after link blur: artist=${JSON.stringify(artistVal)} title=${JSON.stringify(titleVal)}`);
    if (!artistVal && !titleVal) {
        fail('parse-link did not prefill artist or title from a valid YouTube link');
    } else {
        log('PART 3 parse-link prefill: OK');
    }

    await modal.getByRole('button', { name: /^Cancel$/i }).click();
    await page.waitForTimeout(500);

    // final cleanup safety net
    items = await apiList(page);
    for (const title of [SCRATCH_A, SCRATCH_B]) {
        const leftover = items.find((i) => i.title === title);
        if (leftover) await apiDelete(page, leftover.wishlist_id);
    }

    log(process.exitCode ? 'DONE WITH FAILURES' : 'ALL PARTS OK');
    await electronApp.close();
})().catch((err) => {
    console.error('[wishlist-bulk] CRASHED:', err);
    process.exitCode = 1;
});
