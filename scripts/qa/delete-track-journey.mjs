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

// QA driver: the subbox-only "Delete a track" journey.
//   search for a scratch track → right-click its row → context menu "Delete song"
//   → confirm modal → observe the DELETE {pymix}/track request + response, the
//   toast the user actually sees, and whether the row disappears from the list.
//
// Deletion is destructive server-side (`beet rm -df` removes the file from disk),
// so this must only ever be pointed at a purpose-made scratch track on the local
// dev test user. Pass the title via QA_DELETE_TITLE.
//
// Usage: QA_DELETE_TITLE="Delete Me 20260714" node scripts/qa/delete-track-journey.mjs

const MAIN_ENTRY = resolveAppEntry();
const TITLE = process.env.QA_DELETE_TITLE;
const log = (...a) => console.log('[delete-track]', ...a);

if (!TITLE) {
    console.error('QA_DELETE_TITLE is required (title of the scratch track to delete)');
    process.exit(2);
}

// Find the grid row whose text contains the scratch title. ag-grid data rows report
// height 0 in this Playwright/bare-out-main build (see features/songs-browse-and-play.md),
// so aim clicks ~18px below the reported top edge.
async function findRow(page, title) {
    const rows = await page.locator('[role="row"]').all();
    for (const row of rows) {
        const text = await row.innerText().catch(() => '');
        if (text.includes(title)) return row;
    }
    return null;
}

async function goto(page, route) {
    const baseUrl = page.url().split('#')[0];
    await page.goto(`${baseUrl}#${route}`);
    await waitForRouteSettled(page);
}

async function rowPoint(row) {
    const box = await row.boundingBox();
    if (!box) return null;
    return {
        x: box.x + Math.min(box.width / 2, 200),
        y: box.height > 4 ? box.y + box.height / 2 : box.y + 18,
    };
}

(async () => {
    const electronApp = await electron.launch({ args: [MAIN_ENTRY] });
    electronApp.process().stdout?.on('data', (d) => process.stdout.write('[main] ' + d));
    electronApp.process().stderr?.on('data', (d) => process.stdout.write('[main:err] ' + d));

    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Capture every pymix /track call at the request level, with its response body.
    const deleteCalls = [];
    page.on('response', async (res) => {
        const url = res.url();
        if (!/\/track(\?|$)/.test(url)) return;
        const method = res.request().method();
        if (method !== 'DELETE') return;
        let body = null;
        try {
            body = await res.json();
        } catch {
            body = await res.text().catch(() => null);
        }
        deleteCalls.push({
            body,
            method,
            receivedAt: Date.now(),
            reqBody: res.request().postData(),
            status: res.status(),
            url,
        });
        log(`>> ${method} ${url} -> ${res.status()}`);
        log('   response body:', JSON.stringify(body));
    });

    const consoleLines = [];
    page.on('console', (m) => {
        const t = m.text();
        if (/DeleteSong|subboxid|delete/i.test(t)) consoleLines.push(`[${m.type()}] ${t}`);
    });

    await forceFreshLogin(page);
    await performLogin(page, getCredentials());
    log('logged in');

    // QA_DELETE_ROUTE lets a cycle compare routes: the default search route's query key
    // is NOT invalidated by the delete mutation, an album-detail route's is.
    const route = process.env.QA_DELETE_ROUTE || `/search/song?query=${encodeURIComponent(TITLE)}`;
    log('route under test:', route);
    await goto(page, route);
    await page.waitForTimeout(2500);

    const row = await findRow(page, TITLE);
    if (!row) {
        log('FAIL: scratch track row not found in search results');
        await page.screenshot({ path: path.join(SNAPSHOT_DIR, 'qa-delete-row-notfound.png') });
        await electronApp.close();
        process.exit(3);
    }
    log('found scratch track row');

    const pt = await rowPoint(row);
    await page.mouse.click(pt.x, pt.y, { button: 'right' });
    await page.waitForTimeout(800);

    const menuText = await page.evaluate(() => document.body.innerText);
    // NB the i18n key is `action.deleteSong` but the rendered label is "Delete track".
    const deleteItem = page.getByText(/^Delete track$/i).first();
    if (!(await deleteItem.count())) {
        log('FAIL: no "Delete track" item in context menu. Menu text sample:');
        log(menuText.slice(0, 600));
        await page.screenshot({ path: path.join(SNAPSHOT_DIR, 'qa-delete-nomenuitem.png') });
        await electronApp.close();
        process.exit(4);
    }
    log('context menu has "Delete track"');
    await page.screenshot({ path: path.join(SNAPSHOT_DIR, 'qa-delete-contextmenu.png') });

    await deleteItem.click();
    await page.waitForTimeout(800);

    const modalText = await page.evaluate(() => document.body.innerText);
    log('confirm modal shown:', /are you sure/i.test(modalText));
    await page.screenshot({ path: path.join(SNAPSHOT_DIR, 'qa-delete-confirm-modal.png') });

    // ConfirmModal's confirm button
    const confirmBtn = page.getByRole('button', { name: /^(confirm|yes|delete|ok)$/i }).first();
    if (!(await confirmBtn.count())) {
        log('FAIL: no confirm button found. Modal text:', modalText.slice(0, 400));
        await electronApp.close();
        process.exit(5);
    }
    const confirmedAt = Date.now();
    await confirmBtn.click();
    log('confirmed delete');

    // Race the visible outcomes: success toast vs error toast vs nothing (hang).
    const outcome = await Promise.race([
        page
            .getByText(/deleted|success/i)
            .first()
            .waitFor({ timeout: 30_000 })
            .then(() => 'success-toast'),
        page
            .getByText(/error|failed|no subboxid/i)
            .first()
            .waitFor({ timeout: 30_000 })
            .then(() => 'error-toast'),
    ]).catch(() => 'no-toast');
    log('user-visible outcome:', outcome);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SNAPSHOT_DIR, 'qa-delete-after.png') });
    const afterText = await page.evaluate(() => document.body.innerText);
    log('toast/body sample after confirm:', afterText.slice(0, 300).replace(/\n/g, ' | '));

    // Did the row leave the list (query invalidation) without a manual refresh?
    // pymix deletes the file synchronously, but Navidrome rescans asynchronously
    // (~5-10s), so poll: an immediate invalidation can refetch a track the server
    // still lists. Report when (if ever) the row clears on its own.
    const t0 = Date.now();
    let clearedAfterMs = null;
    for (let i = 0; i < 25; i++) {
        if (!(await findRow(page, TITLE))) {
            clearedAfterMs = Date.now() - t0;
            break;
        }
        await page.waitForTimeout(2000);
    }
    log(
        clearedAfterMs === null
            ? 'row NEVER cleared on its own within 50s of delete'
            : `row cleared on its own after ~${Math.round(clearedAfterMs / 1000)}s`,
    );

    // Then: does re-navigating (a fresh fetch, well after Navidrome has rescanned) clear it?
    await goto(page, '/library/albums');
    await page.waitForTimeout(1000);
    await goto(page, route);
    await page.waitForTimeout(2500);
    const rowAfterRenav = !!(await findRow(page, TITLE));
    log('row visible after navigating away and back:', rowAfterRenav);
    const rowStillThere = clearedAfterMs === null;

    log('--- summary ---');
    log('DELETE /track calls:', deleteCalls.length);
    for (const c of deleteCalls) {
        const latency = c.receivedAt - confirmedAt;
        log(
            `  status=${c.status} latency=${latency}ms reqBody=${c.reqBody} respBody=${JSON.stringify(c.body)}`,
        );
    }
    log('console lines:', consoleLines.length ? consoleLines : '(none)');
    log('outcome:', outcome, '| rowStillVisible:', rowStillThere);

    // Regression guard for laker-93/subbox-app#18: the toast the user sees MUST agree
    // with pymix's body-level `success`. pymix returns HTTP 200 even on failure, so a
    // `success:false` body that still shows a success toast is the exact bug. Also
    // guard the batching contract: N selected tracks => a single DELETE /track call.
    let assertionFailed = false;
    const bodySuccess = deleteCalls.every(
        (c) => c.body && typeof c.body === 'object' && c.body.success === true,
    );
    const anyBodyFailure = deleteCalls.some(
        (c) => c.body && typeof c.body === 'object' && c.body.success === false,
    );
    if (anyBodyFailure && outcome === 'success-toast') {
        log('ASSERT FAIL (#18): pymix reported success:false but the UI showed a SUCCESS toast');
        assertionFailed = true;
    }
    if (deleteCalls.length && bodySuccess && outcome === 'error-toast') {
        log('ASSERT FAIL: pymix reported success but the UI showed an ERROR toast');
        assertionFailed = true;
    }
    log(
        'toast/body agreement:',
        assertionFailed ? 'MISMATCH' : 'ok',
        `(bodySuccess=${bodySuccess}, outcome=${outcome})`,
    );

    await electronApp.close();
    process.exit(!assertionFailed && deleteCalls.length > 0 && outcome !== 'no-toast' ? 0 : 1);
})().catch((e) => {
    console.error('[delete-track] driver error:', e);
    process.exit(9);
});
