import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium, _electron as electron } from 'playwright';

import {
    forceFreshLogin,
    getCredentials,
    performLogin,
    resolveAppEntry,
    SNAPSHOT_DIR,
} from '../ui-snapshot-shared.mjs';

// Regression driver for the drag-and-drop upload (laker-93/subbox-app#293) in the
// WEB build, against `pnpm dev:web` (port 4343, the origin pymix's CORS allows in
// dev). Desktop renders the same component under the Watch tab.
//
// It makes its own fixtures — short sine tones with titles no library already has —
// so a run proves new tracks arrived rather than finding old ones:
//   two MP3s and a FLAC, dropped (a synthetic DataTransfer, the way a real drop
//   reaches the handler), plus a .txt that must be listed as skipped.
// Then it waits for the dropzone to say the tracks are in the library, and checks
// that independently, over the Subsonic API: each title is found, and each carries
// a subboxid tag.
//
// It writes three tracks into the account's library. Use a disposable dev user.
//
// QA_TARGET=desktop runs the same checks in the Electron app instead, where the
// dropzone sits under the Watch tab. It needs a development-mode build
// (`npx electron-vite build --mode development`); a production one hangs at login.
//
// Usage: node scripts/qa/dropzone-upload.mjs
// Env:   UI_SNAPSHOT_USERNAME / UI_SNAPSHOT_PASSWORD (.env.ui-snapshot.local)
//        QA_NAVIDROME_URL  the account's Navidrome, for the Subsonic check
//                          (default: the server URL the app logged in to)
//        QA_IMPORT_TIMEOUT_MS (default 600000)
//        QA_TARGET=desktop, QA_APP_ENTRY (default out/main/index.js)
//        QA_DROP_BROKEN=1  also drop an .mp3 that is only noise, which uploads but can
//                          never import, and require the dropzone to say so. Adds the
//                          run's give-up wait (5 min) to the run.

const APP_URL = process.env.UI_SNAPSHOT_APP_URL || 'http://localhost:4343';
const DESKTOP = process.env.QA_TARGET === 'desktop';
const DROP_BROKEN = process.env.QA_DROP_BROKEN === '1';
const IMPORT_TIMEOUT_MS = Number(process.env.QA_IMPORT_TIMEOUT_MS || 600_000);
const stamp = Date.now().toString(36);
const shot = (name) =>
    path.join(SNAPSHOT_DIR, `dropzone-upload-${DESKTOP ? 'desktop' : 'web'}-${name}-${stamp}.png`);

const makeFixtures = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-dropzone-'));
    const tracks = [
        { ext: 'mp3', freq: 440, title: `Dropzone QA ${stamp} One` },
        { ext: 'mp3', freq: 550, title: `Dropzone QA ${stamp} Two` },
        { ext: 'flac', freq: 660, title: `Dropzone QA ${stamp} Three` },
    ];
    for (const t of tracks) {
        t.file = path.join(dir, `${t.title}.${t.ext}`);
        execFileSync('ffmpeg', [
            '-loglevel',
            'error',
            '-f',
            'lavfi',
            '-i',
            `sine=frequency=${t.freq}:duration=6`,
            '-metadata',
            `title=${t.title}`,
            '-metadata',
            'artist=Subbox QA',
            '-metadata',
            `album=Dropzone QA ${stamp}`,
            t.file,
        ]);
    }
    const junk = path.join(dir, 'notes.txt');
    fs.writeFileSync(junk, 'not audio');
    const broken = path.join(dir, `Dropzone QA ${stamp} Broken.mp3`);
    fs.writeFileSync(broken, Buffer.alloc(64 * 1024, 0x5a));
    return { broken, junk, tracks };
};

/** Drops files the way a real drop arrives: a `drop` event carrying a DataTransfer. */
const dropFiles = async (page, files) => {
    const payload = files.map((f) => ({
        b64: fs.readFileSync(f).toString('base64'),
        name: path.basename(f),
    }));
    await page.locator('[data-testid="sync-dropzone"]').evaluate((el, items) => {
        const dt = new DataTransfer();
        for (const { b64, name } of items) {
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            dt.items.add(new File([bytes], name));
        }
        el.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
        el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    }, payload);
};

// From inside the page: Chromium resolves *.docker.localhost and accepts the dev
// certificate, where Node's fetch does neither, and the app's own origin is one
// Navidrome already answers.
const subsonic = (page, base, creds, endpoint, params) =>
    page.evaluate(
        async ({ base, endpoint, qs }) => {
            const res = await fetch(`${base}/rest/${endpoint}?${qs}`);
            return (await res.json())['subsonic-response'];
        },
        {
            base,
            endpoint,
            qs: new URLSearchParams({
                c: 'qa',
                f: 'json',
                p: creds.password,
                u: creds.username,
                v: '1.16.1',
                ...params,
            }).toString(),
        },
    );

async function main() {
    const credentials = getCredentials();
    const { broken, junk, tracks } = makeFixtures();
    console.log('[driver] fixtures:', tracks.map((t) => path.basename(t.file)).join(', '));

    let close;
    let page;
    if (DESKTOP) {
        const app = await electron.launch({
            args: [resolveAppEntry()],
            env: { ...process.env, DISABLE_AUTO_UPDATES: '1', NODE_ENV: 'development' },
        });
        close = () => app.close();
        page = await app.firstWindow();
    } else {
        const browser = await chromium.launch();
        close = () => browser.close();
        page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
    }
    page.on('console', (m) => {
        if (/drop-upload|error/i.test(m.text())) console.log(`[renderer:${m.type()}] ${m.text()}`);
    });
    page.on('response', (res) => {
        if (/api\/resources\/watch/.test(res.url()) && res.request().method() === 'POST') {
            console.log(`[driver] filebrowser ${res.status()} ${decodeURIComponent(res.url())}`);
        }
    });

    let ok = true;
    const check = (label, pass) => {
        console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`);
        ok &&= pass;
    };

    try {
        if (DESKTOP) {
            // The app keeps the last run's session, possibly another account's.
            await page.waitForLoadState('domcontentloaded');
            await forceFreshLogin(page);
        } else {
            await page.goto(APP_URL);
        }
        await page.getByRole('button', { name: /^login$/i }).waitFor({ timeout: 30_000 });
        await performLogin(page, credentials);
        const navidromeUrl =
            process.env.QA_NAVIDROME_URL ||
            (await page.evaluate(
                () =>
                    JSON.parse(localStorage.getItem('store_authentication'))?.state?.currentServer
                        ?.url,
            ));
        console.log('[driver] Navidrome:', navidromeUrl);
        await page.getByText('Sync', { exact: true }).first().click();
        await page.getByRole('button', { name: DESKTOP ? /^Watch$/ : /^Add Files$/ }).click();
        const zone = page.locator('[data-testid="sync-dropzone"]');
        await zone.waitFor({ timeout: 15_000 });
        check(`dropzone is on the ${DESKTOP ? 'desktop' : 'web'} build`, true);
        await page.screenshot({ path: shot('01-dropzone') });

        await dropFiles(page, [
            ...tracks.map((t) => t.file),
            junk,
            ...(DROP_BROKEN ? [broken] : []),
        ]);
        const status = page.locator('[data-testid="sync-dropzone-status"]');
        await status.waitFor({ timeout: 15_000 });
        check(
            'the .txt is listed as skipped',
            await status.getByText(/notes\.txt — not an audio file/).isVisible(),
        );

        // The run ends on "added to your library", on its own, or on an error; never
        // on the upload alone. The Clear button only shows once it has ended.
        await status
            .getByRole('button', { name: /^Clear$/ })
            .waitFor({ timeout: IMPORT_TIMEOUT_MS });
        await page.screenshot({ path: shot('02-finished') });
        const statusText = await status.innerText();
        console.log('[driver] final status:\n' + statusText);
        check(
            'dropzone reports all 3 tracks added',
            /3 tracks added to your library/.test(statusText),
        );
        if (DROP_BROKEN) {
            check(
                'the broken file is reported as not reaching the library',
                /1 uploaded track has not reached your library/.test(statusText) &&
                    statusText.includes(path.basename(broken)),
            );
        }

        // Independently of the UI: in Navidrome, with a subbox_id.
        for (const t of tracks) {
            const r = await subsonic(page, navidromeUrl, credentials, 'search3', {
                albumCount: 0,
                artistCount: 0,
                query: `"${t.title}"`,
                songCount: 5,
            });
            const song = r?.searchResult3?.song?.find((s) => s.title === t.title);
            check(`Navidrome has "${t.title}"`, !!song);
            if (song) {
                // Subsonic's getSong leaves custom tags out; Navidrome's own API has
                // them, under the session the app logged in with.
                const tags = await page.evaluate(
                    async ({ base, id }) => {
                        const server = JSON.parse(localStorage.getItem('store_authentication'))
                            ?.state?.currentServer;
                        const res = await fetch(`${base}/api/song/${id}`, {
                            headers: { 'x-nd-authorization': `Bearer ${server?.ndCredential}` },
                        });
                        return res.ok ? (await res.json()).tags : { status: res.status };
                    },
                    { base: navidromeUrl, id: song.id },
                );
                const raw = JSON.stringify(tags ?? {});
                console.log(`[driver]   tags: ${raw}`);
                check(
                    `  …and it carries a subboxid tag`,
                    /"subboxid":\["[0-9a-f-]{36}"\]/i.test(raw),
                );
            }
        }
    } catch (err) {
        console.error('[driver] error:', err);
        await page.screenshot({ path: shot('99-error') }).catch(() => {});
        ok = false;
    } finally {
        await close();
    }

    console.log(ok ? '\nALL PASS' : '\nFAILED');
    process.exit(ok ? 0 : 1);
}

main();
