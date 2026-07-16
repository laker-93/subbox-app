import { _electron as electron } from 'playwright';

import {
    forceFreshLogin,
    getCredentials,
    performLogin,
    resolveAppEntry,
    waitForRouteSettled,
} from '../ui-snapshot-shared.mjs';

// QA driver: the wishlist "Find metadata match" button (POST /wishlist/match-metadata).
//
// This is the client half of the pymix two-stage MusicBrainz gate (pymix#34 / issue #31).
// pymix now returns an extra `similarity` field and, crucially, returns `{"match": null}`
// for a match it isn't confident in rather than a wrong one. Two things must hold in the
// client, and neither is covered by wishlist-journey.mjs:
//
//   1. a genuine typo correction still parses and populates the form (the added
//      `similarity` field must not trip the zod response parser), and
//   2. a rejected match ({"match": null}) surfaces the "no match" toast and leaves the
//      user's typed text untouched — a DJ's "(VIP Mix)" must survive as typed.
//
// Drives the real Create-entry modal on the local dev test user. Creates nothing: the
// modal is opened, the match button clicked, then the modal is dismissed with Escape.
//
// Usage: node scripts/qa/wishlist-match-metadata.mjs

const MAIN_ENTRY = resolveAppEntry();
const PYMIX = 'https://pymix.docker.localhost';

const log = (...a) => console.log('[match]', ...a);
const fail = (msg) => {
    console.error('[match] FAIL:', msg);
    process.exitCode = 1;
};

async function goto(page, route) {
    const baseUrl = page.url().split('#')[0];
    await page.goto(`${baseUrl}#${route}`);
    await waitForRouteSettled(page);
}

// Open the "+" create-entry modal. The header "+" ActionIcon has no accessible name
// (tooltip only — see ux-notes), so anchor to the "Offline Wishlist" button beside it,
// exactly as wishlist-journey.mjs does.
async function openCreateModal(page) {
    await page
        .locator('button:has-text("Offline Wishlist")')
        .locator('xpath=following-sibling::button[1]')
        .click();
    await page.waitForTimeout(800);
    const modal = page.locator('[role="dialog"]').last();
    if (!(await modal.isVisible().catch(() => false))) throw new Error('create modal did not open');
    return modal;
}

// expect: {artist,title} to populate | null to be refused server-side and left as typed |
// 'no-request' for a partial pair the client must refuse locally, prompting for the rest.
async function runCase(page, { artist, expect, title }) {
    const modal = await openCreateModal(page);

    await modal.getByLabel(/^Artist$/i).fill(artist);
    await modal.getByLabel(/^Title$/i).fill(title);

    if (expect === 'no-request') {
        let requested = false;
        const spy = (r) => {
            if (r.url().includes('/wishlist/match-metadata')) requested = true;
        };
        page.on('request', spy);
        await modal.getByRole('button', { name: /^find match$/i }).click();
        await page.waitForTimeout(2500);
        page.off('request', spy);

        const gotArtist = await modal.getByLabel(/^Artist$/i).inputValue();
        const gotTitle = await modal.getByLabel(/^Title$/i).inputValue();
        // The prompt to supply the missing field, rather than a silent no-op.
        const prompted = await page
            .getByText(/enter both an artist and a title/i)
            .first()
            .isVisible()
            .catch(() => false);

        if (requested) fail(`partial pair (${artist!==''?'artist':'title'}-only) must not hit match-metadata`);
        else if (!prompted) fail('no "needs both" prompt shown for a partial pair');
        else if (gotArtist !== artist || gotTitle !== title) fail('partial pair must be left as typed');
        else log(`  OK: refused locally, prompted for the missing field, text untouched`);

        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        return;
    }

    // Capture the raw match-metadata response so we assert on the wire, not the UI.
    const responsePromise = page.waitForResponse(
        (r) => r.url().includes('/wishlist/match-metadata'),
        { timeout: 30000 },
    );
    await modal.getByRole('button', { name: /^find match$/i }).click();

    const res = await responsePromise;
    const body = await res.json().catch(() => ({}));
    log(`  wire: ${JSON.stringify(body).slice(0, 160)}`);

    // Let the mutation's onSuccess run (form.setFieldValue / toast).
    await page.waitForTimeout(1500);

    const gotArtist = await modal.getByLabel(/^Artist$/i).inputValue();
    const gotTitle = await modal.getByLabel(/^Title$/i).inputValue();
    log(`  form after: artist=${JSON.stringify(gotArtist)} title=${JSON.stringify(gotTitle)}`);

    if (res.status() !== 200) fail(`match-metadata HTTP ${res.status()}`);

    if (expect === null) {
        if (body.match !== null) {
            fail(`expected {"match": null} for ${artist} - ${title}, got ${JSON.stringify(body.match)}`);
        } else if (gotArtist !== artist || gotTitle !== title) {
            fail(`rejected match must leave text as typed, but form became ${gotArtist} - ${gotTitle}`);
        } else {
            log(`  OK: left as typed (${artist} - ${title})`);
        }
    } else {
        if (!body.match) {
            fail(`expected a match for ${artist} - ${title}, got null`);
        } else if (gotArtist !== expect.artist || gotTitle !== expect.title) {
            // If zod rejected the new `similarity` field, the form would never populate.
            fail(
                `expected form to populate ${expect.artist} - ${expect.title}, ` +
                    `got ${gotArtist} - ${gotTitle} (zod parse of the new response shape?)`,
            );
        } else {
            log(`  OK: corrected to ${gotArtist} - ${gotTitle} (similarity ${body.match.similarity})`);
        }
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
}

(async () => {
    const electronApp = await electron.launch({ args: [MAIN_ENTRY] });
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    await forceFreshLogin(page);
    await performLogin(page, getCredentials());
    log('logged in');

    await goto(page, '/wishlist');

    log('CASE 1: genuine typo -- must correct, and must parse the new response shape');
    await runCase(page, {
        artist: 'Kahn',
        expect: { artist: 'Kahn', title: 'Abattoir' },
        title: 'Abatoir',
    });

    log('CASE 2: VIP mix (#31 headline) -- must be refused and left as typed');
    await runCase(page, {
        artist: 'Interplanetary Criminal',
        expect: null,
        title: 'Yeah Yeah (VIP Mix)',
    });

    log('CASE 3: artist only -- must not resolve; prompt for the missing title');
    await runCase(page, { artist: 'Kahn', expect: 'no-request', title: '' });

    log('CASE 4: title only -- must not resolve; prompt for the missing artist');
    await runCase(page, { artist: '', expect: 'no-request', title: 'Abatoir' });

    await electronApp.close();
    log(process.exitCode ? 'MATCH DRIVER FAILED' : 'MATCH DRIVER PASSED');
})().catch((e) => {
    console.error('[match] crashed:', e);
    process.exit(1);
});
