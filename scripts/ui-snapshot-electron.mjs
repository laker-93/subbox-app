import fs from 'fs';
import path from 'path';
import { _electron as electron } from 'playwright';

import {
    forceFreshLogin,
    getCredentials,
    isLoggedOut,
    parseSnapshotArgs,
    performLogin,
    ROOT,
    snapshotFilePath,
    waitForRouteSettled,
} from './ui-snapshot-shared.mjs';

// Screenshots the Electron desktop build at a given route + window size, so a UI
// problem can be checked in the actual desktop app rather than assumed from the web
// build. Logs in once and reuses the saved session (Electron's own userData,
// scoped to a separate -dev profile) on subsequent runs.
//
// Usage: node scripts/ui-snapshot-electron.mjs <route> [width] [height]
//   node scripts/ui-snapshot-electron.mjs /wishlist
//   node scripts/ui-snapshot-electron.mjs /wishlist 480 800   # near minimum window size
//
// Requires `pnpm run build:electron` to have been run first (this launches the built
// out/main/index.js, not a live dev server) — rebuild after every source change you
// want reflected, the same way you'd reload the web build.

const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.js');

const { route, viewport } = parseSnapshotArgs(process.argv.slice(2));
const credentials = getCredentials();

if (!fs.existsSync(MAIN_ENTRY)) {
    console.error(
        `${path.relative(ROOT, MAIN_ENTRY)} not found. Run "pnpm run build:electron" first ` +
            '(and again after any source change you want this screenshot to reflect).',
    );
    process.exit(1);
}

async function main() {
    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: {
            ...process.env,
            // Separate userData dir from the user's real installed app, skips the
            // single-instance lock, and avoids auto-update network calls — see
            // src/main/index.ts (isDevelopment) and src/main/utils.ts (disableAutoUpdates).
            DISABLE_AUTO_UPDATES: '1',
            NODE_ENV: 'development',
        },
    });

    const page = await electronApp.firstWindow();
    await page.waitForLoadState('networkidle');

    // The window is created at a fixed default size (1440x900) — resize the actual
    // OS window via the main process; page.setViewportSize doesn't apply to Electron.
    await electronApp.evaluate(({ BrowserWindow }, { height, width }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(width, height);
    }, viewport);

    if (await isLoggedOut(page)) {
        await performLogin(page, credentials);
    }

    // Mutating window.location.hash directly is racy here — on a fresh mount,
    // HashRouter's listener isn't guaranteed to be attached yet, so the change can be
    // silently dropped. A real navigation (like the web script's page.goto) reliably
    // mounts the router with the target route already in the hash. The file:// base
    // already ends in index.html, so the hash attaches directly (no extra `/`).
    const baseUrl = page.url().split('#')[0];
    await page.goto(`${baseUrl}#${route}`);
    const stuck = await waitForRouteSettled(page);

    if (stuck) {
        // Electron's persisted session (reused across launches) likely has an expired
        // credential — log in fresh and retry once.
        await forceFreshLogin(page);
        await performLogin(page, credentials);
        await page.goto(`${baseUrl}#${route}`);
        await waitForRouteSettled(page);
    }

    const filePath = snapshotFilePath({ prefix: 'electron', route, viewport });
    await page.screenshot({ path: filePath });

    await electronApp.close();

    console.log(filePath);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
