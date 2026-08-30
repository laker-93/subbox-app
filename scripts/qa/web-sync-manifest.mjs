import path from 'path';
import { chromium } from 'playwright';

import {
    checkedSegment,
    closeSyncSettings,
    getCredentials,
    openSyncSettings,
    performLogin,
    segment,
    selectSegment,
    SNAPSHOT_DIR,
} from '../ui-snapshot-shared.mjs';

// The Sync tab strip has a "Download" button too, and the primary action on the
// preview screen is now called plain "Download" in every mode. The tab strip is
// rendered above the panel, so the action is always the later of the two.
const primaryDownload = (page) => page.getByRole('button', { name: /^Download$/ }).last();

// Regression driver for the rebuilt Sync -> Download screen's WEB branch
// (subbox-app #101/#102/#103), against `pnpm dev:web` (port 4343) — the only
// origin in pymix's CORS allowlist for local dev (see sync.md's "Download side,
// WEB build" section). Desktop's tick-box/diff behaviour is already covered by
// sync-download-tickboxes.mjs; this is the web-only manifest view + `user_root`
// `music` segment + one-zip-with-tick-boxes behaviour, never driven since the
// #101/#102/#103 rebuild superseded the pre-rebuild web-sync-download-zip.mjs.
//
// Updated for the sync-ui substrate work: the tick-boxes are now "Format" and
// "Include" segmented controls. Web is the surface where the format choice is
// constrained — Serato writes crates onto a filesystem a browser cannot reach, so
// the option is present-but-disabled and the format is pinned to Rekordbox. That
// means "tracks with no XML" is not expressible on web at all; every web download
// carries the XML. This driver asserts that pin rather than assuming it.
//
// Usage: node scripts/qa/web-sync-manifest.mjs
// Env: QA_PLAYLIST (default "Downtempo", 9 tracks on test060826)

const APP_URL = process.env.UI_SNAPSHOT_APP_URL || 'http://localhost:4343';
const targetPlaylist = process.env.QA_PLAYLIST || 'Downtempo';
const shot = (name) => path.join(SNAPSHOT_DIR, `web-sync-manifest-${name}-${Date.now()}.png`);

async function main() {
    const credentials = getCredentials();
    const browser = await chromium.launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    const pymixResponses = [];
    page.on('response', (res) => {
        const url = res.url();
        if (url.includes('/sync/plan') || url.includes('/sync/playlists')) {
            pymixResponses.push({ status: res.status(), url });
            console.log(`[driver] pymix response: ${res.status()} ${url}`);
        }
    });
    page.on('console', (m) => {
        const t = m.text();
        if (/error|fail/i.test(t)) console.log(`[renderer:${m.type()}] ${t}`);
    });

    await page.goto(APP_URL);
    await page.getByRole('button', { name: /^login$/i }).waitFor({ timeout: 20_000 });
    await performLogin(page, credentials);

    await page.getByText('Sync', { exact: true }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /^Download$/ }).first().click();

    await page.getByText(targetPlaylist, { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.getByText(targetPlaylist, { exact: true }).first().click();
    await page.screenshot({ path: shot('01-selected') });

    const previewBtn = page.getByRole('button', { name: /^Preview Download$/ });
    if (await previewBtn.isDisabled()) {
        console.error('[driver] Preview Download disabled. Aborting.');
        await browser.close();
        process.exit(2);
    }
    await previewBtn.click();

    // ── Manifest checks (web has no diff, just what's in the file) ─────────
    // "Include" moved behind the settings cog in the de-clutter pass; "Format" is
    // still the one control on the screen itself.
    const includeOptions = [/^tracks \+ xml$/i, /^xml only$/i];
    await segment(page, /^rekordbox$/i).waitFor({ state: 'attached', timeout: 20_000 });

    await openSyncSettings(page);
    const includeTracksSeg = segment(page, includeOptions[0]);
    const controlsPresent =
        (await segment(page, /^rekordbox$/i).count()) > 0 &&
        (await includeTracksSeg.count()) > 0;
    console.log('format control on screen + include control under the cog:', controlsPresent);
    console.log('include on arrival:', await checkedSegment(page, includeOptions));
    await closeSyncSettings(page);

    // The web pin: Serato offered but disabled, Rekordbox selected and unchangeable.
    const seratoDisabled = await segment(page, /^serato$/i).isDisabled().catch(() => null);
    const rekordboxPinned = await segment(page, /^rekordbox$/i).isChecked().catch(() => null);
    console.log('Serato disabled on web:', seratoDisabled, '| Rekordbox pinned:', rekordboxPinned);
    const bodyTextFormat = await page.locator('body').innerText().catch(() => '');
    console.log(
        'reason for the disabled option is on screen:',
        /need the desktop app/i.test(bodyTextFormat),
    );

    // No diff tabs/badges on web — "Missing (N)" etc. must NOT be present.
    const missingTab = page.getByRole('button', { name: /^missing \(\d+\)$/i });
    const alreadyPresentBadge = page.getByText(/already present$/i);
    const noDiffUi =
        !(await missingTab.isVisible().catch(() => false)) &&
        !(await alreadyPresentBadge.isVisible().catch(() => false));
    console.log('no desktop-style diff tabs/badges present (expected on web):', noDiffUi);

    const bodyTextPreview = await page.locator('body').innerText().catch(() => '');
    const sizeMatch = bodyTextPreview.match(/([\d.]+ ?(?:B|KB|MB|GB)) download/i);
    console.log('download-size badge:', sizeMatch?.[1] ?? '(not found)');
    console.log(
        'manifest list caption present:',
        /tracks in this download|tracks covered by the rekordbox xml/i.test(bodyTextPreview),
    );
    await page.screenshot({ path: shot('02-manifest') });

    // ── Web-only extraction-path field (in the settings modal), required when
    //    the XML is being produced. Set it and switch Include in the same visit.
    await openSyncSettings(page);
    const extractPathInput = page.getByPlaceholder(/Users\/you\/(Desktop|Music)/i);
    const extractPathVisible = await extractPathInput.isVisible().catch(() => false);
    console.log('web extraction-path field present in settings:', extractPathVisible);
    if (extractPathVisible) {
        await extractPathInput.fill('/tmp/qa-web-sync-manifest');
        await page.waitForTimeout(300);
    }

    // ── XML-only download (switch "Include" to XML only) ────────────────────
    await selectSegment(page, /^xml only$/i);
    await closeSyncSettings(page);

    // The button is a plain "Download" in every mode now; the screen carries the
    // mode in a badge instead.
    const bodyAfterXmlOnly = await page.locator('body').innerText().catch(() => '');
    console.log('screen shows an "XML only" badge:', /xml only/i.test(bodyAfterXmlOnly));
    const downloadButton = primaryDownload(page);
    const xmlOnlyEnabled = await downloadButton.isEnabled().catch(() => false);
    console.log('XML-only download button enabled:', xmlOnlyEnabled);

    let xmlOnlyOutcome = 'skipped (button disabled)';
    if (xmlOnlyEnabled) {
        const downloadEventPromise = page
            .waitForEvent('download', { timeout: 30_000 })
            .catch(() => null);
        await downloadButton.click();
        xmlOnlyOutcome = await Promise.race([
            downloadEventPromise.then((d) => (d ? `done:${d.suggestedFilename()}` : 'no-event')),
            page
                .getByText(/download failed|too old to include/i)
                .first()
                .waitFor({ timeout: 30_000 })
                .then(() => 'error'),
        ]).catch(() => 'hang');
        console.log('XML-only download outcome:', xmlOnlyOutcome);
        await page.waitForTimeout(1000);
        await page.screenshot({ path: shot('03-xml-only-done') });
    }

    // ── Back to select, re-run with both ticked (tracks + XML zip) ─────────
    const startOver = page.getByRole('button', { name: /^start over$/i });
    let tracksAndXmlOutcome = 'skipped';
    if (await startOver.isVisible().catch(() => false)) {
        await startOver.click();
        await page.waitForTimeout(800);

        // The playlist list re-fetches/remounts right after "Start Over" (a fresh
        // plan invalidates queries) — retry the click until it actually registers
        // (Preview Download becomes enabled), same gotcha as the desktop driver.
        for (let attempt = 0; attempt < 5; attempt++) {
            if (await previewBtn.isEnabled().catch(() => false)) break;
            await page.getByText(targetPlaylist, { exact: true }).first().click({ force: true });
            await page.waitForTimeout(500);
        }
        console.log('preview button enabled after retry loop:', await previewBtn.isEnabled().catch(() => false));
        await previewBtn.click();
        await segment(page, /^rekordbox$/i).waitFor({ state: 'attached', timeout: 20_000 });

        await openSyncSettings(page);
        // "Include" is plain component state, not reset by "Start Over" (confirmed on
        // desktop 2026-08-14) — expect it's still on "XML only" here.
        const persistedXmlOnly = await segment(page, /^xml only$/i).isChecked().catch(() => false);
        console.log('include persisted on "XML only" from the previous run:', persistedXmlOnly);
        await selectSegment(page, /^tracks \+ xml$/i);
        const extractPathInput2 = page.getByPlaceholder(/Users\/you\/(Desktop|Music)/i);
        if (await extractPathInput2.isVisible().catch(() => false)) {
            const currentVal = await extractPathInput2.inputValue().catch(() => '');
            if (!currentVal) await extractPathInput2.fill('/tmp/qa-web-sync-manifest');
            await page.waitForTimeout(300);
        }
        await closeSyncSettings(page);

        const downloadButton2 = primaryDownload(page);
        if (await downloadButton2.isEnabled().catch(() => false)) {
            const downloadEventPromise2 = page
                .waitForEvent('download', { timeout: 60_000 })
                .catch(() => null);
            await downloadButton2.click();
            tracksAndXmlOutcome = await Promise.race([
                downloadEventPromise2.then((d) =>
                    d ? `done:${d.suggestedFilename()}` : 'no-event',
                ),
                page
                    .getByText(/download failed|too old to include/i)
                    .first()
                    .waitFor({ timeout: 60_000 })
                    .then(() => 'error'),
            ]).catch(() => 'hang');
            console.log('tracks+XML download outcome:', tracksAndXmlOutcome);
            await page.waitForTimeout(1000);
            await page.screenshot({ path: shot('04-tracks-and-xml-done') });
        } else {
            console.log('tracks+XML download button not enabled');
        }
    }

    console.log('--- SUMMARY ---');
    console.log(
        JSON.stringify(
            {
                extractPathVisible,
                formatControlsPresent: controlsPresent,
                noDiffUi,
                pymixResponses,
                rekordboxPinned,
                seratoDisabled,
                tracksAndXmlOutcome,
                xmlOnlyOutcome,
            },
            null,
            2,
        ),
    );

    await browser.close();

    const badResponse = pymixResponses.some((r) => r.status !== 200);
    const ok =
        controlsPresent &&
        seratoDisabled === true &&
        rekordboxPinned === true &&
        noDiffUi &&
        !badResponse &&
        xmlOnlyOutcome.startsWith('done') &&
        tracksAndXmlOutcome.startsWith('done');
    process.exit(ok ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(3);
});
