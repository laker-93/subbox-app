import { _electron as electron } from 'playwright';

import {
    getCredentials,
    isLoggedOut,
    performLogin,
    resolveAppEntry,
    waitForRouteSettled,
} from '../ui-snapshot-shared.mjs';

const MAIN_ENTRY = resolveAppEntry();
const log = (...a) => console.log('[probe]', ...a);

const dump = async (page, tag) => {
    const info = await page.evaluate(() => ({
        hash: location.hash,
        rows: document.querySelectorAll('[role="row"]').length,
        agRows: document.querySelectorAll('.ag-row').length,
        gridPresent: !!document.querySelector('[class*="ag-root"], [class*="VirtualTable"]'),
        active: document.querySelector('a[aria-current="page"], [class*="active" i] a')?.textContent?.trim() || null,
        main: (document.querySelector('main')?.innerText || document.body.innerText).slice(0, 200),
    }));
    log(tag, JSON.stringify(info));
};

async function main() {
    const credentials = getCredentials();
    const app = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('networkidle');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
    if (await isLoggedOut(page)) await performLogin(page, credentials);

    // Force library mode + collapse right sidebar, then reload (mirrors songs script).
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
    await dump(page, 'after-reload');

    // Approach A: hash goto (what the songs script does)
    const base = page.url().split('#')[0];
    log('url before goto:', page.url());
    await page.goto(`${base}#/library/songs`);
    await waitForRouteSettled(page);
    await dump(page, 'after-hash-goto');

    // Approach B: click the "Tracks" sidebar link
    const tracks = page.getByRole('link', { name: /^tracks$/i }).first();
    const vis = await tracks.isVisible().catch(() => false);
    log('Tracks link visible?', vis);
    if (vis) {
        await tracks.click().catch((e) => log('click failed', e.message));
        await waitForRouteSettled(page);
        await page.waitForTimeout(1000);
        await dump(page, 'after-tracks-click');
    }

    // Approach C: in-page location.hash assignment (fires a real hashchange) —
    // navigate to /favorites this way to see if it routes reliably.
    await page.evaluate(() => { window.location.hash = '#/favorites'; });
    await waitForRouteSettled(page);
    await page.waitForTimeout(500);
    await dump(page, 'after-inpage-hash-favorites');

    await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
