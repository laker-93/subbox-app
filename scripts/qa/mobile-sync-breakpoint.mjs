import path from 'path';
import { chromium } from 'playwright';

import { getCredentials, performLogin, SNAPSHOT_DIR } from '../ui-snapshot-shared.mjs';

// Regression driver for subbox-app#81: below the 768px breakpoint
// (useIsMobile, `(max-width: 768px)`), MobileLayout renders instead of
// DefaultLayout, and switching the ModeToggle to Sync should show
// MobileSyncPlaceholder (not a vanished/broken Sync surface). Never driven at
// any viewport width before — first coverage.
//
// Web build only (`pnpm dev:web`, port 4343) — resizing an Electron
// BrowserWindow this narrow is a much clumsier way to hit the same CSS
// media-query breakpoint.
//
// Usage: node scripts/qa/mobile-sync-breakpoint.mjs

const APP_URL = process.env.UI_SNAPSHOT_APP_URL || 'http://localhost:4343';
const shot = (name) => path.join(SNAPSHOT_DIR, `mobile-sync-breakpoint-${name}-${Date.now()}.png`);

async function main() {
    const credentials = getCredentials();
    const browser = await chromium.launch();
    // 400x800: comfortably under the 768px max-width breakpoint.
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { height: 800, width: 400 },
    });
    const page = await context.newPage();

    page.on('console', (m) => {
        const t = m.text();
        if (/error|fail/i.test(t)) console.log(`[renderer:${m.type()}] ${t}`);
    });

    await page.goto(APP_URL);
    await page.getByRole('button', { name: /^login$/i }).waitFor({ timeout: 20_000 });
    await performLogin(page, credentials);

    // Confirm MobileLayout actually mounted (not just a squished DefaultLayout).
    // The initial post-login navigation can take a couple seconds, so wait for
    // the element itself rather than a fixed sleep.
    const mobileLayoutPresent = await page
        .locator('#mobile-layout')
        .waitFor({ timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
    console.log('MobileLayout mounted at 400px width:', mobileLayoutPresent);
    await page.screenshot({ path: shot('01-mobile-library') });

    // Switch to Sync via the ModeToggle segmented control.
    const syncToggle = page.getByText('Sync', { exact: true }).first();
    await syncToggle.waitFor({ timeout: 10_000 });
    await syncToggle.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: shot('02-mobile-sync-placeholder') });

    const placeholderText = await page
        .getByText(/sync needs a wider screen/i)
        .isVisible()
        .catch(() => false);
    const backButton = page.getByRole('button', { name: /back to library/i });
    const backButtonVisible = await backButton.isVisible().catch(() => false);
    // The real Sync UI (Upload/Download/Watch tabs) must NOT be reachable here.
    const uploadTabLeaked = await page
        .getByRole('button', { name: /^upload$/i })
        .isVisible()
        .catch(() => false);
    console.log('MobileSyncPlaceholder text visible:', placeholderText);
    console.log('"Back to Library" button visible:', backButtonVisible);
    console.log('real Sync tabs leaked through (should be false):', uploadTabLeaked);

    // Round-trip: "Back to Library" should flip appMode back and show Library.
    let backToLibraryWorked = false;
    if (backButtonVisible) {
        await backButton.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: shot('03-back-to-library') });
        backToLibraryWorked = await page
            .getByText(/sync needs a wider screen/i)
            .isVisible()
            .catch(() => false)
            .then((v) => !v);
        console.log('"Back to Library" left the placeholder:', backToLibraryWorked);
    }

    await browser.close();

    const ok =
        mobileLayoutPresent &&
        placeholderText &&
        backButtonVisible &&
        !uploadTabLeaked &&
        backToLibraryWorked;
    console.log('--- RESULT ---', ok ? 'PASS' : 'FAIL');
    process.exit(ok ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(3);
});
