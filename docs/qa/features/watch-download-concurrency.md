# Watch-dir upload vs. in-progress download (concurrency)

Verified 2026-07-11 driving Electron directly against the local dev stack, test
account `test260526`. **The build under test was the main `../feishin` checkout's
UNCOMMITTED fix** (launched via `QA_APP_ENTRY`), not this worktree's build — the
fix had not yet landed on `claude/continuous-ux`/`development` at verification
time. Driver: `scripts/qa/watch-download-concurrency.mjs`.

## What the fix is (subbox-app, `src/main/features/core/sync/index.ts`)

The watch-dir uploader (`sync:start-watch`) and the playlist download
(`sync:download-playlists`) are two IPC handlers in the **same main process**.
When a user downloads a large playlist, the watch poller could fire mid-download
and upload a file to the **same filebrowser host**; the concurrent upload
contended with the download stream and could reset it mid-transfer. With the old
hand-rolled `response.data.pipe(writer)`, a source-side error (socket reset /
EPIPE) was never surfaced — only writer errors were — so the returned Promise
stayed **permanently unsettled**: the renderer's `await` never returned and the
whole download UI hung.

The fix has two independent parts:

1. **Pause the watcher during a download.** A module-level `watchPaused` flag is
   set at the top of the download handler (after `await`-ing any already
   in-flight poll via `inFlightPoll` so the two never overlap) and cleared in a
   `finally`. `pollAndUpload()` early-returns while the flag is set, so the
   watch-dir upload is **deferred** for the whole download, then resumes. The
   `finally` guarantees a failed download can't wedge the poller off permanently.
2. **`stream.pipeline` instead of `.pipe()`** in `downloadFileFromFilebrowser` —
   propagates errors from *both* source and destination and destroys both on
   failure, so a mid-download source error becomes a proper **rejection** (and
   the truncated zip is `unlink`ed) instead of a hang.

Also bundled in the same working tree (adjacent, not part of the concurrency
fix): `getAppPath()` now reads the library dir name from build config
(`VITE_SUBBOX_APP_DIR`, via `src/main/config/app-config.ts`) — `subbox-dev` in
development, `subbox` in staging/prod — replacing the old inline `NODE_ENV`
`-dev` suffix. Same resulting paths as before (see `sync.md`), just centralized.

## How it was verified (end to end)

The driver starts the real watcher on a temp folder holding a track (a copy of an
already-server-present dev track, so the poller actively scans every tick but
triggers no new import), warms it up, then fires a **real** download and times it
by awaiting the `sync:download-playlists` IPC promise from node — its resolve is
the exact moment the `finally` clears `watchPaused`. It asserts three things:
the download resolves cleanly (returns `tracksExported`); **zero** watch
scan/upload ticks land inside `[downloadStart, downloadEnd]`; and the watcher
resumes ticking afterwards.

### Small download (Kodzo, 1 missing track, ~0.6–0.8s window)

`tracksExported=1`, **0 active watch ticks during the download**, watcher resumed
after. The poller was ticking on a steady ~800ms cadence before and after; the
one tick that by cadence should have fired ~+190ms into the download was
suppressed, and the next tick appeared only after the download resolved.

### Large download — the real scenario ("a large amount of missing tracks")

Backed up and emptied `~/Library/Application Support/subbox-dev/music`, then
downloaded **all** playlists (`QA_PLAYLIST=__ALL__`) so every track was missing.
Result: a genuine **11.4s** transfer, `tracksExported=24`. The watcher ticked
every ~800ms before (12 ticks) and resumed immediately after (+11.5s), but during
the 11.4s window — **where ~14 poll cycles would normally have fired — there were
ZERO watch scan/upload ticks.** Download resolved cleanly; no `ECONNRESET` /
`EPIPE` / rejection / hang in the main process. The dev library was restored to
its prior 18-file state afterward.

This is the exact user scenario ("download progresses cleanly even if the watch
dir attempts to upload a track while the download is in progress"): the watcher
is cleanly deferred for the entire download and resumes right after.

## How to re-run

Needs the local dev stack up (`docker ps`) and a dev Electron build of the app
under test (`pnpm exec electron-vite build --mode development` — **not**
`build:electron`, which bakes the prod pymix URL; see `docs/qa.md`).

```bash
# Against this worktree's own build (once the fix has landed here):
node scripts/qa/watch-download-concurrency.mjs

# Against an UNCOMMITTED fix in the main checkout (as verified above):
QA_APP_ENTRY=../feishin/out/main/index.js QA_PLAYLIST=Kodzo \
  node scripts/qa/watch-download-concurrency.mjs

# The "large amount of missing tracks" window — empty the dev library first,
# BACK IT UP, and restore after (the driver header documents the exact commands):
D="$HOME/Library/Application Support/subbox-dev"; cp -a "$D/music" /tmp/mbk
rm -rf "$D/music"/*
QA_APP_ENTRY=../feishin/out/main/index.js QA_PLAYLIST=__ALL__ \
  node scripts/qa/watch-download-concurrency.mjs
rm -rf "$D/music"; cp -a /tmp/mbk "$D/music"
```

## Gotchas learned here (don't re-chase)

- **You cannot monkeypatch `window.api.ipc`.** contextBridge exposes it as an
  immutable object, so `window.api.ipc.invoke = wrapper` silently no-ops and any
  timing you collect from the wrapper is bogus (the call still runs unwrapped).
  *Invoking* through the bridge works fine — so drive the download by calling
  `window.api.ipc.invoke('sync:download-playlists', …)` directly and time that.
- **Bound the "paused window" by the IPC promise, not UI text.** The "Downloading
  / Extracting" text hides slightly *after* the download promise resolves (React
  render lag), so a UI-bounded window is wider than the true `watchPaused` window
  and a watcher tick firing in that trailing gap is a false positive — it fired
  *after* `watchPaused` was already cleared, which is correct.
- **`POST /sync/playlists` needs a bootstrapped pymix session.** Driving the
  download IPC straight after login (skipping the UI) rejects with "Must have a
  username or session ID to identify user". Run "Preview Download" once through
  the UI first (as a real user would) to establish the session cookie.
- **`includeRekordboxXml` defaults to `true`** in the download UI, which adds a
  `/rekordbox/export` + a *second* filebrowser download (the XML). That XML fetch
  is unrelated to this fix and was seen to intermittently 502 via traefik in dev;
  the driver defaults it off (`QA_RB_XML=1` to include it).
