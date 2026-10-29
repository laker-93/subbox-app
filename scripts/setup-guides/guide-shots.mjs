// Screenshots for the onboarding guides, cropped and annotated, written straight to the
// guides' img/ names. Drives a dev-mode Electron build against the local dev stack.
//
//   APP=<build>/main/index.js FIXTURE=<fixture root> OUT=<dir> node guide-shots.mjs rekordbox|serato|folder
//
// Click targets get a numbered amber outline, drawn into the page before the shot, so
// the image needs no editing afterwards.
import fs from 'fs';
import os from 'os';
import path from 'path';

const QA = '/Users/lukepurnell/workspace/feishin-qa';
const { _electron: electron } = await import(`${QA}/node_modules/playwright/index.mjs`);
const { performLogin } = await import(`${QA}/scripts/ui-snapshot-shared.mjs`);

const FORMAT = process.argv[2];
const P = { folder: 'wa', rekordbox: 'rb', serato: 'se' }[FORMAT];
const { APP, FIXTURE, OUT } = process.env;
const XML = path.join(FIXTURE, 'rb/rekordbox.xml');
const SERATO = path.join(FIXTURE, 'serato/_Serato_');
const FOLDER = path.join(FIXTURE, 'folder/Music');
const credentials = { password: 'GuideShots2026pass', username: 'guide231026' };
fs.mkdirSync(OUT, { recursive: true });

// What a reader would see on their own machine instead of the fixture dir.
const REWRITES = [
    [XML, '/Users/you/Documents/rekordbox.xml'],
    [SERATO, '/Users/you/Music/_Serato_'],
    [FOLDER, '/Users/you/Music/New Music'],
    [FIXTURE, '/Users/you'],
];

let page;

const tidy = async () => {
    await page.mouse.move(640, 790);
    await page.waitForTimeout(700);
    for (const close of await page.locator('.mantine-Notification-closeButton').all()) {
        await close.click().catch(() => {});
    }
    await page.waitForTimeout(300);
    await page.evaluate((rewrites) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            for (const [from, to] of rewrites) {
                if (n.nodeValue.includes(from)) n.nodeValue = n.nodeValue.split(from).join(to);
            }
        }
    }, REWRITES);
};

// Outline each locator and, when there are several, badge each with its number.
const mark = async (locators) => {
    const boxes = [];
    for (const l of locators) boxes.push(await l.first().boundingBox());
    await page.evaluate((boxes) => {
        const layer = document.createElement('div');
        layer.id = 'guide-marks';
        layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
        boxes.forEach((b, i) => {
            const pad = 5;
            const ring = document.createElement('div');
            ring.style.cssText = `position:fixed;left:${b.x - pad}px;top:${b.y - pad}px;width:${b.width + 2 * pad}px;height:${b.height + 2 * pad}px;border:3px solid #ffb020;border-radius:9px;box-shadow:0 0 0 3px rgba(0,0,0,.45)`;
            layer.append(ring);
            // One target needs no number.
            if (boxes.length === 1) return;
            const badge = document.createElement('div');
            badge.textContent = String(i + 1);
            const left = Math.min(b.x + b.width + pad - 13, innerWidth - 28);
            badge.style.cssText = `position:fixed;left:${left}px;top:${Math.max(2, b.y - pad - 13)}px;width:26px;height:26px;border-radius:50%;background:#ffb020;color:#14161a;font:700 15px/26px system-ui,sans-serif;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.5)`;
            layer.append(badge);
        });
        document.body.append(layer);
    }, boxes.filter(Boolean));
};
const unmark = () => page.evaluate(() => document.getElementById('guide-marks')?.remove());

const shot = async (name, { clip, marks = [] } = {}) => {
    await tidy();
    if (marks.length) await mark(marks);
    await page.screenshot({ clip, path: path.join(OUT, `${name}.png`) });
    await unmark();
    console.log('shot', name);
};

// A box around a locator, padded and kept inside the window.
const around = async (locator, { padX = 24, padY = 24 } = {}) => {
    const b = await locator.first().boundingBox();
    const x = Math.max(0, Math.floor(b.x - padX));
    const y = Math.max(0, Math.floor(b.y - padY));
    return {
        height: Math.min(800 - y, Math.ceil(b.height + 2 * padY)),
        width: Math.min(1280 - x, Math.ceil(b.width + 2 * padX)),
        x,
        y,
    };
};

const radioLabel = async (value) => {
    const id = await page
        .locator(`input[type="radio"][value="${value}"]`)
        .first()
        .getAttribute('id');
    return page.locator(`label[for="${id}"]`);
};
// Mantine re-ids a segmented control's radios when it re-renders, so find the label by text.
const segmentLabel = async (name) => page.locator('label').filter({ hasText: name });

const app = await electron.launch({
    args: [APP, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'guide-'))}`],
    env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
});
await app.evaluate(
    async ({ dialog }, target) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    },
    { folder: FOLDER, rekordbox: XML, serato: SERATO }[FORMAT],
);

page = await app.firstWindow();
await page.waitForLoadState('load');
await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w?.unmaximize();
    w?.setContentSize(1280, 800);
    w?.center();
});
await page.setViewportSize({ height: 800, width: 1280 });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', {
    deviceScaleFactor: 2,
    height: 800,
    mobile: false,
    width: 1280,
});
await page.waitForTimeout(1000);

const loginButton = page.getByRole('button', { name: /^login$/i }).first();
await loginButton.waitFor({ timeout: 60_000 });
if (FORMAT === 'rekordbox') {
    await shot('landing', {
        clip: { height: 520, width: 1280, x: 0, y: 140 },
        marks: [loginButton],
    });
    await loginButton.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/username/i).fill('your-username');
    await dialog.getByLabel(/password/i).fill('a-good-password');
    await shot('login', {
        clip: await around(dialog, { padX: 12, padY: 12 }),
        marks: [dialog.getByRole('button', { name: /^login$/i })],
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
}
await performLogin(page, credentials);
await page.waitForTimeout(3000);

const syncLabel = await radioLabel('sync');
await syncLabel.click();

if (FORMAT === 'folder') {
    const watchTab = page.getByRole('button', { name: /^watch$/i }).first();
    await watchTab.waitFor({ timeout: 30_000 });
    await watchTab.click();
    await page.waitForTimeout(800);
    const select = page.getByRole('button', { name: /select directory/i });
    await shot('wa-start', { clip: { height: 300, width: 1280, x: 0, y: 0 }, marks: [syncLabel, watchTab, select] });
    await select.first().click();
    await page.waitForTimeout(800);
    const start = page.getByRole('button', { name: /start watching/i });
    await shot('wa-ready', { clip: { height: 300, width: 1280, x: 0, y: 0 }, marks: [start] });
    await start.first().click();
    // "Watching for new files" also shows before the first pass has found anything,
    // so wait for an upload to start, then for the folder to go idle again.
    await page
        .getByText(/^uploading \d+\/\d+/i)
        .first()
        .waitFor({ timeout: 60_000 });
    await page
        .getByText(/watching for new files/i)
        .first()
        .waitFor({ timeout: 600_000 });
    await page.waitForTimeout(1000);
    await shot('wa-done', { clip: { height: 220, width: 760, x: 0, y: 130 } });
    // pymix imports what landed in the watch folder on its own schedule; give it
    // time before the library is shot.
    await page.waitForTimeout(90_000);
    await (await radioLabel('library')).click();
    await page.waitForTimeout(3000);
    const tracks = page.getByText(/^tracks$/i).first();
    await tracks.click();
    await page.waitForTimeout(5000);
    await shot('wa-library', { clip: { height: 680, width: 1280, x: 0, y: 0 }, marks: [tracks] });
    await (await radioLabel('sync')).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /^watch$/i }).first().click();
    await page.getByRole('button', { name: /stop watching/i }).first().click();
    await page.waitForTimeout(800);
    await app.close();
    process.exit(0);
}
const uploadTab = page.getByRole('button', { name: /^upload$/i }).first();
await uploadTab.waitFor({ timeout: 30_000 });
await uploadTab.click();
await page.waitForTimeout(800);

if (FORMAT === 'rekordbox') {
    const rb = await segmentLabel(/^rekordbox$/i);
    await rb.click();
    await page.waitForTimeout(600);
    const select = page.getByRole('button', { name: /select xml file/i });
    await shot('rb-start', { marks: [syncLabel, rb, select] });
    await select.first().click();
} else {
    const se = await segmentLabel(/^serato$/i);
    await se.click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Settings' }).first().click();
    const settings = page.getByRole('dialog');
    await settings.waitFor();
    const change = settings.getByRole('button').filter({ hasText: /serato folder/i });
    await change.first().click();
    await page.waitForTimeout(600);
    await shot('se-settings', {
        clip: await around(settings, { padX: 12, padY: 12 }),
        marks: [change],
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const read = page.getByRole('button', { name: /read library/i });
    await shot('se-start', { marks: [syncLabel, se, read] });
    await read.first().click();
}

await page
    .getByText(/preview changes/i)
    .first()
    .waitFor({ timeout: 60_000 });
const upload = page.getByRole('button', { name: /^upload$/i }).last();
await shot(`${P}-preview`, { marks: [upload] });
await upload.click();
await page.waitForTimeout(2500);
await shot(`${P}-uploading`, { clip: { height: 220, width: 640, x: 320, y: 290 } });
const done = page.getByText(/upload complete|import complete/i).first();
await done.waitFor({ timeout: 600_000 });
await page.waitForTimeout(1000);
await shot(`${P}-done`, { clip: { height: 300, width: 600, x: 340, y: 250 } });

// Back to the library, open Gigs › Warm Up.
await (await radioLabel('library')).click();
await page.waitForTimeout(5000);
await page
    .getByText(/^gigs$/i)
    .first()
    .click()
    .catch(() => {});
await page.waitForTimeout(1000);
const warmUp = page.getByText(/^warm up$/i).first();
await warmUp.click();
await page.waitForTimeout(4000);
await shot(`${P}-playlist`, { clip: { height: 680, width: 1280, x: 0, y: 0 }, marks: [warmUp] });
await app.close();
