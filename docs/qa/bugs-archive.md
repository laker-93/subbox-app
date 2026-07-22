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
