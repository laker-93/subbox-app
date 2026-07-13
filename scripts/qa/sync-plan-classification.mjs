import fs from 'fs';
import path from 'path';
import { _electron as electron } from 'playwright';

import {
    getCredentials,
    isLoggedOut,
    performLogin,
    resolveAppEntry,
    SNAPSHOT_DIR,
} from '../ui-snapshot-shared.mjs';

// Reusable pass/fail driver for the sync-plan classification path — the seam the
// "false missing-locally" fixes live behind (pymix sync_plan duplicate-subbox_id
// handling + subbox-app scanLocalTracks recursive walk).
//
// It launches the built Electron app, logs in, bootstraps the pymix session the
// way a real user does (one UI "Preview Download"), then calls POST /sync/plan
// directly (in-page fetch, credentials included — same session the renderer uses)
// so it can read the STRUCTURED plan (summary counts + missing/existing lists)
// rather than scraping the UI. Prints a machine-readable RESULT block and, when
// QA_EXPECT_* are set, asserts and exits non-zero on mismatch.
//
// localTracks source:
//   - default: the REAL client scan (sync:get-local-tracks IPC) — exercises
//     subbox-app scanLocalTracks() (change B). Use for fixture-based tests where
//     the on-disk library layout is what's under test.
//   - QA_LOCALTRACKS=<file.json>: a hand-crafted LocalTrack[] payload sent as-is,
//     independent of the on-disk library — exercises pymix sync_plan (change A)
//     deterministically, no local files required.
//
// Env:
//   QA_APP_ENTRY       out/main/index.js to launch (default: this worktree's build)
//   QA_PLAYLIST        playlist name(s), comma-sep (required)
//   QA_LOCALTRACKS     optional path to a JSON LocalTrack[] to send instead of a real scan
//   QA_EXPECT_MISSING  optional int — assert summary.tracksMissing === this
//   QA_EXPECT_PRESENT  optional int — assert summary.tracksAlreadyPresent === this
//   QA_MISSING_LIMIT   how many missing/existing rows to print (default 20)
//
// Usage:
//   cd ../feishin-qa
//   QA_APP_ENTRY=../feishin/out/main/index.js QA_PLAYLIST=Kodzo \
//     node scripts/qa/sync-plan-classification.mjs

const MAIN_ENTRY = resolveAppEntry();
const credentials = getCredentials();
const PYMIX_URL = process.env.QA_PYMIX_URL || 'https://pymix.docker.localhost';
const PLAYLIST_SEL = process.env.QA_PLAYLIST;
const MISSING_LIMIT = Number(process.env.QA_MISSING_LIMIT) || 20;

const expectMissing =
    process.env.QA_EXPECT_MISSING !== undefined ? Number(process.env.QA_EXPECT_MISSING) : null;
const expectPresent =
    process.env.QA_EXPECT_PRESENT !== undefined ? Number(process.env.QA_EXPECT_PRESENT) : null;

if (!PLAYLIST_SEL) {
    console.error('QA_PLAYLIST is required (playlist name, or comma-separated names).');
    process.exit(2);
}

async function main() {
    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });

    const mainLogs = [];
    electronApp.process().stdout.on('data', (d) => mainLogs.push(`[main] ${d}`.trimEnd()));
    electronApp.process().stderr.on('data', (d) => mainLogs.push(`[main:err] ${d}`.trimEnd()));

    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });
    const pageLogs = [];
    page.on('console', (m) => pageLogs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => pageLogs.push(`[pageerror] ${e.message}`));

    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(1000);

    const server = await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('store_authentication')).state.currentServer;
        return { credential: s.credential, id: s.id, url: s.url, username: s.username };
    });
    console.log('server:', server.username, server.id);

    // Playlist name -> id (in-page Subsonic fetch trusts the dev cert).
    const playlists = await page.evaluate(async ({ credential, url }) => {
        const res = await fetch(`${url}/rest/getPlaylists.view?${credential}&v=1.16.1&c=subbox&f=json`);
        const j = await res.json();
        return (j['subsonic-response']?.playlists?.playlist ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            songCount: p.songCount,
        }));
    }, server);

    const wanted = PLAYLIST_SEL.split(',').map((s) => s.trim());
    const chosen = playlists.filter((p) => wanted.includes(p.name));
    if (chosen.length === 0) {
        console.error(
            `no playlist matched "${PLAYLIST_SEL}". Available: ${playlists.map((p) => p.name).join(', ')}`,
        );
        await electronApp.close();
        process.exit(2);
    }
    const playlistIds = chosen.map((p) => p.id);
    console.log('playlists:', chosen.map((p) => `${p.name}(${p.songCount})`).join(', '));

    // Bootstrap the pymix session the way a real user does — run "Preview Download"
    // once through the UI. Without this the renderer's pymix cookie may not be set
    // yet and POST /sync/plan is rejected. (Also validates the real UI path loads.)
    const syncToggle = page.getByText('Sync', { exact: true }).first();
    if (await syncToggle.isVisible().catch(() => false)) {
        await syncToggle.click();
        await page.waitForTimeout(800);
    }
    const downloadTab = page.getByText('Download', { exact: true }).first();
    if (await downloadTab.isVisible().catch(() => false)) {
        await downloadTab.click();
        await page.waitForTimeout(800);
    }
    const firstRow = page.getByText(chosen[0].name, { exact: true }).first();
    if (await firstRow.isVisible().catch(() => false)) {
        await firstRow.click();
        await page.waitForTimeout(300);
    }
    const previewButton = page.getByRole('button', { name: /^preview download$/i });
    if (await previewButton.isEnabled().catch(() => false)) {
        await previewButton.click();
        await page
            .getByText('Generating sync plan', { exact: false })
            .first()
            .waitFor({ state: 'hidden', timeout: 90_000 })
            .catch((e) => console.log('still generating after 90s:', e.message));
        console.log('UI preview complete — pymix session established');
    } else {
        console.log('WARNING: preview button not enabled; session may not bootstrap');
    }

    // Choose the localTracks payload.
    let localTracks;
    let localTracksSource;
    if (process.env.QA_LOCALTRACKS) {
        const p = path.resolve(process.env.QA_LOCALTRACKS);
        localTracks = JSON.parse(fs.readFileSync(p, 'utf8'));
        localTracksSource = `synthetic file ${p} (${localTracks.length} tracks)`;
    } else {
        localTracks = await page.evaluate(() => window.api.ipc.invoke('sync:get-local-tracks'));
        localTracksSource = `real scan via sync:get-local-tracks (${localTracks.length} tracks)`;
    }
    const withId = localTracks.filter((t) => t.subboxId).length;
    console.log(`localTracks: ${localTracksSource}; ${withId} carry a subboxId`);

    // Structured plan via direct POST /sync/plan (same call the renderer makes).
    const plan = await page.evaluate(
        async ({ body, pymixUrl }) => {
            const res = await fetch(`${pymixUrl}/sync/plan`, {
                body: JSON.stringify(body),
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
            const text = await res.text();
            let json;
            try {
                json = JSON.parse(text);
            } catch {
                json = null;
            }
            return { json, ok: res.ok, status: res.status, text: text.slice(0, 500) };
        },
        {
            body: {
                direction: 'download',
                localTracks,
                options: { fuzzyMatch: true, includeMetadata: true },
                playlists: playlistIds.map((id) => ({ id, source: 'subbox' })),
            },
            pymixUrl: PYMIX_URL,
        },
    );

    if (!plan.ok || !plan.json) {
        console.error(`POST /sync/plan failed: status=${plan.status} body=${plan.text}`);
        console.error('--- main logs (tail) ---\n' + mainLogs.slice(-20).join('\n'));
        await electronApp.close();
        process.exit(1);
    }

    // ts-rest wraps the payload; the renderer reads res.body.data. Tolerate both shapes.
    const data = plan.json.data ?? plan.json;
    const { metadata, summary, tracks } = data;

    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const shotPath = path.join(SNAPSHOT_DIR, `qa-sync-plan-${Date.now()}.png`);
    await page.screenshot({ path: shotPath }).catch(() => {});

    console.log('\n=== SYNC PLAN ===');
    console.log(`  playlists requested:   ${summary.playlists}`);
    console.log(`  tracks requested:      ${summary.tracksRequested}`);
    console.log(`  already present:       ${summary.tracksAlreadyPresent}`);
    console.log(`  MISSING (to download): ${summary.tracksMissing}`);
    console.log(`  metadata updates:      ${summary.metadataUpdates}`);
    console.log(`  download size (bytes): ${summary.downloadSizeBytes}`);

    if (tracks.missing.length) {
        console.log(`\n  --- missing (first ${MISSING_LIMIT}) ---`);
        for (const t of tracks.missing.slice(0, MISSING_LIMIT)) {
            console.log(`    MISSING  ${t.artist} — ${t.title}${t.album ? ` [${t.album}]` : ''}`);
        }
    }
    if (process.env.QA_LIST_EXISTING === '1' && tracks.existing.length) {
        console.log(`\n  --- existing (first ${MISSING_LIMIT}) ---`);
        for (const t of tracks.existing.slice(0, MISSING_LIMIT)) {
            console.log(`    PRESENT  ${t.artist} — ${t.title}${t.album ? ` [${t.album}]` : ''}`);
        }
    }

    // Assertions.
    const checks = [];
    if (expectMissing !== null) {
        checks.push({
            got: summary.tracksMissing,
            label: `tracksMissing === ${expectMissing}`,
            pass: summary.tracksMissing === expectMissing,
        });
    }
    if (expectPresent !== null) {
        checks.push({
            got: summary.tracksAlreadyPresent,
            label: `tracksAlreadyPresent === ${expectPresent}`,
            pass: summary.tracksAlreadyPresent === expectPresent,
        });
    }

    let overall = true;
    if (checks.length) {
        console.log('\n=== RESULT ===');
        for (const c of checks) {
            console.log(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.label} (got ${c.got})`);
            overall = overall && c.pass;
        }
        console.log(`\nOVERALL: ${overall ? 'PASS' : 'FAIL'}`);
    } else {
        console.log('\n(no QA_EXPECT_* assertions set — report-only run)');
    }

    const errLogs = pageLogs.filter((m) => /error|warn/i.test(m));
    if (errLogs.length) {
        console.log('\n--- renderer console errors/warnings ---');
        console.log(errLogs.join('\n'));
    }
    console.log('\nscreenshot:', shotPath);

    await electronApp.close();
    process.exit(checks.length && !overall ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
