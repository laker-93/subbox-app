import { _electron as electron } from 'playwright';

import {
    forceFreshLogin,
    getCredentials,
    performLogin,
    resolveAppEntry,
    waitForRouteSettled,
} from '../ui-snapshot-shared.mjs';

// QA driver: the subbox-only Wishlist (/wishlist) CRUD journey.
//   list renders (vs live pymix GET /wishlist) → add an item via the header "+" modal
//   (POST /wishlist) → row appears → expand its detail → status transition
//   "Mark downloaded" (PATCH) → "Edit entry" modal sets an album (PATCH) → Delete +
//   confirm (DELETE) → row gone, and gone server-side too.
//
// Everything it creates is a purpose-made scratch item on the local dev test user, and
// the journey deletes it again at the end. It never touches the account's real wishlist
// rows (the 5 pre-existing ones are only read + counted).
//
// The scratch item is tracked by wishlist_id, never by its text: pymix's background
// resolve loop rewrites a hand-typed artist/title against MusicBrainz, so the text on
// screen can legitimately change mid-journey.
//
// Usage: node scripts/qa/wishlist-journey.mjs

const MAIN_ENTRY = resolveAppEntry();
const PYMIX = 'https://pymix.docker.localhost';
const STAMP = Date.now();
const SCRATCH_ARTIST = `QA Scratch Artist ${STAMP}`;
const SCRATCH_TITLE = `QA Wishlist Probe ${STAMP}`;
const SCRATCH_ALBUM = `QA Scratch Album ${STAMP}`;

const log = (...a) => console.log('[wishlist]', ...a);
const fail = (msg) => {
    console.error('[wishlist] FAIL:', msg);
    process.exitCode = 1;
};

async function apiList() {
    const { username } = getCredentials();
    const res = await fetch(`${PYMIX}/wishlist?username=${encodeURIComponent(username)}`);
    const body = await res.json();
    return body.items ?? [];
}

async function goto(page, route) {
    const baseUrl = page.url().split('#')[0];
    await page.goto(`${baseUrl}#${route}`);
    await waitForRouteSettled(page);
}

// The wishlist table is a plain Mantine <Table>, not ag-grid — real rows with real heights.
const dataRows = (page) => page.locator('table tbody tr');

async function rowTexts(page) {
    return Promise.all((await dataRows(page).all()).map((r) => r.innerText()));
}

(async () => {
    const electronApp = await electron.launch({ args: [MAIN_ENTRY] });
    electronApp.process().stdout?.on('data', (d) => process.stdout.write('[main] ' + d));
    electronApp.process().stderr?.on('data', (d) => process.stdout.write('[main:err] ' + d));

    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Record every pymix /wishlist call with method + response body, so we can assert on
    // what actually went over the wire rather than trusting the UI.
    const calls = [];
    page.on('response', async (res) => {
        const url = res.url();
        if (!url.includes('/wishlist')) return;
        const body = await res.text().catch(() => '');
        calls.push({
            body: body.slice(0, 400),
            method: res.request().method(),
            status: res.status(),
            url,
        });
        log(`  → ${res.request().method()} ${url.replace(PYMIX, '')} [${res.status()}]`);
    });
    const callsSince = (n) => calls.slice(n);

    await forceFreshLogin(page);
    await performLogin(page, getCredentials());
    log('logged in');

    // ---- Step 1: list renders, and matches the server ----------------------------
    await goto(page, '/wishlist');
    await page.waitForTimeout(2500);

    const apiBefore = await apiList();
    const uiRows = await rowTexts(page);
    log(`server items=${apiBefore.length}  ui rows=${uiRows.length}`);
    if (uiRows.length !== apiBefore.length) {
        fail(`row count ${uiRows.length} != server ${apiBefore.length}`);
    }
    for (const item of apiBefore) {
        const label = item.status === 'inbox' ? item.raw_note : item.title;
        if (label && !uiRows.some((t) => t.includes(label))) {
            fail(`server item "${label}" not rendered`);
        }
    }
    log('STEP 1 list render: OK');

    // ---- Step 2: create a scratch item via the header "+" modal -------------------
    let mark = calls.length;
    // The header "+" ActionIcon has no accessible name (tooltip only — see ux-notes), so
    // anchor to the "Offline Wishlist" button it sits next to inside the header Group.
    await page
        .locator('button:has-text("Offline Wishlist")')
        .locator('xpath=following-sibling::button[1]')
        .click();
    await page.waitForTimeout(800);
    const modal = page.locator('[role="dialog"]').last();
    if (!(await modal.isVisible().catch(() => false))) fail('create modal did not open');

    await modal.getByLabel(/^Artist$/i).fill(SCRATCH_ARTIST);
    await modal.getByLabel(/^Title$/i).fill(SCRATCH_TITLE);
    await modal.getByRole('button', { name: /^Create$/i }).click();
    await page.waitForTimeout(3000);

    const postCall = callsSince(mark).find((c) => c.method === 'POST');
    if (!postCall) fail('no POST /wishlist fired on Create');
    else log(`POST status=${postCall.status}`);

    const apiAfterCreate = await apiList();
    const scratch = apiAfterCreate.find((i) => i.title === SCRATCH_TITLE);
    if (!scratch) {
        fail('scratch item not present server-side after create');
        await electronApp.close();
        return;
    }
    const SCRATCH_ID = scratch.wishlist_id;
    log(
        `created wishlist_id=${SCRATCH_ID} status=${scratch.status} resolve_state=${scratch.resolve_state}`,
    );
    if (scratch.status !== 'wishlist') fail(`expected status "wishlist", got "${scratch.status}"`);

    let rows = await rowTexts(page);
    if (!rows.some((t) => t.includes(SCRATCH_TITLE))) fail('new item did not appear in the list');
    else log('STEP 2 create: OK (row appeared without a manual refresh)');

    // ---- Step 3: expand the row's detail ------------------------------------------
    const scratchRow = dataRows(page).filter({ hasText: SCRATCH_TITLE }).first();
    await scratchRow.click();
    await page.waitForTimeout(800);
    const detailVisible = await page
        .getByRole('button', { name: /Mark downloaded/i })
        .isVisible()
        .catch(() => false);
    if (!detailVisible) fail('detail pane did not expand (no "Mark downloaded" button)');
    else log('STEP 3 expand detail: OK');

    // ---- Step 4: status transition — Mark downloaded ------------------------------
    mark = calls.length;
    await page.getByRole('button', { name: /Mark downloaded/i }).click();
    await page.waitForTimeout(2500);
    const patchStatus = callsSince(mark).find((c) => c.method === 'PATCH');
    if (!patchStatus) fail('no PATCH fired for "Mark downloaded"');

    let after = (await apiList()).find((i) => i.wishlist_id === SCRATCH_ID);
    log(`after Mark downloaded: server status=${after?.status}`);
    if (after?.status !== 'downloaded')
        fail(`expected status "downloaded", got "${after?.status}"`);
    rows = await rowTexts(page);
    const uiShowsDownloaded = rows.some((t) => t.includes(SCRATCH_TITLE) && /downloaded/i.test(t));
    if (!uiShowsDownloaded) fail('UI badge did not update to "downloaded"');
    else log('STEP 4 status transition: OK');

    // ---- Step 5: edit entry — set an album ----------------------------------------
    mark = calls.length;
    await page.getByRole('button', { name: /Edit details/i }).click();
    await page.waitForTimeout(800);
    const editModal = page.locator('[role="dialog"]').last();
    if (!(await editModal.isVisible().catch(() => false))) {
        fail('edit modal did not open');
    } else {
        await editModal.getByLabel(/^Album$/i).fill(SCRATCH_ALBUM);
        await editModal.getByRole('button', { name: /^(Save|Update)$/i }).click();
        await page.waitForTimeout(2500);

        const patchEdit = callsSince(mark).find((c) => c.method === 'PATCH');
        if (!patchEdit) fail('no PATCH fired on edit save');
        after = (await apiList()).find((i) => i.wishlist_id === SCRATCH_ID);
        log(`after edit: server album=${JSON.stringify(after?.album)}`);
        if (after?.album !== SCRATCH_ALBUM) fail(`album not persisted (got ${after?.album})`);
        rows = await rowTexts(page);
        if (!rows.some((t) => t.includes(SCRATCH_ALBUM))) fail('edited album not shown in the row');
        else log('STEP 5 edit entry: OK');
    }

    // ---- Step 6: delete + confirm --------------------------------------------------
    mark = calls.length;
    const stillExpanded = await page
        .getByRole('button', { name: /^Delete$/i })
        .first()
        .isVisible()
        .catch(() => false);
    if (!stillExpanded) {
        await dataRows(page).filter({ hasText: SCRATCH_TITLE }).first().click();
        await page.waitForTimeout(600);
    }
    await page
        .getByRole('button', { name: /^Delete$/i })
        .first()
        .click();
    await page.waitForTimeout(700);
    await page
        .getByRole('button', { name: /^Delete$/i })
        .last()
        .click(); // confirm modal
    await page.waitForTimeout(3000);

    const delCall = callsSince(mark).find((c) => c.method === 'DELETE');
    if (!delCall) fail('no DELETE /wishlist/<id> fired');
    else log(`DELETE status=${delCall.status}`);

    const apiAfterDelete = await apiList();
    if (apiAfterDelete.some((i) => i.wishlist_id === SCRATCH_ID)) {
        fail('scratch item still present server-side after delete');
    }
    rows = await rowTexts(page);
    if (rows.some((t) => t.includes(SCRATCH_TITLE))) fail('deleted row still visible in the list');
    else log('STEP 6 delete: OK');

    log(
        `final: server items=${apiAfterDelete.length} (started ${apiBefore.length}) ui rows=${rows.length}`,
    );
    if (apiAfterDelete.length !== apiBefore.length) {
        fail(
            `item count drifted: ${apiBefore.length} → ${apiAfterDelete.length} (scratch leaked?)`,
        );
    }

    await electronApp.close();
    log(process.exitCode ? 'JOURNEY FAILED' : 'JOURNEY PASSED');
})().catch(async (err) => {
    console.error('[wishlist] crashed:', err);
    process.exit(3);
});
