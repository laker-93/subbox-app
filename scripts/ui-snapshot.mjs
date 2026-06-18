import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

// Screenshots the web build at a given route + viewport so an agent (or human) can
// visually inspect layout without driving a browser by hand. Logs in once and reuses
// the saved session (storageState) on subsequent runs.
//
// Usage: node scripts/ui-snapshot.mjs <route> [width] [height]
//   node scripts/ui-snapshot.mjs /wishlist
//   node scripts/ui-snapshot.mjs /wishlist 390 844   # e.g. narrow viewport
//
// Routes are app-internal paths (AppRoute enum values, e.g. /wishlist) — the app is a
// HashRouter, so the script appends them after a `#`.

const ROOT = path.resolve(import.meta.dirname, '..');
const SNAPSHOT_DIR = path.join(ROOT, '.ui-snapshots');
const AUTH_STATE_FILE = path.join(SNAPSHOT_DIR, 'auth-state.json');
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

const APP_URL = process.env.UI_SNAPSHOT_APP_URL || 'http://localhost:4343';
const USERNAME = process.env.UI_SNAPSHOT_USERNAME;
const PASSWORD = process.env.UI_SNAPSHOT_PASSWORD;

const [route = '/', widthArg, heightArg] = process.argv.slice(2);
const viewport = {
    height: Number(heightArg) || 900,
    width: Number(widthArg) || 1440,
};

if (!USERNAME || !PASSWORD) {
    console.error(
        `Missing credentials. Create ${path.relative(ROOT, ENV_FILE)} (see .env.ui-snapshot.local.example) ` +
            'with UI_SNAPSHOT_USERNAME, UI_SNAPSHOT_PASSWORD.',
    );
    process.exit(1);
}

fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

const hashUrl = (route) => `${APP_URL}/#${route}`;

async function isLoggedOut(page) {
    return page
        .getByRole('button', { name: /^login$/i })
        .first()
        .isVisible()
        .catch(() => false);
}

async function login(page) {
    await page.goto(APP_URL);
    await page.getByRole('button', { name: /^login$/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/username/i).fill(USERNAME);
    await dialog.getByLabel(/password/i).fill(PASSWORD);
    await dialog.getByRole('button', { name: /^login$/i }).click();
    await page.getByText(/logged in successfully/i).waitFor({ timeout: 15_000 });
    // Auth store persists to localStorage asynchronously after the success toast fires.
    await page.waitForTimeout(1000);
}

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
        await login(page);
        await context.storageState({ path: AUTH_STATE_FILE });
    }

    await page.goto(hashUrl(route));
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

    const slug = route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-');
    const fileName = `${slug}-${viewport.width}x${viewport.height}-${Date.now()}.png`;
    const filePath = path.join(SNAPSHOT_DIR, fileName);
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
