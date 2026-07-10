import path from 'path';
import { _electron as electron } from 'playwright';

import {
    getCredentials,
    hashUrl,
    isLoggedOut,
    performLogin,
    ROOT,
    SNAPSHOT_DIR,
    waitForRouteSettled,
} from '../ui-snapshot-shared.mjs';
import fs from 'fs';

// QA driver for the phone/Discord wishlist-import directive, sub-step 4:
// "sort the newly-imported track into a playlist". Launches the built Electron
// app, logs in, opens the imported track's album detail, right-clicks the
// track, and adds it to a NEW playlist via the add-to-playlist context modal.
// Server-side persistence is verified separately via the subsonic API.
//
// Env:
//   QA_ALBUM_ID       album detail route id (default = the qa-scratch album)
//   QA_TRACK_TITLE    text to locate the track row (default "Import Probe")
//   QA_NEW_PLAYLIST   name of the playlist to create (required to actually add)
//
// Usage: QA_NEW_PLAYLIST="QA Import Playlist 0709" node scripts/qa/add-to-playlist-smoke.mjs

const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.js');
const credentials = getCredentials();

const ALBUM_ID = process.env.QA_ALBUM_ID || '6cqmCIDIfFhcZMpwnoKYVp';
const TRACK_TITLE = process.env.QA_TRACK_TITLE || 'Import Probe';
const NEW_PLAYLIST = process.env.QA_NEW_PLAYLIST || '';

const shot = async (page, name) => {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const p = path.join(SNAPSHOT_DIR, `qa-add-to-playlist-${name}-${Date.now()}.png`);
    await page.screenshot({ path: p });
    console.log('screenshot:', p);
};

async function main() {
    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });

    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });
    const consoleMessages = [];
    page.on('console', (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => consoleMessages.push(`[pageerror] ${err.message}`));

    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) {
        await performLogin(page, credentials);
    } else {
        await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(1000);

    // The app persists a top-level Library/Sync mode toggle; a Sync-mode session
    // hides the library routes. Make sure we're in Library mode first.
    const libraryToggle = page.getByText('Library', { exact: true }).first();
    if (await libraryToggle.isVisible().catch(() => false)) {
        await libraryToggle.click();
        await page.waitForTimeout(800);
    }

    // Navigate to the imported track's album detail (HashRouter).
    const appUrl = page.url().split('#')[0].replace(/\/$/, '');
    await page.evaluate((u) => {
        window.location.hash = u.split('#')[1];
    }, hashUrl(appUrl, `/library/albums/${ALBUM_ID}`));
    if (await waitForRouteSettled(page)) {
        console.log('route stuck — likely expired session; not handled in this smoke');
    }
    await page.waitForTimeout(1000);
    await shot(page, '1-album');

    const bodyBefore = await page.locator('body').innerText().catch(() => '');
    console.log('album route shows track title:', bodyBefore.includes(TRACK_TITLE));

    // Locate the track row cell and right-click it to open the context menu.
    const trackCell = page.getByText(TRACK_TITLE, { exact: false }).first();
    await trackCell.waitFor({ state: 'visible', timeout: 10_000 });
    await trackCell.click(); // select the row first
    await page.waitForTimeout(300);
    await trackCell.click({ button: 'right' });
    await page.waitForTimeout(800);
    await shot(page, '2-contextmenu');

    // Click "Add to playlist" in the context menu.
    const addItem = page.getByText(/add to playlist/i).first();
    if (!(await addItem.isVisible().catch(() => false))) {
        console.log('!! "add to playlist" menu item not visible');
        console.log('visible text:', (await page.locator('body').innerText()).slice(0, 1500));
        await electronApp.close();
        process.exit(2);
    }
    await addItem.click();
    await page.waitForTimeout(1000);
    await shot(page, '3-modal');

    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });

    if (!NEW_PLAYLIST) {
        console.log('QA_NEW_PLAYLIST not set — opened modal only, not adding. Set it to run for real.');
        console.log('modal text:', (await dialog.innerText()).slice(0, 800));
        await electronApp.close();
        return;
    }

    // Type the new playlist name and click the "create playlist <name>" button.
    const searchInput = dialog.getByPlaceholder(/search playlists or type to create/i);
    await searchInput.fill(NEW_PLAYLIST);
    await page.waitForTimeout(400);
    const createBtn = dialog.getByRole('button', { name: new RegExp(`create playlist`, 'i') });
    await createBtn.waitFor({ state: 'visible', timeout: 4000 });
    await createBtn.click();
    await page.waitForTimeout(400);
    await shot(page, '4-pending');

    // Click the final "Add" submit button.
    const addBtn = dialog.getByRole('button', { name: /^add$/i });
    await addBtn.click();

    // Wait for the success toast.
    const success = page.getByText(/added .* to .* playlist/i).first();
    const ok = await success
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
    console.log('success toast shown:', ok);
    if (ok) console.log('toast:', await success.innerText().catch(() => ''));
    await page.waitForTimeout(1000);
    await shot(page, '5-done');

    console.log('--- console/page errors ---');
    console.log(consoleMessages.filter((m) => /error/i.test(m)).join('\n') || '(none)');

    await electronApp.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
