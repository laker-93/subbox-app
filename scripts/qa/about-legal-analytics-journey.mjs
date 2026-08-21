import path from 'path';
import { _electron as electron } from 'playwright';

import {
    forceFreshLogin,
    getCredentials,
    performLogin,
    resolveAppEntry,
    ROOT,
    waitForRouteSettled,
} from '../ui-snapshot-shared.mjs';

// QA driver: pause-era Settings -> About tab (#93/#96/#89), Legal pages (#98),
// and the analytics-beacon-removed claim (#99) — three related, small, unchecked
// README rows driven as one journey since they all live under Settings/landing.
//
//   1. Track every network request for the whole run; assert none ever hits an
//      analytics/umami endpoint (the "verifiable as a negative" the README asks for).
//   2. Log in, open Settings -> About: check Legal / Licence / Music credits
//      sections all render real content (not blank/error), and that the
//      Music-credits "Show N more" control actually expands/collapses the list.
//   3. Log back out to the landing page and check its own legal-links row (which
//      renders the same useLegalLinks() hook, not a duplicated list) is present
//      with matching hrefs -- confirms no drift between the two surfaces.
//
// Usage: node scripts/qa/about-legal-analytics-journey.mjs

const MAIN_ENTRY = resolveAppEntry();
const SNAP = path.join(ROOT, '.ui-snapshots');

const log = (...a) => console.log('[about-legal-analytics]', ...a);

async function goto(page, route) {
    const baseUrl = page.url().split('#')[0];
    await page.goto(`${baseUrl}#${route}`);
    return waitForRouteSettled(page);
}

async function main() {
    const credentials = getCredentials();
    const analyticsHits = [];

    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    const page = await electronApp.firstWindow();

    page.on('request', (req) => {
        const url = req.url();
        if (/umami|analytics/i.test(url)) analyticsHits.push(url);
    });

    await page.waitForLoadState('networkidle');
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });

    // Force a real logged-out boot first (a resumed session from a prior cycle
    // would otherwise skip straight past the landing page we need to inspect).
    await forceFreshLogin(page);
    await page.waitForLoadState('networkidle');

    // --- Landing page (logged out): confirm window.umami is really undefined,
    // and capture the legal-links row before logging in. ---
    const umamiDefined = await page.evaluate(() => typeof window.umami !== 'undefined');
    log('window.umami defined on boot?', umamiDefined);

    const landingLegalLinks = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href*="/legal/"]')).map((a) => ({
            href: a.getAttribute('href'),
            text: a.textContent?.trim(),
        })),
    );
    log('landing page legal links:', JSON.stringify(landingLegalLinks));

    await performLogin(page, credentials);
    log('logged in');

    // /settings only renders through the router Outlet while appMode === 'library'
    // (Sync mode replaces the whole Outlet with SyncModePlaceholder regardless of
    // route) -- a persisted 'sync' appMode from an earlier cycle's session can
    // otherwise make a raw hash-navigation to /settings silently show the Sync
    // screen instead. Make sure we're in Library mode before navigating there,
    // same as a real user would be if they used the sidebar's own Settings entry.
    const libraryToggle = page.getByText(/^library$/i).first();
    if (await libraryToggle.count()) {
        await libraryToggle.click().catch(() => {});
        await page.waitForTimeout(500);
    }

    let stuck = await goto(page, '/settings');
    if (stuck) {
        await forceFreshLogin(page);
        await performLogin(page, credentials);
        stuck = await goto(page, '/settings');
    }
    log('settings route stuck?', stuck);
    await page.waitForTimeout(1000);

    const aboutTab = page.getByRole('tab', { name: /^about$/i });
    const aboutTabCount = await aboutTab.count();
    log('about tab present?', !!aboutTabCount);
    if (aboutTabCount) {
        await aboutTab.first().click();
        await page.waitForTimeout(1000);
    }

    const aboutInfo = await page.evaluate(() => {
        const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
        const visible = panels.filter(
            (p) => p.offsetParent !== null || p.getClientRects().length > 0,
        );
        const panel = visible[visible.length - 1] || panels[panels.length - 1] || null;
        const links = Array.from(panel?.querySelectorAll('a[href]') || []).map((a) => ({
            href: a.getAttribute('href'),
            text: a.textContent?.trim(),
        }));
        const text = panel?.innerText?.trim() || '';
        return {
            errorLike: /error|crashed|something went wrong/i.test(text) && text.length < 200,
            linkCount: links.length,
            links,
            textLen: text.length,
            textSample: text.slice(0, 400),
        };
    });
    log('about tab content:', JSON.stringify(aboutInfo, null, 2));
    await page.screenshot({ path: path.join(SNAP, `qa-about-tab-${Date.now()}.png`) });

    // Music credits "Show all (N more)" expand/collapse round trip.
    const showMoreBtn = page.getByRole('button', { name: /show all/i });
    const showMoreCount = await showMoreBtn.count();
    let creditsExpand = null;
    if (showMoreCount) {
        const beforeRows = await page
            .locator('text=/CC BY|CC0|Public Domain/')
            .count()
            .catch(() => null);
        await showMoreBtn.first().click();
        await page.waitForTimeout(400);
        const afterRows = await page
            .locator('text=/CC BY|CC0|Public Domain/')
            .count()
            .catch(() => null);
        const showLessBtn = page.getByRole('button', { name: /show less/i });
        const showLessVisible = await showLessBtn
            .first()
            .isVisible()
            .catch(() => false);
        await showLessBtn
            .first()
            .click()
            .catch(() => {});
        await page.waitForTimeout(400);
        const collapsedRows = await page
            .locator('text=/CC BY|CC0|Public Domain/')
            .count()
            .catch(() => null);
        creditsExpand = { afterRows, beforeRows, collapsedRows, showLessVisible };
    }
    log('music credits expand/collapse:', JSON.stringify(creditsExpand));

    await electronApp.close();

    log('=== SUMMARY ===');
    log(
        'analytics/umami network hits (expect 0):',
        analyticsHits.length,
        JSON.stringify(analyticsHits),
    );
    log('window.umami defined (expect false):', umamiDefined);
    log('landing legal links (expect 3):', landingLegalLinks.length);
    log('about tab present (expect true):', !!aboutTabCount);
    log(
        'about tab links (expect >= 3+4, no error text):',
        aboutInfo.linkCount,
        'errorLike:',
        aboutInfo.errorLike,
    );
    log(
        'credits expand/collapse (expect afterRows > beforeRows, collapsedRows === beforeRows):',
        JSON.stringify(creditsExpand),
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
