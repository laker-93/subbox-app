import fs from 'fs';
import path from 'path';

// Shared helpers for scripts/ui-snapshot.mjs (web) and scripts/ui-snapshot-electron.mjs
// (desktop). Both log into the same pymix-backed app with the same test account and
// the same login UI — only how the app is launched/reached differs.

export const ROOT = path.resolve(import.meta.dirname, '..');
export const SNAPSHOT_DIR = path.join(ROOT, '.ui-snapshots');
const ENV_FILE = path.join(ROOT, '.env.ui-snapshot.local');

function loadEnvFile(file) {
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (!(key in process.env)) process.env[key] = value;
    }
}

loadEnvFile(ENV_FILE);

export function getCredentials() {
    const username = process.env.UI_SNAPSHOT_USERNAME;
    const password = process.env.UI_SNAPSHOT_PASSWORD;

    if (!username || !password) {
        console.error(
            `Missing credentials. Create ${path.relative(ROOT, ENV_FILE)} (see .env.ui-snapshot.local.example) ` +
                'with UI_SNAPSHOT_USERNAME, UI_SNAPSHOT_PASSWORD.',
        );
        process.exit(1);
    }

    return { password, username };
}

export async function isLoggedOut(page) {
    return page
        .getByRole('button', { name: /^login$/i })
        .first()
        .isVisible()
        .catch(() => false);
}

export function parseSnapshotArgs(argv) {
    const [route = '/', widthArg, heightArg] = argv;
    return {
        route,
        viewport: {
            height: Number(heightArg) || 900,
            width: Number(widthArg) || 1440,
        },
    };
}

// Assumes the landing page (with its "Login" button) is already showing — callers
// are responsible for getting there (web: goto the app URL; electron: it's the
// window's initial load).
export async function performLogin(page, { password, username }) {
    await page.getByRole('button', { name: /^login$/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/username/i).fill(username);
    await dialog.getByLabel(/password/i).fill(password);
    await dialog.getByRole('button', { name: /^login$/i }).click();
    await page.getByText(/logged in successfully/i).waitFor({ timeout: 15_000 });
    // Auth store persists to localStorage asynchronously after the success toast fires.
    await page.waitForTimeout(1000);
}

// Routes are app-internal paths (AppRoute enum values, e.g. /wishlist) — the app is a
// HashRouter, so navigation goes through the hash, not the path.
export const hashUrl = (appUrl, route) => `${appUrl}/#${route}`;

// Drops the persisted session and reloads to the landing page, so a fresh
// performLogin() can run. Use when waitForRouteSettled reports the route is stuck
// (almost always an expired session credential, not a real layout/loading bug).
export async function forceFreshLogin(page) {
    await page.evaluate(() => localStorage.removeItem('store_authentication'));
    await page.reload();
}

export function snapshotFilePath({ prefix, route, viewport }) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const slug = route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-');
    const fileName = `${prefix}-${slug}-${viewport.width}x${viewport.height}-${Date.now()}.png`;
    return path.join(SNAPSHOT_DIR, fileName);
}

// Returns true if the route still looks stuck loading after settling — the pymix
// session credential is short-lived (~5-10 min observed) and a freshly-launched
// process that resumes a persisted/saved session can load a token that's already
// expired; the app retries the failing request a few times but never re-logs-in on
// its own. Callers should treat a true result as "force a fresh login and retry".
export async function waitForRouteSettled(page) {
    // For navigations that don't block on a load event (e.g. mutating
    // window.location.hash directly, as the Electron script does), give React Router
    // a moment to react and kick off its data fetch before checking network/spinner
    // state — otherwise networkidle can resolve before the fetch even starts.
    await page.waitForTimeout(300);
    await page.waitForLoadState('networkidle');

    // Route content (e.g. wishlist items) loads via React Query after navigation —
    // wait for the loading spinner to clear rather than racing it.
    const spinner = page.locator('[class*="spinner-module"]').first();
    if (await spinner.isVisible().catch(() => false)) {
        await spinner.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    }

    // Routes fade in via a 300ms motion animation (AnimatedPage) — give it time to finish
    // so the screenshot doesn't land mid-transition (visible as a black/blank capture).
    await page.waitForTimeout(500);

    return spinner.isVisible().catch(() => false);
}
