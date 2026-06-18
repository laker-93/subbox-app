import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

import {
    forceFreshLogin,
    getCredentials,
    hashUrl,
    isLoggedOut,
    parseSnapshotArgs,
    performLogin,
    SNAPSHOT_DIR,
    snapshotFilePath,
    waitForRouteSettled,
} from './ui-snapshot-shared.mjs';

// Screenshots the web build at a given route + viewport so an agent (or human) can
// visually inspect layout without driving a browser by hand. Logs in once and reuses
// the saved session (storageState) on subsequent runs.
//
// Usage: node scripts/ui-snapshot.mjs <route> [width] [height]
//   node scripts/ui-snapshot.mjs /wishlist
//   node scripts/ui-snapshot.mjs /wishlist 390 844   # e.g. narrow viewport
//
// For the Electron desktop build, use scripts/ui-snapshot-electron.mjs instead.

const APP_URL = process.env.UI_SNAPSHOT_APP_URL || 'http://localhost:4343';
const AUTH_STATE_FILE = path.join(SNAPSHOT_DIR, 'auth-state.json');

const { route, viewport } = parseSnapshotArgs(process.argv.slice(2));
const credentials = getCredentials();

async function main() {
    const browser = await chromium.launch();
    const hasSavedSession = fs.existsSync(AUTH_STATE_FILE);
    const context = await browser.newContext({
        storageState: hasSavedSession ? AUTH_STATE_FILE : undefined,
        viewport,
    });
    const page = await context.newPage();

    await page.goto(APP_URL);
    if (await isLoggedOut(page)) {
        await performLogin(page, credentials);
        await context.storageState({ path: AUTH_STATE_FILE });
    }

    await page.goto(hashUrl(APP_URL, route));
    const stuck = await waitForRouteSettled(page);

    if (stuck) {
        // Saved session's credential has likely expired — log in fresh and retry once.
        await forceFreshLogin(page);
        await performLogin(page, credentials);
        await context.storageState({ path: AUTH_STATE_FILE });
        await page.goto(hashUrl(APP_URL, route));
        await waitForRouteSettled(page);
    }

    const filePath = snapshotFilePath({ prefix: 'web', route, viewport });
    // fullPage capture can render blank with this app's fixed-position player bar —
    // viewport-only also better matches what a user actually sees without scrolling.
    await page.screenshot({ path: filePath });

    await browser.close();

    console.log(filePath);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
