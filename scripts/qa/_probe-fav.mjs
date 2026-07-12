import { _electron as electron } from 'playwright';

import {
    getCredentials,
    isLoggedOut,
    performLogin,
    resolveAppEntry,
    waitForRouteSettled,
} from '../ui-snapshot-shared.mjs';

// Focused probe: does clicking the player-bar FavoriteButton actually issue a
// star.view/unstar.view request, and does the button's own DOM state reflect
// the current song's favorite status? Decides bug-vs-measurement-artifact for
// the songs-favorites journey. Reads button state from the DOM (icon fill),
// not the racy hover tooltip, and captures network at the *request* level.

const MAIN_ENTRY = resolveAppEntry();
const log = (...a) => console.log('[probe-fav]', ...a);

async function goto(page, route) {
    await page.evaluate((r) => {
        window.location.hash = `#${r}`;
    }, route);
    return waitForRouteSettled(page);
}

// The player FavoriteButton is only identifiable via its portalled hover
// tooltip ("Favorite"/"Unfavorite") — same finder the journey uses. Returns the
// live button handle + tooltip text (favorited === tooltip "Unfavorite").
async function findFavButton(page) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.move(5, 5).catch(() => {});
    await page.waitForTimeout(150);
    const buttons = await page.locator('button').elementHandles();
    const vh = page.viewportSize()?.height ?? 900;
    for (const btn of buttons) {
        const box = await btn.boundingBox().catch(() => null);
        if (!box || box.y < vh - 140) continue;
        await btn.hover({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(150);
        const tip = await page.getByRole('tooltip').first().textContent().catch(() => null);
        if (tip && /^(un)?favorite$/i.test(tip.trim())) {
            return { handle: btn, tooltip: tip.trim(), box };
        }
    }
    return null;
}

async function main() {
    const credentials = getCredentials();
    const app = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    const page = await app.firstWindow();

    const netLog = [];
    page.on('request', (req) => {
        const u = req.url();
        if (/star\.view|unstar\.view|\/star|\/unstar/.test(u)) {
            netLog.push(u.replace(/([?&])(u|p|s|t|c)=[^&]*/g, '$1$2=***'));
            log('REQ', u.replace(/([?&])(u|p|s|t|c)=[^&]*/g, '$1$2=***'));
        }
    });

    await page.waitForLoadState('networkidle');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
    if (await isLoggedOut(page)) await performLogin(page, credentials);

    await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('store_app') || '{}');
        if (raw.state) {
            raw.state.appMode = 'library';
            if (raw.state.sidebar) raw.state.sidebar.rightExpanded = false;
        }
        localStorage.setItem('store_app', JSON.stringify(raw));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(500);

    await goto(page, '/library/songs');
    for (let i = 0; i < 4; i++) {
        const n = await page.evaluate(() => document.querySelectorAll('[role="row"]').length);
        if (n > 1) break;
        await page.waitForTimeout(1200);
        await goto(page, '/library/songs');
    }

    // Play a data row. ag-grid's role=row wrapper is 0-height so its boundingBox
    // is meaningless (every row reports the same top-of-grid box) — instead
    // double-click at an absolute on-screen y well down the list to land on a
    // real-metadata track (rows 7+ in test260526 have proper tags; rows 1-6 are
    // stripped "_unknown" QA scratch imports). ~y=640 hits the "1 on 1" track.
    const playX = 650;
    const playY = Number(process.env.PLAY_Y || 640);
    await page.mouse.dblclick(playX, playY);
    await page.waitForTimeout(3000);

    const playing = await page.evaluate(() => {
        const a = document.querySelector('audio');
        const bar = document.querySelector('[class*="playerbar" i], [class*="PlayerBar" i]');
        return {
            paused: a?.paused ?? null,
            t: a ? Number(a.currentTime.toFixed(1)) : null,
            bar: bar?.textContent?.trim()?.slice(0, 100) || null,
        };
    });
    log('playing?', JSON.stringify(playing));

    const before = await findFavButton(page);
    log('fav button before click:', before ? JSON.stringify({ tooltip: before.tooltip }) : 'NOT FOUND');
    if (!before) {
        log('no fav button found — abort');
        await app.close();
        return;
    }

    // Click the found button handle directly and watch for a star/unstar request.
    const netBefore = netLog.length;
    await before.handle.click({ timeout: 3000 });
    await page.waitForTimeout(2500);
    const after = await findFavButton(page);
    log('fav button after click:', after ? JSON.stringify({ tooltip: after.tooltip }) : 'NOT FOUND');
    log(`star/unstar requests fired by this click: ${netLog.length - netBefore}`);

    // Toggle back only if the click actually fired a request (kept state honest).
    if (netLog.length - netBefore > 0) {
        const b2 = await findFavButton(page);
        if (b2) await b2.handle.click({ timeout: 3000 });
        await page.waitForTimeout(2000);
        log(`total star/unstar requests after revert click: ${netLog.length - netBefore}`);
    }

    await app.close();
    log('done');
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
