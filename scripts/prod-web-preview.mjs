// Opens a real browser on https://www.sub-box.net whose assets are served from the
// LOCAL `out/web` build instead of the deployed one. Everything else — pymix,
// Navidrome, Filebrowser — is untouched production. This is the web analog of
// `pnpm prod` (which builds + runs the Electron shell against prod env); run via
// `pnpm run prod:web`.
//
// Why not just `vite preview` on localhost: pymix's session cookie is `Secure` and
// scoped to sub-box.net, so a localhost origin never stores it and login spins
// forever. Keeping the page origin identical to production makes auth, cookies and
// CORS behave exactly as deployed, leaving the bundle as the only variable.
//
// The window stays open and is yours to drive; close it (or Ctrl-C) to finish.
//
//   pnpm run prod:web
//   LOCAL_BUNDLE=0 node scripts/prod-web-preview.mjs   # A/B vs the deployed bundle
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const WEB_DIR = path.resolve(import.meta.dirname, '..', 'out', 'web');
const APP_URL = process.env.PROD_APP_URL || 'https://www.sub-box.net';
const SERVE_LOCAL = process.env.LOCAL_BUNDLE !== '0';

const CONTENT_TYPES = {
    '.css': 'text/css',
    '.html': 'text/html',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.map': 'application/json',
    '.mjs': 'text/javascript',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain',
    '.webmanifest': 'application/manifest+json',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

if (SERVE_LOCAL && !fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
    console.error(
        `No web build at ${WEB_DIR}.\nRun \`pnpm run build:web\` first (production mode — it bakes the prod pymix/Navidrome URLs).`,
    );
    process.exit(2);
}

const appOrigin = new URL(APP_URL).origin;

const browser = await chromium.launch({
    args: ['--disable-blink-features=AutomationControlled'],
    headless: false,
});
const context = await browser.newContext({
    serviceWorkers: 'block', // a cached SW would serve the deployed bundle back
    viewport: { height: 900, width: 1440 },
});

let served = 0;
let passedThrough = 0;

if (SERVE_LOCAL) {
    await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());

        // Only the app's own origin comes from disk. pymix.sub-box.net,
        // navidrome*.sub-box.net and browser.sub-box.net stay real.
        if (url.origin !== appOrigin) {
            passedThrough += 1;
            return route.continue();
        }

        const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        let file = path.join(WEB_DIR, relative);

        // SPA fallback: the app is hash-routed, but a deep path or a bare / must
        // still land on index.html rather than 404.
        if (!relative || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            file = path.join(WEB_DIR, 'index.html');
        }

        // Never escape the build directory, whatever the path contains.
        if (!file.startsWith(WEB_DIR)) {
            return route.fulfill({ body: 'Forbidden', status: 403 });
        }

        served += 1;
        return route.fulfill({
            body: fs.readFileSync(file),
            contentType: CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
            status: 200,
        });
    });
}

const page = await context.newPage();
page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[page error] ${msg.text()}`);
});

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

console.log(`\n  Origin:  ${APP_URL}`);
console.log(`  Bundle:  ${SERVE_LOCAL ? `LOCAL — ${WEB_DIR}` : 'DEPLOYED (production)'}`);
console.log('  Backends: real production (pymix, Navidrome, Filebrowser)\n');
console.log('  Drive the window yourself. Close it to exit.\n');

await new Promise((resolve) => {
    browser.on('disconnected', resolve);
    process.on('SIGINT', resolve);
});

console.log(`\n  ${served} requests served from the local build, ${passedThrough} passed through.`);
await browser.close().catch(() => {});
