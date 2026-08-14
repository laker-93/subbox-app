import fs from 'fs';
import path from 'path';
import { _electron as electron } from 'playwright';

import {
    forceFreshLogin,
    getCredentials,
    isLoggedOut,
    performLogin,
    resolveAppEntry,
    SNAPSHOT_DIR,
} from '../ui-snapshot-shared.mjs';

// Regression driver for the rebuilt Sync -> Download screen (subbox-app #101/#102/#103):
// one download, "Include tracks" / "Include Rekordbox XML" tick-boxes choosing its
// contents, desktop keeping the full local-vs-server diff. Desktop (Electron) only —
// the web build takes a structurally different branch (manifest, no diff, `user_root`
// gets a `music` segment) and needs its own driver against `pnpm dev:web`.
//
// Usage: node scripts/qa/sync-download-tickboxes.mjs
// Env: QA_PLAYLIST (default "Downtempo", 9 tracks on test060826 — smallest real playlist)

const MAIN_ENTRY = resolveAppEntry();
const credentials = getCredentials();
const targetPlaylist = process.env.QA_PLAYLIST || 'Downtempo';

async function main() {
    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    electronApp.process().stdout.on('data', (d) => process.stdout.write(`[main] ${d}`));
    electronApp.process().stderr.on('data', (d) => process.stderr.write(`[main-err] ${d}`));

    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });
    await page.waitForLoadState('networkidle');

    if (await isLoggedOut(page)) {
        await performLogin(page, credentials);
    } else {
        // A session persisted against a different build/backend shouldn't be reused.
        await forceFreshLogin(page);
        await page.waitForLoadState('networkidle');
        if (await isLoggedOut(page)) await performLogin(page, credentials);
    }

    await page.waitForTimeout(1000);

    // Mode toggle -> Sync -> Download tab.
    await page.getByText('Sync', { exact: true }).first().click();
    await page.waitForTimeout(1000);
    await page.getByText('Download', { exact: true }).first().click();
    await page.waitForTimeout(1000);

    const shot = (name) =>
        page.screenshot({
            path: path.join(SNAPSHOT_DIR, `qa-sync-tickboxes-${name}-${Date.now()}.png`),
        });
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

    // ── Select playlist ──────────────────────────────────────────────────
    const playlistRow = page.getByText(targetPlaylist, { exact: true }).first();
    const playlistVisible = await playlistRow.isVisible().catch(() => false);
    console.log(`playlist "${targetPlaylist}" visible:`, playlistVisible);
    if (!playlistVisible) {
        await shot('playlist-not-found');
        throw new Error(`playlist "${targetPlaylist}" not found in the select-playlists list`);
    }
    await playlistRow.click();
    await page.waitForTimeout(500);

    const previewButton = page.getByRole('button', { name: /^preview download$/i });
    if (!(await previewButton.isEnabled().catch(() => false))) {
        await shot('preview-disabled');
        throw new Error('Preview Download button not enabled after selecting a playlist');
    }
    await previewButton.click();

    const generating = page.getByText('Generating sync plan', { exact: false }).first();
    await generating.waitFor({ state: 'hidden', timeout: 60_000 }).catch((e) => {
        console.log('still generating after 60s:', e.message);
    });
    await page.waitForTimeout(500);

    // ── Preview screen: confirm tick-boxes + full diff (desktop) render ────
    const includeTracksBox = page.getByRole('checkbox', { name: /include tracks/i });
    const includeXmlBox = page.getByRole('checkbox', { name: /include rekordbox xml/i });
    const bothPresent =
        (await includeTracksBox.isVisible().catch(() => false)) &&
        (await includeXmlBox.isVisible().catch(() => false));
    console.log('both tick-boxes present:', bothPresent);
    const tracksCheckedInitially = await includeTracksBox.isChecked().catch(() => null);
    const xmlCheckedInitially = await includeXmlBox.isChecked().catch(() => null);
    console.log(
        'default state - includeTracks:',
        tracksCheckedInitially,
        'includeXml:',
        xmlCheckedInitially,
    );

    // Desktop keeps the full diff: 3 tabs + already-present/to-download/metadata badges.
    const missingTab = page.getByRole('button', { name: /^missing \(\d+\)$/i });
    const existingTab = page.getByRole('button', { name: /^already present \(\d+\)$/i });
    const diffTabsPresent =
        (await missingTab.isVisible().catch(() => false)) &&
        (await existingTab.isVisible().catch(() => false));
    console.log('desktop diff tabs present (missing/already present):', diffTabsPresent);
    const bodyTextPreview = await page
        .locator('body')
        .innerText()
        .catch(() => '');
    const badgeMatch = bodyTextPreview.match(/(\d+)\s*already present/);
    const missingMatch = bodyTextPreview.match(/(\d+)\s*to download/);
    console.log(
        'already-present badge:',
        badgeMatch?.[1] ?? '(not found)',
        '| to-download badge:',
        missingMatch?.[1] ?? '(not found)',
    );
    await shot('preview');

    // ── XML-only download (untick "Include tracks") ────────────────────────
    await includeTracksBox.uncheck();
    await page.waitForTimeout(300);
    const downloadBtnLabel1 = await page
        .getByRole('button', { name: /download rekordbox xml|download & extract|download zip/i })
        .textContent()
        .catch(() => null);
    console.log('download button label with tracks unticked:', downloadBtnLabel1);

    const downloadButton = page.getByRole('button', {
        name: /download rekordbox xml|download & extract|download zip/i,
    });
    const xmlOnlyEnabled = await downloadButton.isEnabled().catch(() => false);
    console.log('XML-only download button enabled:', xmlOnlyEnabled);
    let xmlOnlyOutcome = 'skipped (button disabled)';
    if (xmlOnlyEnabled) {
        await downloadButton.click();
        xmlOnlyOutcome = await Promise.race([
            page
                .getByText(/download complete/i)
                .waitFor({ timeout: 60_000 })
                .then(() => 'done'),
            page
                .locator('text=/download failed/i')
                .first()
                .waitFor({ timeout: 60_000 })
                .then(() => 'error'),
        ]).catch(() => 'hang');
        console.log('XML-only download outcome:', xmlOnlyOutcome);
        if (xmlOnlyOutcome === 'done') {
            const doneText = await page
                .locator('body')
                .innerText()
                .catch(() => '');
            console.log('done-screen mentions "No audio files":', /no audio files/i.test(doneText));
        }
        await shot('xml-only-done');
    }

    // ── Back to select, re-run with both ticked (tracks + XML) ─────────────
    const startOver = page.getByRole('button', { name: /^start over$/i });
    if (await startOver.isVisible().catch(() => false)) {
        await startOver.click();
        await page.waitForTimeout(800);
    }

    let tracksAndXmlOutcome = 'skipped (playlist re-select failed)';
    const previewButton2 = page.getByRole('button', { name: /^preview download$/i });
    const playlistRow2 = page.getByText(targetPlaylist, { exact: true }).first();
    if (await playlistRow2.isVisible().catch(() => false)) {
        // The playlist list may re-fetch/remount right after "Start Over" (a fresh
        // plan invalidates queries) — retry the click until the selection actually
        // registers (Preview Download becomes enabled) instead of firing once blind.
        for (let attempt = 0; attempt < 5; attempt++) {
            if (await previewButton2.isEnabled().catch(() => false)) break;
            await page.getByText(targetPlaylist, { exact: true }).first().click({ force: true });
            await page.waitForTimeout(500);
        }
        console.log(
            'preview button enabled after retry loop:',
            await previewButton2.isEnabled().catch(() => false),
        );
        await previewButton2.click();
        await generating.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(500);

        // includeTracks/includeRekordboxXml are component state, not reset by
        // handleBack ("Start Over") — so the XML-only run above should have left
        // "Include tracks" still unticked here. Re-tick it explicitly to test the
        // tracks+XML combo (this is the real, verified behavior, not a driver bug —
        // see the log/doc note).
        const includeTracksBox2 = page.getByRole('checkbox', { name: /include tracks/i });
        const persistedUnchecked = !(await includeTracksBox2.isChecked().catch(() => true));
        console.log('includeTracks persisted unticked from the XML-only run:', persistedUnchecked);
        if (persistedUnchecked) {
            await includeTracksBox2.check();
            await page.waitForTimeout(300);
        }

        const downloadButton2 = page.getByRole('button', {
            name: /download & extract|download zip/i,
        });
        if (await downloadButton2.isEnabled().catch(() => false)) {
            await downloadButton2.click();
            tracksAndXmlOutcome = await Promise.race([
                page
                    .getByText(/download complete/i)
                    .waitFor({ timeout: 180_000 })
                    .then(() => 'done'),
                page
                    .locator('text=/download failed/i')
                    .first()
                    .waitFor({ timeout: 180_000 })
                    .then(() => 'error'),
            ]).catch(() => 'hang');
            console.log('tracks+XML download outcome:', tracksAndXmlOutcome);
            if (tracksAndXmlOutcome === 'done') {
                const doneText2 = await page
                    .locator('body')
                    .innerText()
                    .catch(() => '');
                console.log('done-screen text:', doneText2.split('\n').slice(0, 6).join(' | '));
                console.log(
                    'Show Music button present:',
                    await page
                        .getByRole('button', { name: /show music/i })
                        .isVisible()
                        .catch(() => false),
                );
                console.log(
                    'Show Rekordbox XML button present:',
                    await page
                        .getByRole('button', { name: /show rekordbox xml/i })
                        .isVisible()
                        .catch(() => false),
                );
            }
            await shot('tracks-and-xml-done');
        } else {
            console.log(
                'tracks+XML download button not enabled (nothing missing after XML-only run?)',
            );
        }
    }

    console.log('--- SUMMARY ---');
    console.log(
        JSON.stringify(
            {
                bothTickboxesPresent: bothPresent,
                desktopDiffTabsPresent: diffTabsPresent,
                tracksAndXmlOutcome,
                xmlOnlyOutcome,
            },
            null,
            2,
        ),
    );

    await electronApp.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
