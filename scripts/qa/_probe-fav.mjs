import { _electron as electron } from 'playwright';

import {
    getCredentials,
    isLoggedOut,
    performLogin,
    resolveAppEntry,
    waitForRouteSettled,
} from '../ui-snapshot-shared.mjs';

// Probe for the player-bar FavoriteButton (right-controls.tsx). Locates it by
// its SVG path signature (the LuHeart icon's `d` attribute) rather than the
// portalled hover tooltip — the original version of this probe used a
// hover+tooltip-text finder plus a snapshot elementHandle click, which proved
// unreliable (button "NOT FOUND" or a stale-handle click landing wrong,
// producing false "0 requests fired" readings). This version reads the
// button's live geometry via page.evaluate and clicks fresh coordinates each
// time, then watches BOTH the network response and the icon's `fill`
// attribute (primary = favorited) over several checkpoints so a real
// no-visual-update case can't be mistaken for "hasn't happened yet".
//
// Live-driven finding (2026-07-24, 9 runs): clicking always fires exactly one
// star.view/unstar.view request (200) — the button is NOT inert. But the
// icon's visual state only reliably reflects an ADD (star.view): 4/4 clean
// updates within 200ms. A REMOVE (unstar.view) fails to visually update ~60%
// of the time (3/5) despite the request succeeding — the icon stays showing
// "favorited" indefinitely (no correction even after further playback
// re-renders). See bugs.md for the full write-up.

const MAIN_ENTRY = resolveAppEntry();
const log = (...a) => console.log('[probe-fav]', ...a);

async function goto(page, route) {
    await page.evaluate((r) => {
        window.location.hash = `#${r}`;
    }, route);
    return waitForRouteSettled(page);
}

function findFavBox(page) {
    return page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button')).filter((b) => {
            const r = b.getBoundingClientRect();
            return Math.round(r.y) === 841;
        });
        // Favorite button = the one whose svg path is the LuHeart shape.
        const heart = buttons.find((b) =>
            b.querySelector('svg path')?.getAttribute('d')?.startsWith('M19 14c1.49'),
        );
        if (!heart) return null;
        const svg = heart.querySelector('svg');
        const r = heart.getBoundingClientRect();
        return {
            fill: svg?.getAttribute('fill') || null,
            x: r.x + r.width / 2,
            y: r.y + r.height / 2,
        };
    });
}

async function main() {
    const credentials = getCredentials();
    const app = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    const page = await app.firstWindow();

    const responses = [];
    page.on('response', (res) => {
        const u = res.url();
        if (/star\.view|unstar\.view/.test(u)) {
            responses.push({ status: res.status(), url: u });
        }
    });

    await page.waitForLoadState('networkidle');
    await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900),
    );
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

    await page.mouse.dblclick(650, Number(process.env.PLAY_Y || 640));
    await page.waitForTimeout(3000);

    const before = await findFavBox(page);
    log('before:', JSON.stringify(before));
    if (!before) {
        log('heart button not found by path signature — abort');
        await app.close();
        process.exit(1);
    }

    await page.mouse.click(before.x, before.y);

    for (const wait of [200, 500, 1000, 2000, 4000]) {
        await page.waitForTimeout(wait);
        const state = await findFavBox(page);
        log(`+${wait}ms fill=`, state?.fill, 'responses so far:', JSON.stringify(responses));
    }

    await app.close();
    log('done');
    process.exit(0);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
