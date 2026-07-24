# Bug archive (subbox-app)

Inert history — full text of `FIXED` bugs, moved out of `bugs.md` so that hot
file (re-read on every turn of every cycle) stays small. **The loop never reads
this file.** `bugs.md` keeps a one-line index of everything archived here. Same
pattern as `directives-archive.md`.

<!-- Full FIXED entries, appended verbatim from bugs.md when closed. -->

### Watch uploader restores "watching" UI on relaunch but never re-arms the watcher — NOT A BUG

Logged: 2026-07-20 (issue #23). Closed as not-a-bug: 2026-07-21 after live re-verification.
Issue: https://github.com/laker-93/subbox-app/issues/23 (closed not-a-bug)

**Reported symptom.** After Start Watching → quit → relaunch, Sync → Watch shows
the red **Stop Watching** button, supposedly implying the folder is watched while
no watcher actually runs — so dropped files would be silently ignored until a
manual Stop → Start.

**Why it's not a bug.** The original report inspected only `sync-watch.tsx` and
concluded "nothing re-invokes `sync:start-watch` on relaunch; main has no boot
restore." It **missed** `src/renderer/app.tsx` (lines ~75-94, "Auto-resume watch
directory on app launch", added 2026-06-05 in commit 81fd618d — six weeks *before*
this bug was filed). That effect reads persisted `watch_directory` + `watch_active`
on app boot and re-invokes `sync:start-watch` as soon as `currentServer.fbToken`
is hydrated, **independent of navigation**. `sync-watch.tsx`'s mount effect only
restores the cosmetic `watching` flag — but the real re-arm is app.tsx's job, and
it runs at boot. So the "Stop Watching" UI on relaunch is truthful: the watcher
*is* running.

**Live verification (2026-07-21).** New pollution-free regression
`scripts/qa/watch-resume-relaunch.mjs`: launch 1 Start Watching (empty watch dir,
nothing uploads) → quit → launch 2 (same userData) emitted `[scanning,idle]`
watch-progress events **before** navigating to Sync → Watch (proving the boot
restore fired), Stop Watching shown, watcher running. Ran identically against the
base build with **and** without a speculative `sync-watch.tsx` re-arm patch —
both re-armed, confirming app.tsx is what does it and the mount-effect change is
redundant (it was reverted, not committed). PIDs differed between launches
(separate processes); dev mode bypasses the single-instance lock
(`src/main/index.ts:898`), so no cross-process leak.

**Outcome.** No code change. Issue #23 closed as not-a-bug. Regression driver kept
+ documented in `features/watch-upload.md` ("Relaunch auto-resume").

### Delete track showed a success toast even when the delete failed

Found + fixed: 2026-07-14. Journey: song context menu → "Delete track" → confirm
(`scripts/qa/delete-track-journey.mjs`), account `test260526`.
Issue: https://github.com/laker-93/subbox-app/issues/18

**Bug.** pymix signals a failed delete **in the body, not the HTTP status**:
`DELETE /track` returns **200** with
`{"success": false, "results":[{"success": false, "reason": "…"}]}`. The client
threw that body away — `pymix-types.ts` declared the response schema as
`const deleteSong = z.null()` — and `PymixController.deleteSong` only checked
`res.status !== 200`. So the mutation resolved, and `delete-song-action.tsx`
fired the **success toast for a delete that never happened**. The user believes
the track is gone; it's still on disk and still in the library.

Reachable whenever pymix's beets state and the Navidrome library have drifted
apart (also confirmed directly against the API for any unknown/stale
`subbox_id`).

**Repro (live).** Import a scratch track via the watch dir, then create a
realistic desync by dropping its beets row only, leaving the file + Navidrome
entry: `docker exec beetstest260526 beet rm -f "subbox_id::<id>"`. Delete it in
the app. Before the fix: `DELETE /track` → 200 `success:false` (reason: a raw
`DockerException` — `beet rm -df … 'error: No matching items found.'`), UI showed
the **success** toast, file still at
`/private-music/test260526/QA Desync Probe/qa-desync-scratch/00 - ….mp3`.

**Fix.** `pymix-types.ts`: the `deleteSong` response schema now captures pymix's
`{success, results, reason}` instead of `z.null()`. `pymix-controller.ts`:
`deleteSong` throws when `success === false`, with the per-id reasons logged to
the console and a concise message for the toast. `delete-song-action.tsx` already
catches and shows an error toast, so nothing else changed.

**Re-verified live** (rebuilt `electron-vite build --mode development`, re-drove
the identical desync repro): the flow now shows **"Error / Failed to delete the
track"** and the track correctly stays listed. **Happy-path regression checked**
on a fresh scratch track: still exactly 1 request, success toast, and the file /
beets row / pymix rows all actually deleted. `pnpm typecheck` clean;
`pnpm lint-code` clean on the changed files (3 pre-existing errors remain in
older `scripts/qa/` drivers, untouched).

Noted, not a regression: a *failed* delete now fires 4 requests, because the
app's standing `mutations.retry: 3` policy (`renderer/lib/react-query.ts:24`)
only becomes reachable once the mutation actually rejects. Harmless (re-deleting
a gone id fails identically) and consistent with every other mutation.

Commit: see `claude/continuous-ux`. PR: https://github.com/laker-93/subbox-app/pull/19
Writeup: `features/delete-track.md`. Single-repo (subbox-app). The pymix half of
this story — a failed delete still commits pymix's DB-row deletion, orphaning the
file — is logged separately as pymix issue #30, and is **not** fixed.

### Web build: Sync -> Download always fails (401, then would still 404) — no X-Auth on the filebrowser download link

Added: 2026-07-22. Coverage: `[subbox]` Sync flows, web (non-Electron) path — never
previously driven (the docker `player` container at `www.docker.localhost` isn't in
pymix's CORS allowlist, so web-mode can't even log in there locally; had to drive
it via `pnpm dev:web` on `localhost:4343`, which IS allowlisted).

Issue: https://github.com/laker-93/subbox-app/issues/25

**Symptom.** Clicking "Download Zip" (and the optional Rekordbox XML download) in
the web build's Sync -> Download screen fails every time. Two stacked bugs in
`sync-download.tsx`'s web branch of `handleDownload`:
1. filebrowser requires a custom `X-Auth` header (`filebrowser-api.ts`) that a
   plain `<a href>` click to a cross-origin URL can never carry — every download
   401'd, and the click also navigated the whole SPA away to the (401) raw URL
   since `download` is ignored cross-origin.
2. Independently, `/sync/playlists`'s `zipPath` response omits the `.zip`
   extension (real file is `music.zip`) — the Electron main-process path already
   knew this and appended `.zip`; the web path used the bare name, so it would
   still 404 even with auth fixed.

**Evidence.** Live Playwright run (before fix) against `pnpm dev:web`:
`GET .../api/raw/downloads/music -> 401`.

**Fix.** Added `downloadFileFromFilebrowser()` in `sync-download.tsx`: fetches
the file as a blob via the already-existing-but-previously-unused
`FilebrowserController.download` (`fbApiClient` with the `X-Auth` header +
`responseType: 'blob'`), then triggers the save from a same-origin
`URL.createObjectURL` blob instead of a raw cross-origin href. Both the zip and
XML downloads route through it; the zip filename is corrected to
`${basename}.zip`, matching what the Electron main-process path already does.

**Re-verified live** via `scripts/qa/web-sync-download-zip.mjs` (Chromium
Playwright against `pnpm dev:web`, account `test260526`, playlist "Dance Mix" —
3 tracks): `GET .../api/raw/downloads/music.zip -> 200`,
`.../subbox_rb_export.xml -> 200`, a genuine Playwright `download` event fired
(`music.zip`), app stayed mounted (no stray top-level navigation). `pnpm
typecheck` clean; `pnpm lint-code` clean on the changed file (pre-existing
unrelated lint debt in some `scripts/qa/*.mjs` files, untouched).

Commit: see `claude/continuous-ux`. Issue: #25. Writeup:
`features/sync.md` ("Download side, WEB build" section). Single-repo
(subbox-app) — no pymix change needed.

### External Drive "Download Missing Tracks" — misdiagnosed as ignoring drivePath

Found + corrected: 2026-07-22. See `bugs.md` Closed index and
`features/external-drive-sync.md` for the full writeup (kept there rather than
duplicated here since the correction itself, not a fix commit, is the record).
Issue: https://github.com/laker-93/subbox-app/issues/27. PR:
https://github.com/laker-93/subbox-app/pull/29 (supersedes closed PR #28).

### Rekordbox metadata-only import: 401 not retried + failed import shown as success

Added: 2026-07-23. Found driving the never-before-covered `[subbox]` Sync ->
Upload (Rekordbox) metadata-only path, live against `test260526`, using a
real XML built via a `POST /rekordbox/export` round-trip.

**Bug 1.** `sync:upload-xml` (`src/main/features/core/sync/index.ts`) posted
the XML with a bare `axios.post` and a raw `filebrowserToken` — no
refresh-on-401 retry, unlike every sibling filebrowser call site
(`sync:upload-from-xml`, `downloadFileFromFilebrowser`,
`sync:start-watch`), and the renderer never passed `serverId`/`username`
needed to refresh. Same bug class as the already-fixed issue #25.

**Bug 2.** `sync-rekordbox.tsx`'s import-progress poll only checks
`prog.in_progress`; on completion it unconditionally shows a success toast,
ignoring `prog.result`/`prog.reason`. The "done" screen is hardcoded to a
green success UI with no error branch, even though an existing catch path
already does `setError(...); setStep('done')` expecting one. Live repro: a
real (separate, server-side) pymix crash mid-import
(`_set_metadata_from_xml` AverageBpm TypeError, pymix#37) flipped
`GET /beets/import/progress` to `{"result":false}`, and the client showed
"Upload Complete / Success — Imported 0 tracks" with no error indication.

**Fix.** `sync:upload-xml` now builds a `createFbAuth`/`fbRequest` pair
(renderer passes `serverId`/`username` through) for the same refresh-on-401
retry as the sibling handlers. The poll loop now branches on `prog.result`:
success keeps the existing toast; failure sets `error` and the "done" screen
gets a real error branch (icon/copy matching the existing storage-exceeded
error pattern) instead of always rendering the green success screen.
Re-verified live via new `scripts/qa/rekordbox-metadata-import.mjs`: upload
no longer 401s, and the (separately tracked, still-crashing server-side)
failure now correctly renders "Import Failed" instead of a false success
toast. typecheck + lint clean.

Issue: https://github.com/laker-93/subbox-app/issues/30. PR:
https://github.com/laker-93/subbox-app/pull/31.

### Player-bar favorite button: removing a favorite often doesn't visually update — NOT REPRODUCIBLE ON RE-CHECK

Logged: 2026-07-11, re-investigated and confirmed 2026-07-24 (earlier that same
day), then re-investigated again 2026-07-24 (this cycle) and closed as not
currently reproducible.
Issue: https://github.com/laker-93/subbox-app/issues/38 (closed not-reproducible)

**Original finding (earlier 2026-07-24 cycle).** Rewrote `_probe-fav.mjs` to
locate the button by its SVG heart-path signature and click live coordinates.
Across 9 fresh-launch trials, every click fired exactly one `star.view`/
`unstar.view` request (200) — not inert — but the icon's visual state only
reliably reflected an ADD (4/4 clean). REMOVE failed to visually update in 3/5
trials, staying "favorited" indefinitely with no self-correction. Static review
of `create-favorite-mutation.ts`/`delete-favorite-mutation.ts` found no
asymmetry that would explain the skew; filed as a race not pinned down.

**Re-investigation (this cycle).** Instrumented the actual runtime path with
temporary `console.log` calls: `audio-players.tsx`'s `handleFavorite` (payload +
resulting `getCurrentSong()` state) and `right-controls.tsx`'s `FavoriteButton`
render (id/uniqueId/userFavorite on every render). Rebuilt
(`electron-vite build --mode development`) and ran `_probe-fav.mjs` repeatedly:

- 13 runs, then 3 more (16 total) with instrumentation live, capturing the full
  page-console trace via a `page.on('console')` listener added to the probe —
  **16/16 correct** (icon fill matched the mutation direction every time, both
  add and remove).
- Reverted the instrumentation, rebuilt clean, ran 5 more — **5/5 correct**
  (21/21 overall, 8 of which were REMOVE trials).

Traced logs on every trial showed the expected sequence with no anomaly:
`handleFavorite` fires once per click with the correct payload,
`updateQueueFavorites` flips `userFavorite` on the matching queue song
immediately, and `FavoriteButton` re-renders 2-3 times afterward each showing
the new, correct value. No asymmetry, no race, no missed re-render observed in
any trial.

**Verdict.** Under the previously-measured ~60% failure rate, 8/8 clean REMOVE
trials in a row has <0.2% probability by chance — the original failures are not
reproducing now. Root cause of the *original* 3/5 failures was never pinned down
(possibly a transient condition — machine load, a stale build predating a
same-day rebase, or genuine environment flakiness in the earlier cycle's run),
but it is not present in this codebase as currently checked out. Closed issue
#38 as not-reproducible rather than fixed (no code change was needed — or
possible, since nothing wrong was found). Instrumentation was reverted, not
shipped. `features/songs-browse-and-play.md` updated to reflect the toggle as
verified. If this resurfaces, re-run `_probe-fav.mjs` several times fresh and
note any correlation with system load or a specific build.

### Export Settings backup writes no file until the whole app is quit (Electron)

Added: 2026-07-24. Fixed: 2026-07-25. Route: Settings → Advanced → Export
settings. Found while driving the never-checked `[mixed]` Settings coverage
row. See `features/settings.md`.

Issue: https://github.com/laker-93/subbox-app/issues/39

**Observation.** Clicking "Export settings" in the Electron desktop app produced
no visible file in `~/Downloads` while the app kept running — confirmed via
`fs` polling up to 60s, clicking Export twice, and forcing the window to
foreground/focus (rules out App Nap / background throttling). The real, valid
53KB `subbox-settings.json` only materialized the instant the app fully quit
(file absent right before `electronApp.close()`, present right after, PID
already dead). No toast/dialog/feedback in the meantime — a real user would
reasonably conclude the button does nothing.

**Root cause.** `export-import-settings.tsx`'s `onExportSettings` always used
`Blob` + `URL.createObjectURL` + anchor `.click()` + `URL.revokeObjectURL()`,
regardless of `isElectron()`. That pattern is correct and proven-working for
the **web** build (`sync-download.tsx`'s `downloadFileFromFilebrowser` is the
same pattern, verified working, issue #25/#26). No `will-download` handler
existed anywhere in `src/main/index.ts`; on Electron the download apparently
never completed until the app's own shutdown forced a flush. The app already
had a different, proven Electron download path used elsewhere:
`download-action.tsx` → `window.api.utils.download(url)` → preload's
`download-url` IPC → `mainWindow.webContents.downloadURL(url)`
(`main/index.ts:632`). `export-import-settings.tsx` didn't use it.

**Fix.** Branched `onExportSettings` on `isElectron()`: the Electron path
base64-encodes the settings JSON into a `data:application/json;base64,...`
URL and sends it through the proven `window.api.utils.download` → IPC →
`webContents.downloadURL` pipeline (now passing an explicit filename through
that channel). Added a `will-download` handler on the main window's session
(`src/main/index.ts`) that calls `item.setSavePath(...)` with the
caller-supplied filename when one is provided — needed because a `data:` URL
carries no `Content-Disposition`/path segment for Chromium to derive a
filename from, unlike the real HTTP download URLs the song-download feature
downloads (which already get a correct filename from the response and are
unaffected by this change, since they pass no filename). The web build is
untouched — still the original blob/anchor pattern.

**Re-verified live.** `scripts/qa/settings-journey.mjs` post-fix: export
button click → real file `~/Downloads/subbox-settings.json` appears in ~300ms
while the app keeps running (previously: absent even after 60s of polling,
only appeared on app quit) → valid JSON, correct size (53083 bytes), correct
top-level keys. typecheck clean, lint clean on changed files
(`export-import-settings.tsx`, `src/main/index.ts`, `src/preload/utils.ts`).

**Also verified (separately, working correctly, unaffected by this fix):**
Import Settings — flip a setting, import the exported file, diff screen
renders, confirm applies it, setting correctly reverts to the imported value.
