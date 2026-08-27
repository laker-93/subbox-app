import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { _electron as electron, ElectronApplication, Page } from 'playwright';

import { nodeKey, readCrateTree } from '../src/main/features/core/sync/serato-crates';

// The top half of rung 5: the Electron window itself.
//
// `pnpm dev:serato-roundtrip` already drives the same main-process functions over
// the same HTTP, so what this adds is only the wiring between them — the checkbox,
// the folder picker, the IPC call, and the report on the done screen. That wiring
// is exactly what a headless driver cannot reach, and exactly where a feature that
// works in every unit test still arrives broken.
//
// Two passes, because they take different branches through handleDownload:
//   1. tracks + crates — the real thing: audio lands, then crates are written
//      against the paths the download just produced.
//   2. crates only     — no download at all, musicRoot falls back to the app's own
//      music folder, and the crates written by pass 1 get replaced (so the backup
//      path runs too).
//
// Dev only. Writes into a throwaway _Serato_ folder under /tmp, never yours.
//
//   pnpm dev:serato-ui
//   PLAYLISTS="Techno" pnpm dev:serato-ui

/** pnpm runs scripts from the package root. */
const ROOT = process.cwd();
const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.js');
const SNAPSHOT_DIR = path.join(ROOT, '.ui-snapshots');

/** Where the dev build keeps downloaded music — VITE_SUBBOX_APP_DIR, beside userData. */
const DEV_MUSIC_DIR = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'subbox-dev',
    'music',
);

const USERNAME = process.env.SUBBOX_USER ?? 'test060826';
const PASSWORD = process.env.SUBBOX_PASSWORD ?? 'Testpass12345!';

const PLAYLISTS = (process.env.PLAYLISTS ?? 'Subbox Demo / Closers,Subbox Demo / Peak Time,Techno')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** What the done screen said about the crates, as the user reads it. */
type SeratoReport = {
    backedUp: boolean;
    /** The whole done screen, whitespace-collapsed. */
    body: string;
    crates: number;
    text: string;
    tracks: number;
};

async function chooseSeratoFolder(page: Page, folder: string): Promise<void> {
    // The dialog is stubbed in the main process, so this exercises the real
    // handler — resolveSeratoFolder, the SubCrates check, the localSettings write.
    await page.getByRole('button', { name: /Serato Folder/ }).click();
    await page.getByText(folder, { exact: true }).waitFor({ timeout: 10_000 });
}

/** Everything the crates in a folder point at, as the import would read it back. */
function crateContents(seratoFolder: string): Map<string, string[]> {
    return new Map(readCrateTree(seratoFolder).map((n) => [nodeKey(n.components), n.tracks]));
}

async function login(page: Page): Promise<void> {
    if (
        !(await page
            .getByRole('button', { name: /^login$/i })
            .first()
            .isVisible())
    )
        return;
    await page.getByRole('button', { name: /^login$/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/username/i).fill(USERNAME);
    await dialog.getByLabel(/password/i).fill(PASSWORD);
    await dialog.getByRole('button', { name: /^login$/i }).click();
    await page.getByText(/logged in successfully/i).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1000);
}

async function main(): Promise<void> {
    assert.ok(
        fs.existsSync(MAIN_ENTRY),
        `${path.relative(ROOT, MAIN_ENTRY)} not found — run: pnpm exec electron-vite build --mode development`,
    );

    // Never the user's own library: a write bug here strips the GEOB frames off
    // real music, and there is no undo.
    const seratoFolder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'serato-ui-')));
    fs.mkdirSync(path.join(seratoFolder, 'SubCrates'), { recursive: true });
    console.log(`Serato folder for this run:\n  ${seratoFolder}\n`);

    // The app's music folder outlives the run (it is a sibling of userData, not
    // inside it), so a second run would "download" nothing and still pass. Clear it
    // unless asked not to — everything in it came from the dev stack.
    if (!process.env.KEEP_MUSIC) {
        console.log(`Clearing ${DEV_MUSIC_DIR}`);
        fs.rmSync(DEV_MUSIC_DIR, { force: true, recursive: true });
    }

    const app: ElectronApplication = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });

    // The main process logs what it wrote; that log is the other half of the report.
    const mainLog: string[] = [];
    app.process().stdout?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
            if (line.includes('[serato]')) {
                mainLog.push(line.trim());
                console.log(`  main: ${line.trim()}`);
            }
        }
    });

    await app.evaluate(async ({ dialog }, folder) => {
        // Replaces the native folder picker for this run only — a modal dialog
        // would block the main process and the run would hang here forever.
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, seratoFolder);

    const page = await app.firstWindow();
    await page.waitForLoadState('networkidle');
    await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });

    await login(page);
    console.log(`  logged in as ${USERNAME}`);

    // Sync mode is a store toggle, not a route — there is no URL to navigate to.
    await page
        .locator('label')
        .filter({ hasText: /^Sync$/ })
        .first()
        .click();
    await page.getByRole('button', { exact: true, name: 'Download' }).click();
    await page.getByRole('heading', { name: 'Download Playlists' }).waitFor({ timeout: 20_000 });
    console.log('  Sync -> Download open');

    for (const name of PLAYLISTS) {
        await page.getByText(name, { exact: true }).first().click();
    }
    await page.getByText(`${PLAYLISTS.length} selected`).waitFor({ timeout: 5000 });
    console.log(`  ${PLAYLISTS.length} playlists ticked`);

    // The tick boxes live on the preview screen, not the selection one — the
    // choice of what goes in the download is made once its size is known.
    await openPreview(page);

    await chooseSeratoFolder(page, seratoFolder);
    const crateBox = page.getByRole('checkbox', { name: 'Write Serato crates' });
    assert.ok(await crateBox.isEnabled(), 'the crates checkbox should enable once a folder is set');
    await crateBox.check();
    console.log('  Serato folder chosen and crates ticked');

    // ── pass 1: tracks + crates ─────────────────────────────────────────────
    console.log('\nPass 1 — download, then write crates against what landed');
    const first = await runDownload(page, 'Download & Extract');
    assert.ok(first.tracks > 0, 'pass 1 should have written crates with tracks in them');
    console.log(`  done screen: ${first.text}`);

    const afterFirst = crateContents(seratoFolder);
    assert.equal(afterFirst.size, PLAYLISTS.length, 'one crate per selected playlist');
    assert.equal(first.crates, PLAYLISTS.length, 'the report should count the crates written');
    for (const [name, tracks] of afterFirst) {
        const gone = tracks.filter((t) => !fs.existsSync(t));
        assert.deepEqual(gone, [], `every path in ${name} should be a file on disk`);
        console.log(`  ${name}: ${tracks.length} tracks, all present on disk`);
    }
    assert.ok(!first.backedUp, 'nothing to back up on the first write into an empty folder');

    // ── pass 2: crates only ─────────────────────────────────────────────────
    console.log('\nPass 2 — crates only, no download');
    // Start Over keeps the playlist selection, so pass 2 differs only in the tick boxes.
    await page.getByRole('button', { exact: true, name: 'Start Over' }).click();
    await page.getByRole('heading', { name: 'Download Playlists' }).waitFor({ timeout: 10_000 });
    await openPreview(page);
    await page.getByRole('checkbox', { name: 'Include tracks' }).uncheck();
    await page.getByRole('checkbox', { name: 'Include Rekordbox XML' }).uncheck();
    const second = await runDownload(page, 'Write Serato Crates');
    console.log(`  done screen: ${second.text}`);
    assert.ok(
        second.body.includes('Nothing was downloaded'),
        'the crates-only branch should say so rather than claim a download',
    );
    assert.ok(second.backedUp, 'replacing crates should back the old ones up');

    const afterSecond = crateContents(seratoFolder);
    assert.deepEqual(
        Array.from(afterSecond, ([name, tracks]) => [name, tracks.length]).sort(),
        Array.from(afterFirst, ([name, tracks]) => [name, tracks.length]).sort(),
        'crates-only should rewrite the same crates, from the app music folder',
    );
    console.log('  same crates, same tracks, written without a download — OK');

    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const shot = path.join(SNAPSHOT_DIR, `serato-crates-done-${Date.now()}.png`);
    await page.screenshot({ path: shot });
    await app.close();

    console.log(`\nScreenshot: ${path.relative(ROOT, shot)}`);
    console.log(`Crates kept at: ${seratoFolder}`);
    console.log('\nElectron round trip passed.');
}

/** Ask pymix for the plan and wait for the screen that carries the tick boxes. */
async function openPreview(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Preview Download' }).click();
    await page.getByRole('heading', { name: 'Download Preview' }).waitFor({ timeout: 120_000 });
}

/** Run the download and read the done screen's Serato report back. */
async function runDownload(page: Page, buttonLabel: string): Promise<SeratoReport> {
    const button = page.getByRole('button', { exact: true, name: buttonLabel });
    await button.waitFor({ timeout: 10_000 });
    assert.ok(await button.isEnabled(), `"${buttonLabel}" should be clickable`);
    await button.click();

    // The heading follows what was actually done: nothing is fetched when crates
    // are all that was ticked.
    await page
        .getByRole('heading', { name: /Download Complete|Crates Written/ })
        .waitFor({ timeout: 600_000 });
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const counts = body.match(/(\d+) Serato crates? written with (\d+) tracks?/);
    assert.ok(counts, `the done screen should report what it wrote; got: ${body.slice(0, 400)}`);

    const summary = body.match(/(Serato crates written[^.]*\.|\d+ tracks? exported[^.]*\.)/);
    return {
        backedUp: body.includes('backed up to'),
        body,
        crates: Number(counts[1]),
        text: `${summary?.[0] ?? ''} ${counts[0]}`.trim(),
        tracks: Number(counts[2]),
    };
}

main().catch(async (err) => {
    console.error(err);
    process.exit(1);
});
