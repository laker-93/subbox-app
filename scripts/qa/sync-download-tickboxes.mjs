import fs from 'fs';
import path from 'path';
import { _electron as electron } from 'playwright';

import {
    checkedSegment,
    closeSyncSettings,
    forceFreshLogin,
    getCredentials,
    isLoggedOut,
    openSyncSettings,
    performLogin,
    resolveAppEntry,
    segment,
    selectSegment,
    SNAPSHOT_DIR,
} from '../ui-snapshot-shared.mjs';

// Regression driver for the rebuilt Sync -> Download screen (subbox-app #101/#102/#103),
// updated for the sync-ui substrate work: the three tick-boxes ("Include tracks",
// "Include Rekordbox XML", "Write Serato crates") are now two segmented controls —
// "Format" (Rekordbox | Serato) on the screen, and "Include" (Tracks + XML | XML only)
// behind the settings cog, where the de-clutter pass moved it along with every folder
// picker. The primary button is a plain "Download" in every mode now, so this no longer
// reads the choice back off it. The file keeps its old name so the QA journal's
// references to it still resolve. Desktop (Electron)
// only — the web build takes a structurally different branch (manifest, no diff,
// `user_root` gets a `music` segment) and has its own driver, web-sync-manifest.mjs.
//
// "Format" is persisted in the app store (`libraryFormat.download`), NOT component
// state, so it survives app relaunches and leaks between driver runs. Every phase here
// selects it explicitly rather than trusting a default.
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

    // ── Preview screen: confirm the format controls + full diff (desktop) ──
    // Both segmented controls must exist; the radios are 0x0 so ask the a11y tree
    // whether they are attached rather than isVisible(), which is false by design.
    const formatOptions = [/^rekordbox$/i, /^serato$/i];
    const includeOptions = [/^tracks \+ xml$/i, /^xml only$/i];
    const formatPresent = (await segment(page, formatOptions[0]).count()) > 0;
    console.log('format control present on the screen:', formatPresent);
    if (!formatPresent) {
        await shot('format-controls-missing');
        throw new Error('Format segmented control not found on the preview screen');
    }
    console.log('format on arrival:', await checkedSegment(page, formatOptions));

    // Include moved behind the cog. Confirm it is reachable and read its state there.
    await openSyncSettings(page);
    const includePresent = (await segment(page, includeOptions[0]).count()) > 0;
    console.log('include control present in the settings modal:', includePresent);
    if (!includePresent) {
        await shot('include-control-missing');
        throw new Error('Include segmented control not found in the settings modal');
    }
    console.log('include on arrival:', await checkedSegment(page, includeOptions));
    await closeSyncSettings(page);

    // Pin the format, since it persists across runs (see the header note). Serato must
    // be offered on desktop — it is the half of the control the web build cannot have.
    console.log('Serato selectable on desktop:', !(await segment(page, /^serato$/i).isDisabled()));
    await selectSegment(page, /^rekordbox$/i);
    await page.waitForTimeout(300);
    await openSyncSettings(page);
    const includeDefault = await checkedSegment(page, includeOptions);
    console.log('include default under Rekordbox:', includeDefault);
    await closeSyncSettings(page);

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

    // ── XML-only download (switch "Include" to XML only, under the cog) ────
    await openSyncSettings(page);
    await selectSegment(page, /^xml only$/i);
    await closeSyncSettings(page);

    // The button no longer renames itself per mode — one "Download" in all of them,
    // which is the point of the change. What the screen still has to show is *that*
    // it is XML-only, and it does that in a badge beside the format control.
    const bodyAfterXmlOnly = await page
        .locator('body')
        .innerText()
        .catch(() => '');
    console.log('screen shows an "XML only" badge:', /xml only/i.test(bodyAfterXmlOnly));

    const downloadButton = page.getByRole('button', { name: /^download$/i });
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

        // "Include" is still component state, not reset by handleBack ("Start Over")
        // — only step/plan/error/downloadResult are — so the XML-only run above should
        // have left it on "XML only" here. (The real, verified behavior, not a driver
        // bug — see the log/doc note. "Format" persists for a different reason: it is
        // in the app store.) Switch back explicitly to test the tracks+XML combo.
        await openSyncSettings(page);
        const persistedXmlOnly = await segment(page, /^xml only$/i)
            .isChecked()
            .catch(() => false);
        console.log('include persisted on "XML only" from the previous run:', persistedXmlOnly);
        await selectSegment(page, /^tracks \+ xml$/i);
        await closeSyncSettings(page);

        const downloadButton2 = page.getByRole('button', { name: /^download$/i });
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
                desktopDiffTabsPresent: diffTabsPresent,
                formatControlsPresent: controlsPresent,
                // A RegExp serialises to `{}`, and this summary is what the QA journal quotes.
                includeDefault: String(includeDefault),
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
