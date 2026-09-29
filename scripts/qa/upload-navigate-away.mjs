import { execFileSync } from 'child_process';
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

// subbox-app#195: an upload has to survive the user leaving Sync -> Upload.
//
// Starts a Rekordbox upload, leaves for the Library side at a chosen point, stays
// away, comes back to Upload and records what the user sees. Alongside the screen it
// records what the run actually left behind — the pymix jobs it started, the files
// in the user's uploads/ and the playlists in Navidrome — so a lost UI and a lost
// upload can be told apart.
//
//   1. Sync -> Upload -> Rekordbox -> Select XML File (the dialog is stubbed in the
//      main process to resolve to QA_XML_PATH) -> Preview -> Upload
//   2. Wait for QA_LEAVE_AT, then switch the mode toggle to Library and open Tracks
//   3. Stay away: QA_AWAY=brief (QA_AWAY_MS) or QA_AWAY=until-done (until the
//      pymix job this run started has finished, as the DB records it)
//   4. Toggle back to Sync -> Upload and classify the screen
//   5. Wait for the run to end on screen, then check the sidebar for the XML's
//      playlists without a reload
//
// PASS means: on return the run's screen is showing (not the idle one); if we were
// away when the job finished, its toast appeared while away; the result screen
// appears; the playlists are in the sidebar without a reload; and exactly one
// import job was started. Anything else prints FAIL with the reason.
//
// Local dev stack only: it uploads into a real per-user container. Point it at a
// disposable account (UI_SNAPSHOT_USERNAME / UI_SNAPSHOT_PASSWORD) with an empty
// library, or match_tracks will skip the tracks as already uploaded.
//
// Env:
//   QA_XML_PATH       REQUIRED. A self-contained Rekordbox XML (real audio at its
//                     Location paths). Copy the audio somewhere disposable first:
//                     the upload tags the local files.
//   QA_LEAVE_AT       uploading (default) | mapping | importing
//   QA_AWAY           brief (default) | until-done
//   QA_AWAY_MS        How long a brief absence lasts (default 4000).
//   QA_METADATA_ONLY  1 to tick "Import metadata only". Use with QA_LEAVE_AT=importing.
//   QA_PLAYLIST       A top-level playlist or folder the XML creates, looked for in
//                     the sidebar (a playlist inside a collapsed folder isn't shown).
//   QA_USERNAME_DIR   The filebrowser user dir to list (default: the login username).
//   QA_APP_ENTRY      out/main/index.js to launch (default: this worktree's build).
//   QA_TIMEOUT_MS     Cap on the whole run after clicking Upload (default 300000).

const MAIN_ENTRY = resolveAppEntry();
const XML_PATH = process.env.QA_XML_PATH;
const LEAVE_AT = process.env.QA_LEAVE_AT || 'uploading';
const AWAY = process.env.QA_AWAY || 'brief';
const AWAY_MS = Number(process.env.QA_AWAY_MS) || 4000;
const METADATA_ONLY = process.env.QA_METADATA_ONLY === '1';
const PLAYLIST = process.env.QA_PLAYLIST || null;
const TIMEOUT_MS = Number(process.env.QA_TIMEOUT_MS) || 300_000;

if (!XML_PATH || !fs.existsSync(XML_PATH)) {
    throw new Error(`QA_XML_PATH must point at an existing file (got: ${XML_PATH})`);
}
if (!['importing', 'mapping', 'uploading'].includes(LEAVE_AT)) {
    throw new Error(`QA_LEAVE_AT must be uploading, mapping or importing (got: ${LEAVE_AT})`);
}

const credentials = getCredentials();
const USER_DIR = process.env.QA_USERNAME_DIR || credentials.username;

// What each point looks like on screen. `mapping` is the last thing
// sync:upload-from-xml reports before it resolves, so leaving then means the
// rbImport call is made while the user is away.
const LEAVE_TEXT = {
    importing:
        /importing into library|applying cue points|linking tracks to your library|finishing up/i,
    mapping: /mapping metadata/i,
    uploading: /uploading tracks \(/i,
};

const IMPORT_TOAST = /imported \d+ tracks|library updated|your crates are now playlists/i;
const FAILURE_TEXT = /import failed|upload failed|failed to check import progress/i;

/** What the Upload screen is showing, in the terms of the flow's steps. */
async function classifyUploadScreen(page) {
    if (await visible(page, /select xml file/i)) return 'idle';
    if (await visible(page, /preview changes/i)) return 'preview';
    if (await visible(page, /upload complete|uploaded, with problems/i)) return 'done';
    // "Imported, with problems" is the failed-job screen when the tracks landed and a
    // later pass broke; "Uploaded, with problems" (above) is a finished run.
    if ((await visible(page, FAILURE_TEXT)) || (await visible(page, /imported, with problems/i)))
        return 'failed';
    if (await visible(page, LEAVE_TEXT.importing)) return 'importing';
    if (await visible(page, /uploading tracks|mapping metadata|matching tracks|starting/i))
        return 'uploading';
    return 'unknown';
}

/** Record any import toast on screen. Matched against the page text rather than a
 *  locator, since a toast and the Upload screen can say the same words. */
async function collectToasts(page, into) {
    const notes = await page
        .locator('.mantine-Notification-root, [role="alert"]')
        .allInnerTexts()
        .catch(() => []);
    for (const note of notes) {
        const text = note.replace(/\s+/g, ' ').trim();
        if ((IMPORT_TOAST.test(text) || FAILURE_TEXT.test(text)) && !into.includes(text)) {
            into.push(text);
        }
    }
}

/** A playlist or folder name showing in the sidebar. A playlist inside a collapsed
 *  folder isn't, so name a top-level node. */
async function inSidebar(page, name) {
    return (
        (await page
            .getByText(name, { exact: true })
            .filter({ visible: true })
            .count()
            .catch(() => 0)) > 0
    );
}

/** The import jobs this app started. pymix's job table has no user column, and
 *  other sessions start jobs on the same dev stack, so the ids come from the app's
 *  own /rekordbox/import and /serato/import responses. */
function jobsFor(jobIds) {
    if (jobIds.length === 0) return [];
    const list = jobIds.map((id) => `'${id.replace(/[^0-9a-f]/gi, '')}'`).join(',');
    const rows = psql(
        `SELECT id, name, in_progress, result, coalesce(reason, '') FROM job_table WHERE job_id IN (${list}) ORDER BY id`,
    );
    return rows
        ? rows.split('\n').map((line) => {
              const [id, name, inProgress, result, reason] = line.split('|');
              return { id: Number(id), inProgress: inProgress === 't', name, reason, result };
          })
        : [];
}

function listUploads() {
    try {
        return execFileSync(
            'docker',
            ['exec', 'filebrowser', 'find', `/data/users/${USER_DIR}/uploads`, '-type', 'f'],
            { encoding: 'utf8' },
        )
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((f) => f.replace(`/data/users/${USER_DIR}/uploads/`, ''));
    } catch (err) {
        return [`(could not list: ${err.message.split('\n')[0]})`];
    }
}

async function main() {
    console.log('app entry:', MAIN_ENTRY);
    console.log(`xml: ${XML_PATH}`);
    console.log(
        `leave at: ${LEAVE_AT}, away: ${AWAY}${AWAY === 'brief' ? ` (${AWAY_MS}ms)` : ''}, metadata only: ${METADATA_ONLY}`,
    );

    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
    });
    const mainLogs = [];
    electronApp.process().stdout.on('data', (d) => mainLogs.push(`[main] ${d}`.trimEnd()));
    electronApp.process().stderr.on('data', (d) => mainLogs.push(`[main:err] ${d}`.trimEnd()));

    await electronApp.evaluate(async ({ dialog }, xmlPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [xmlPath] });
    }, XML_PATH);

    const page = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });
    const pageLogs = [];
    page.on('console', (m) => pageLogs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => pageLogs.push(`[pageerror] ${e.message}`));
    const jobIds = [];
    page.on('response', async (res) => {
        if (res.request().method() !== 'POST') return;
        if (!/\/(rekordbox|serato)\/import(\?|$)/.test(new URL(res.url()).pathname)) return;
        const body = await res.json().catch(() => null);
        if (body?.job_id) jobIds.push(body.job_id);
    });

    await page.waitForLoadState('networkidle');
    await forceFreshLogin(page);
    await page.waitForLoadState('networkidle');
    if (await isLoggedOut(page)) await performLogin(page, credentials);
    await page.waitForTimeout(1000);

    await openUpload(page);
    await selectSegment(page, /^rekordbox$/i);
    await page
        .getByRole('button', { name: /select xml file/i })
        .first()
        .click();
    await page
        .getByText(/preview changes/i)
        .first()
        .waitFor({ timeout: 15_000 });
    if (METADATA_ONLY) {
        await page
            .getByText(/import metadata only/i)
            .first()
            .click();
    }

    const uploadsBefore = listUploads();
    await page
        .getByRole('button', { name: /^upload$/i })
        .last()
        .click();
    const startedAt = Date.now();
    const deadline = startedAt + TIMEOUT_MS;
    console.log('clicked Upload');

    // ── Wait for the point to leave at ────────────────────────────────────
    while (!(await visible(page, LEAVE_TEXT[LEAVE_AT]))) {
        if (Date.now() > deadline) throw new Error(`never saw the ${LEAVE_AT} screen`);
        if (await visible(page, FAILURE_TEXT)) throw new Error('run failed before the leave point');
        await page.waitForTimeout(100);
    }
    const leftAfterMs = Date.now() - startedAt;
    console.log(`at ${LEAVE_AT} after ${leftAfterMs}ms — leaving for Library`);

    // ── Away ──────────────────────────────────────────────────────────────
    await selectSegment(page, /^library$/i);
    await page
        .getByRole('link', { name: /^tracks$/i })
        .first()
        .click()
        .catch(() => {});
    const toastsWhileAway = [];
    const awayUntil = Date.now() + AWAY_MS;
    let jobDoneWhileAway = false;
    while (Date.now() < deadline) {
        await collectToasts(page, toastsWhileAway);
        if (AWAY === 'brief' && Date.now() >= awayUntil) break;
        if (AWAY === 'until-done') {
            const importJobs = jobsFor(jobIds);
            if (importJobs.length > 0 && importJobs.every((j) => !j.inProgress)) {
                jobDoneWhileAway = true;
                // Give the client its poll interval (3s) plus slack to notice.
                const noticeBy = Date.now() + 8000;
                while (Date.now() < noticeBy) {
                    await collectToasts(page, toastsWhileAway);
                    await page.waitForTimeout(250);
                }
                break;
            }
        }
        await page.waitForTimeout(250);
    }
    const sidebarWhileAway = PLAYLIST ? await inSidebar(page, PLAYLIST) : null;
    const awayShot = path.join(SNAPSHOT_DIR, `upload-navigate-away-away-${Date.now()}.png`);
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    await page.screenshot({ path: awayShot }).catch(() => {});

    // ── Back to Upload ────────────────────────────────────────────────────
    await openUpload(page);
    const screenOnReturn = await classifyUploadScreen(page);
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const returnShot = path.join(SNAPSHOT_DIR, `upload-navigate-away-return-${Date.now()}.png`);
    await page.screenshot({ path: returnShot }).catch(() => {});
    console.log(`screen on return: ${screenOnReturn}`);

    // ── Let it finish on screen (if it can) ───────────────────────────────
    let finalScreen = screenOnReturn;
    while (!['done', 'failed', 'idle', 'preview'].includes(finalScreen) && Date.now() < deadline) {
        await page.waitForTimeout(1000);
        finalScreen = await classifyUploadScreen(page);
    }
    // A run the UI lost still runs on the server; wait for its jobs so the record
    // below is of how it ended, not a snapshot mid-way.
    while (Date.now() < deadline) {
        const jobs = jobsFor(jobIds);
        if (jobs.length > 0 && jobs.every((j) => !j.inProgress)) break;
        if (jobs.length === 0 && Date.now() - startedAt > 60_000) break;
        await page.waitForTimeout(2000);
    }
    const finalShot = path.join(SNAPSHOT_DIR, `upload-navigate-away-final-${Date.now()}.png`);
    await page.screenshot({ path: finalShot }).catch(() => {});
    const finalText = (
        await page
            .locator('body')
            .innerText()
            .catch(() => '')
    )
        .replace(/\s+/g, ' ')
        .slice(0, 400);

    let sidebarAfter = null;
    if (PLAYLIST) {
        await selectSegment(page, /^library$/i);
        await page.waitForTimeout(3000);
        sidebarAfter = await inSidebar(page, PLAYLIST);
    }

    const jobs = jobsFor(jobIds);
    const uploadsAfter = listUploads();

    console.log('\n--- record ---');
    console.log(
        JSON.stringify(
            {
                finalScreen,
                finalText,
                jobDoneWhileAway,
                jobs,
                leaveAt: LEAVE_AT,
                leftAfterMs,
                screenOnReturn,
                screenshots: [awayShot, returnShot, finalShot],
                sidebarAfter,
                sidebarWhileAway,
                toastsWhileAway,
                uploadsAfter: uploadsAfter.length,
                uploadsBefore: uploadsBefore.length,
            },
            null,
            2,
        ),
    );
    console.log('\n--- renderer errors ---');
    console.log(
        pageLogs
            .filter((l) => /error|unmounted|fail/i.test(l))
            .slice(-20)
            .join('\n') || '(none)',
    );

    await electronApp.close();

    const failures = [];
    if (screenOnReturn === 'idle' || screenOnReturn === 'unknown')
        failures.push(`returned to a ${screenOnReturn} screen, not the run`);
    if (jobDoneWhileAway && toastsWhileAway.length === 0)
        failures.push('the job finished while away and no toast appeared');
    if (finalScreen !== 'done') failures.push(`final screen was ${finalScreen}, not done`);
    if (jobs.length !== 1) failures.push(`${jobs.length} jobs started, expected 1`);
    if (jobs.some((j) => j.result !== 't')) failures.push('a job did not succeed');
    if (PLAYLIST && !sidebarAfter)
        failures.push(`"${PLAYLIST}" not in the sidebar without a reload`);

    console.log(failures.length ? `\nFAIL\n  ${failures.join('\n  ')}` : '\nPASS');
    process.exit(failures.length ? 1 : 0);
}

async function openUpload(page) {
    await selectSegment(page, /^sync$/i);
    await page
        .getByRole('button', { name: /^upload$/i })
        .first()
        .click();
    await page.waitForTimeout(500);
}

function psql(sql) {
    return execFileSync(
        'docker',
        ['exec', 'pymix-postgres', 'psql', '-U', 'pymix', '-d', 'pymix', '-tAc', sql],
        { encoding: 'utf8' },
    ).trim();
}

/** Click a Mantine SegmentedControl option through its label (the radio itself is
 *  0x0 and never actionable). */
async function selectSegment(page, name) {
    const radio = page.getByRole('radio', { name });
    await radio.waitFor({ state: 'attached', timeout: 15_000 });
    if (await radio.isChecked()) return;
    const id = await radio.getAttribute('id');
    await page.locator(`label[for="${id}"]`).click();
    for (let i = 0; i < 20; i++) {
        if (await radio.isChecked()) return;
        await page.waitForTimeout(100);
    }
    throw new Error(`segment ${name} never became selected`);
}

async function visible(page, re) {
    return page
        .getByText(re)
        .first()
        .isVisible()
        .catch(() => false);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
