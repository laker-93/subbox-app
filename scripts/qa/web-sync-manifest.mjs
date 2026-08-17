import path from 'path';
import { chromium } from 'playwright';

import { getCredentials, performLogin, SNAPSHOT_DIR } from '../ui-snapshot-shared.mjs';

// Regression driver for the rebuilt Sync -> Download screen's WEB branch
// (subbox-app #101/#102/#103), against `pnpm dev:web` (port 4343) — the only
// origin in pymix's CORS allowlist for local dev (see sync.md's "Download side,
// WEB build" section). Desktop's tick-box/diff behaviour is already covered by
// sync-download-tickboxes.mjs; this is the web-only manifest view + `user_root`
// `music` segment + one-zip-with-tick-boxes behaviour, never driven since the
// #101/#102/#103 rebuild superseded the pre-rebuild web-sync-download-zip.mjs.
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
    await page.getByRole('button', { name: /^Download$/ }).click();

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
    const includeTracksBox = page.getByRole('checkbox', { name: /include tracks/i });
    const includeXmlBox = page.getByRole('checkbox', { name: /include rekordbox xml/i });
    await includeTracksBox.waitFor({ timeout: 20_000 });

    const bothPresent =
        (await includeTracksBox.isVisible().catch(() => false)) &&
        (await includeXmlBox.isVisible().catch(() => false));
    const tracksCheckedInitially = await includeTracksBox.isChecked().catch(() => null);
    const xmlCheckedInitially = await includeXmlBox.isChecked().catch(() => null);
    console.log('both tick-boxes present:', bothPresent);
    console.log(
        'default state - includeTracks:',
        tracksCheckedInitially,
        'includeXml:',
        xmlCheckedInitially,
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

    // ── Web-only extraction-path field, required when XML is ticked ────────
    const extractPathInput = page.getByPlaceholder(/Users\/you\/(Desktop|Music)/i);
    const extractPathVisible = await extractPathInput.isVisible().catch(() => false);
    console.log('web extraction-path field present:', extractPathVisible);
    if (extractPathVisible) {
        await extractPathInput.fill('/tmp/qa-web-sync-manifest');
        await page.waitForTimeout(300);
    }

    // ── XML-only download (untick "Include tracks") ─────────────────────────
    await includeTracksBox.uncheck();
    await page.waitForTimeout(300);
    const downloadButton = page.getByRole('button', {
        name: /download rekordbox xml|download zip/i,
    });
    const xmlOnlyLabel = await downloadButton.textContent().catch(() => null);
    console.log('download button label with tracks unticked:', xmlOnlyLabel);
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
        await includeTracksBox.waitFor({ timeout: 20_000 });

        // includeTracks/includeRekordboxXml are plain state, not reset by "Start
        // Over" (confirmed on desktop 2026-08-14) — expect it's still unticked here.
        const persistedUnchecked = !(await includeTracksBox.isChecked().catch(() => true));
        console.log('includeTracks persisted unticked from the XML-only run:', persistedUnchecked);
        if (persistedUnchecked) {
            await includeTracksBox.check();
            await page.waitForTimeout(300);
        }
        const extractPathInput2 = page.getByPlaceholder(/Users\/you\/(Desktop|Music)/i);
        if (await extractPathInput2.isVisible().catch(() => false)) {
            const currentVal = await extractPathInput2.inputValue().catch(() => '');
            if (!currentVal) await extractPathInput2.fill('/tmp/qa-web-sync-manifest');
            await page.waitForTimeout(300);
        }

        const downloadButton2 = page.getByRole('button', { name: /download zip/i });
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
                bothTickboxesPresent: bothPresent,
                extractPathVisible,
                noDiffUi,
                pymixResponses,
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
        bothPresent &&
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
