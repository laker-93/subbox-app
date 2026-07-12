import path from 'path';
import { _electron as electron } from 'playwright';

import {
    forceFreshLogin,
    getCredentials,
    isLoggedOut,
    performLogin,
    resolveAppEntry,
    ROOT,
    waitForRouteSettled,
} from '../ui-snapshot-shared.mjs';

// QA driver: a real-user Library → Songs → Favorites journey.
//   songs list → play a track → favorite the now-playing track via the player's
//   FavoriteButton → verify it shows up under /favorites → unfavorite it (revert
//   the test data) → verify it's gone again.
//
// The player FavoriteButton (right-controls.tsx) is the only favorite control
// that carries a "Favorite"/"Unfavorite" tooltip — the inline row hearts have
// none — so we locate it uniquely by hovering bottom-bar buttons and reading the
// portal tooltip text. This keeps the click deterministic without a testid.
//
// Requires a development-mode Electron build (out/main/index.js) pointing at the
// local stack. Usage: node scripts/qa/songs-favorites-journey.mjs

const MAIN_ENTRY = resolveAppEntry();
const log = (...a) => console.log('[songs-favorites]', ...a);
const shot = (page, name) =>
    page.screenshot({ path: path.join(ROOT, '.ui-snapshots', `qa-${name}-${Date.now()}.png`) });

// Navigate by assigning location.hash *in-page* (a real hashchange the app's
// HashRouter handles) rather than page.goto(base#route): after a mid-run
// page.reload(), Playwright treats a same-document hash-only goto as "no
// navigation" and returns without routing, so the app stays on home and the
// target route never renders (0 rows). In-page hash assignment routes reliably.
async function goto(page, route) {
    await page.evaluate((r) => {
        window.location.hash = `#${r}`;
    }, route);
    return waitForRouteSettled(page);
}

// Dismiss any open tooltip/popover so a leftover portal can't sit over the player
// bar and confuse the next hover-based discovery.
async function clearOverlays(page) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.move(5, 5).catch(() => {});
    await page.waitForTimeout(200);
}

// Locate the player FavoriteButton by hovering bottom-region buttons and reading
// the Mantine tooltip (role="tooltip") — it's the only favorite control with a
// "Favorite"/"Unfavorite" tooltip. Returns the live { handle, tooltip } (handle
// clicked directly, never re-queried by index) or null. Short hover timeout so a
// stale handle can't stall the run for 30s.
async function findFavoriteButton(page, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        await clearOverlays(page);
        const buttons = await page.locator('button').elementHandles();
        const vh = page.viewportSize()?.height ?? 900;
        for (const btn of buttons) {
            const box = await btn.boundingBox().catch(() => null);
            if (!box || box.y < vh - 140) continue; // player bar lives at the bottom
            await btn.hover({ timeout: 1500 }).catch(() => {});
            await page.waitForTimeout(150);
            const tip = await page
                .getByRole('tooltip')
                .first()
                .textContent()
                .catch(() => null);
            if (tip && /^(un)?favorite$/i.test(tip.trim())) {
                return { handle: btn, tooltip: tip.trim() };
            }
        }
        await page.waitForTimeout(400); // let the player bar settle, then retry
    }
    return null;
}

async function currentFavoriteState(page) {
    const fav = await findFavoriteButton(page);
    if (!fav) return { found: false };
    // tooltip is "Unfavorite" when the current song is already a favorite,
    // "Favorite" when it isn't.
    return { found: true, isFavorite: /^unfavorite$/i.test(fav.tooltip), tooltip: fav.tooltip };
}

async function clickFavorite(page) {
    const fav = await findFavoriteButton(page);
    if (!fav) throw new Error('favorite button not found in player bar');
    await fav.handle.click({ timeout: 3000 });
    await page.waitForTimeout(1800); // let the star/unstar request settle
}

// Read the song titles currently rendered in a list/table view.
async function readSongTitles(page) {
    return page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[role="row"]'));
        const titles = [];
        for (const r of rows) {
            // Title cell text — prefer an explicit title-ish cell, fall back to row text.
            const cell = r.querySelector('[class*="title" i]') || r;
            const t = cell.textContent?.trim();
            if (t) titles.push(t.slice(0, 80));
        }
        return titles;
    });
}

async function main() {
    const credentials = getCredentials();
    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    const page = await electronApp.firstWindow();

    // Log the Subsonic star/unstar calls that back favoriting, so we can confirm
    // the mutation actually fires and what the server answers — decoupled from
    // whether the /favorites list re-renders.
    page.on('response', async (res) => {
        const url = res.url();
        if (/star\.view|unstar\.view/.test(url)) {
            const kind = /unstar\.view/.test(url) ? 'unstar' : 'star';
            log(`NET ${kind} -> ${res.status()} ${url.replace(/([?&])(u|p|s|t)=[^&]*/g, '$1$2=***')}`);
        }
    });

    await page.waitForLoadState('networkidle');
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });

    if (await isLoggedOut(page)) await performLogin(page, credentials);

    // Ensure appMode=library so library routes render (see albums-journey.mjs),
    // and collapse the right queue sidebar — if it's expanded (persisted state) it
    // takes over the main area, so [role="row"] matches offscreen queue rows and
    // list interactions report "not visible".
    const uiBefore = await page.evaluate(() => {
        try {
            const s = JSON.parse(localStorage.getItem('store_app') || '{}')?.state ?? {};
            return { appMode: s.appMode ?? null, rightExpanded: s.sidebar?.rightExpanded ?? null };
        } catch {
            return { appMode: null, rightExpanded: null };
        }
    });
    log('ui at launch:', JSON.stringify(uiBefore));
    if (uiBefore.appMode !== 'library' || uiBefore.rightExpanded) {
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
    }

    // --- Songs list ---
    let stuck = await goto(page, '/library/songs');
    if (stuck) {
        await forceFreshLogin(page);
        await performLogin(page, credentials);
        stuck = await goto(page, '/library/songs');
    }
    log('songs route stuck?', stuck);

    // The grid can mount empty for a beat after a reload/relogin (route renders
    // before the songs fetch resolves). Wait for data rows, re-navigating a
    // couple of times if it's still empty, before deciding there's nothing here.
    const countRows = () =>
        page.evaluate(() => document.querySelectorAll('[role="row"]').length);
    for (let i = 0; i < 4 && (await countRows()) <= 1; i++) {
        log(`songs grid empty (attempt ${i + 1}) — waiting/re-navigating`);
        await page.waitForTimeout(1200);
        await goto(page, '/library/songs');
    }

    const listInfo = await page.evaluate(() => {
        const rows = document.querySelectorAll('[role="row"]');
        const header = document.querySelector('[class*="PageHeader"], header')?.textContent?.trim() || null;
        return { rowCount: rows.length, header: header?.slice(0, 120) ?? null };
    });
    log('songs list:', JSON.stringify(listInfo));
    await shot(page, 'songs-list');

    if (listInfo.rowCount === 0) {
        log('NO song rows — cannot continue. Body sample:');
        log(await page.evaluate(() => document.body.innerText.slice(0, 400)));
        await electronApp.close();
        return;
    }

    const titlesBefore = await readSongTitles(page);
    log('first few song rows:', JSON.stringify(titlesBefore.slice(0, 5)));

    // --- Start playback ---
    // The Tracks header carries an explicit "Play" button (same affordance as
    // the album-detail header) — the reliable, obvious real-user action for
    // "play from this list". We use it rather than double-clicking a row: the
    // ag-grid data rows are positioned with absolute transforms, which trips
    // Playwright's actionability check ("element is not visible") even though
    // they render fine on screen (a real user double-clicks them without
    // issue — confirmed visually in qa-songs-list-*.png). The header Play
    // button avoids that automation quirk while exercising the same playback path.
    const playButton = page.getByRole('button', { name: /^play$/i }).first();
    if (await playButton.isVisible().catch(() => false)) {
        await playButton.click().catch((e) => log('play click failed:', e.message));
    } else {
        // Fallback: double-click a data row at its real screen coordinates.
        const rowBox = await page
            .locator('[role="row"][aria-rowindex="5"]')
            .first()
            .boundingBox()
            .catch(() => null);
        log('no header Play button; row box:', JSON.stringify(rowBox));
        if (rowBox) {
            await page.mouse.dblclick(
                rowBox.x + Math.min(rowBox.width / 2, 300),
                rowBox.y + rowBox.height / 2,
            );
        }
    }
    await page.waitForTimeout(3500);

    const playing = await page.evaluate(() => {
        const audio = document.querySelector('audio');
        const bar = document.querySelector('[class*="playerbar" i], [class*="PlayerBar" i]');
        return {
            audioPaused: audio ? audio.paused : null,
            audioCurrentTime: audio ? Number(audio.currentTime.toFixed(1)) : null,
            barText: bar?.textContent?.trim()?.slice(0, 160) || null,
        };
    });
    log('after play:', JSON.stringify(playing));
    await shot(page, 'songs-playing');

    // --- Favorite the now-playing track ---
    const before = await currentFavoriteState(page);
    log('favorite state before:', JSON.stringify(before));
    if (!before.found) {
        log('could not find player FavoriteButton — aborting favorite step.');
        await electronApp.close();
        return;
    }

    // We want to test add→verify→remove. If it's already a favorite, remove first
    // so we start from a clean not-favorited baseline.
    if (before.isFavorite) {
        log('track already favorited; clearing first to test a clean add.');
        await clickFavorite(page);
    }

    // ADD to favorites.
    await clickFavorite(page);
    const afterAdd = await currentFavoriteState(page);
    log('favorite state after add:', JSON.stringify(afterAdd));

    // Capture the now-playing title so we can find it in /favorites.
    const nowPlayingTitle = await page.evaluate(() => {
        const bar = document.querySelector('[class*="playerbar" i], [class*="PlayerBar" i]');
        // The line-1 title link in the player bar.
        const link = bar?.querySelector('a[href*="/albums/"], a[href*="/songs"], [class*="title" i]');
        return (link?.textContent || bar?.textContent || '').trim().slice(0, 80) || null;
    });
    log('now-playing title:', JSON.stringify(nowPlayingTitle));

    // --- Verify it appears under /favorites (defaults to Songs, favorite=true) ---
    await goto(page, '/favorites');
    await page.waitForTimeout(500);
    const favTitles = await readSongTitles(page);
    const favInfo = await page.evaluate(() => {
        const rows = document.querySelectorAll('[role="row"]');
        const header = document.querySelector('[class*="PageHeader"], header')?.textContent?.trim() || null;
        return { rowCount: rows.length, header: header?.slice(0, 120) ?? null };
    });
    log('favorites view:', JSON.stringify(favInfo));
    log('favorites titles (first 8):', JSON.stringify(favTitles.slice(0, 8)));
    await shot(page, 'favorites-after-add');

    const foundInFavorites = nowPlayingTitle
        ? favTitles.some((t) => t.includes(nowPlayingTitle) || nowPlayingTitle.includes(t))
        : null;
    log('now-playing track present in favorites after add?', foundInFavorites);

    // --- Revert: unfavorite the track (leave the test library as we found it) ---
    // The player bar (and its FavoriteButton bound to the current song) is still
    // present on the /favorites route, so we can toggle it back off here.
    const beforeRemove = await currentFavoriteState(page);
    log('favorite state before remove:', JSON.stringify(beforeRemove));
    if (beforeRemove.found && beforeRemove.isFavorite) {
        await clickFavorite(page);
        await page.waitForTimeout(800);
    }
    const afterRemove = await currentFavoriteState(page);
    log('favorite state after remove:', JSON.stringify(afterRemove));

    // Re-check the favorites list no longer contains it (need a reload/refetch).
    await goto(page, '/favorites');
    await page.waitForTimeout(600);
    const favTitlesAfterRemove = await readSongTitles(page);
    const stillThere = nowPlayingTitle
        ? favTitlesAfterRemove.some((t) => t.includes(nowPlayingTitle) || nowPlayingTitle.includes(t))
        : null;
    log('favorites row count after remove:', favTitlesAfterRemove.length);
    log('now-playing track still in favorites after remove?', stillThere);
    await shot(page, 'favorites-after-remove');

    await electronApp.close();
    log('done');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
