import fs from 'fs';
import { _electron as electron } from 'playwright';

import {
    getCredentials,
    isLoggedOut,
    performLogin,
    resolveAppEntry,
    SNAPSHOT_DIR,
} from '../ui-snapshot-shared.mjs';

// Coverage: README "[mixed] Action required / no-network states (/action-required,
// /no-network)". Verifies the client-side "server unreachable" UX: on a relaunch
// where the persisted server's requests fail with a real network error (not an
// HTTP error response), useServerAuthenticated (hooks/use-server-authenticated.ts)
// should retry once then redirect to /no-network (NoNetworkRoute) WITHOUT clearing
// the saved server/credentials, and its Retry button should recover once the
// network comes back.
//
// Network failure is simulated via Playwright request interception (route.abort),
// not by touching the shared docker stack — this isolates the test to client-side
// error handling and avoids disrupting `traefik`/`pymix`/`navidrome*` containers
// the user (or other QA cycles) may be using concurrently.

const MAIN_ENTRY = resolveAppEntry();
const credentials = getCredentials();

async function launch() {
    const app = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });
    await page.waitForLoadState('networkidle');
    return { app, page };
}

async function main() {
    console.log('app entry:', MAIN_ENTRY);
    let failed = false;

    // ---- Launch 1: normal login, capture the server URL so launch 2 knows what to block ----
    let serverUrl;
    {
        const { app, page } = await launch();
        if (await isLoggedOut(page)) await performLogin(page, credentials);
        await page.waitForTimeout(1500);
        serverUrl = await page.evaluate(() => {
            const raw = localStorage.getItem('store_authentication');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const servers = parsed?.state?.serverList || {};
            const first = Object.values(servers)[0];
            return first?.url || null;
        });
        console.log('launch 1: logged in, server url =', serverUrl);
        if (!serverUrl) {
            console.log('  FAIL: could not read persisted server URL from localStorage');
            failed = true;
        }
        await app.close();
    }

    if (failed) {
        console.log('\nOVERALL: FAIL (setup)');
        process.exit(1);
    }

    const serverHost = new URL(serverUrl).host;

    // ---- Launch 2: relaunch with the persisted session, block all requests to the
    // server host so the initial getUserInfo call fails as a real network error ----
    {
        const { app, page } = await launch();
        await page.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (url.host === serverHost) {
                return route.abort('connectionrefused');
            }
            return route.continue();
        });

        // The hook: 1 retry (NETWORK_RETRY_DELAY_MS=500ms) then navigate to /no-network.
        const noNetworkText = page.getByText(/server unavailable/i).first();
        const outcome = await Promise.race([
            noNetworkText.waitFor({ timeout: 20_000 }).then(() => 'no-network-shown'),
            page
                .getByRole('button', { name: /^login$/i })
                .first()
                .waitFor({ timeout: 20_000 })
                .then(() => 'logged-out'),
        ]).catch(() => 'timeout');

        console.log('launch 2 (server host blocked): outcome =', outcome);

        fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
        const shot1 = `${SNAPSHOT_DIR}/no-network-blocked-${Date.now()}.png`;
        await page.screenshot({ path: shot1 }).catch(() => {});
        console.log('  screenshot:', shot1);

        if (outcome !== 'no-network-shown') {
            console.log('  FAIL: expected the /no-network page (icon+text+Retry), got:', outcome);
            failed = true;
        } else {
            const retryBtn = page.getByRole('button', { name: /retry/i }).first();
            const retryVisible = await retryBtn.isVisible().catch(() => false);
            console.log('  Retry button visible:', retryVisible);
            if (!retryVisible) failed = true;

            // Credentials must be PRESERVED on network failure (not logged out) —
            // confirm the session is still in localStorage.
            const stillHasServer = await page.evaluate(() => {
                const raw = localStorage.getItem('store_authentication');
                if (!raw) return false;
                const parsed = JSON.parse(raw);
                return Object.keys(parsed?.state?.serverList || {}).length > 0;
            });
            console.log('  server/credentials preserved in localStorage:', stillHasServer);
            if (!stillHasServer) {
                console.log('  FAIL: network failure should NOT clear saved credentials');
                failed = true;
            }

            // Now unblock the server host and click Retry — expect recovery to Home.
            await page.unroute('**/*');
            if (retryVisible) {
                await retryBtn.click();
                const recovered = await Promise.race([
                    page
                        .getByRole('button', { name: /retry/i })
                        .first()
                        .waitFor({ state: 'hidden', timeout: 15_000 })
                        .then(() => true),
                ]).catch(() => false);
                await page.waitForTimeout(1500);
                const stillOnNoNetwork = await page
                    .getByText(/server unavailable/i)
                    .first()
                    .isVisible()
                    .catch(() => false);
                console.log('  after Retry: no-network page still visible =', stillOnNoNetwork);
                const shot2 = `${SNAPSHOT_DIR}/no-network-recovered-${Date.now()}.png`;
                await page.screenshot({ path: shot2 }).catch(() => {});
                console.log('  screenshot:', shot2);
                if (stillOnNoNetwork || !recovered) {
                    console.log('  FAIL: Retry did not recover back into the app');
                    failed = true;
                } else {
                    console.log('  PASS: Retry recovered back into the app');
                }
            }
        }

        await app.close();
    }

    console.log(`\nOVERALL: ${failed ? 'FAIL' : 'PASS'}`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
