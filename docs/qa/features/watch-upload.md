# Feature: upload music via the watch-dir uploader

**Status:** **verified end-to-end 2026-07-21** against the local dev stack
(`test260526`). Drove the real Sync → Watch UI on 2 guaranteed-new tracks
(metadata stripped, so they carried **no** `SUBBOX_ID` and were new to the
library) and confirmed the whole path:

1. **Source had no `SUBBOX_ID`** (ffprobe: `(no subbox tag)` on both).
2. **Real UI upload** (`scripts/qa/watch-upload.mjs`): Select Directory → Start
   Watching → `phase=scanning` → `phase=idle uploaded=2/2`, drained cleanly, no
   `[Subbox]`/error lines.
3. **Watcher wrote a fresh `SUBBOX_ID` into each staged file in place**
   (`QA_KEEP_WATCH_DIR=1` → ffprobe showed `SUBBOX_ID=1a10a19e-…` and
   `93305dbc-…` where the source had none). This is the `getOrCreateSubboxId`
   mint step, confirmed on real files.
4. **pymix imported → beets**: both `subbox_id`s present in `beetstest260526`
   with the right artist/title.
5. **Navidrome rescanned them into the library**: both rows in
   `media_file` (title/artist/album as tagged).
6. **Cleaned up net-neutral**: deleted both via the proper `DELETE /track`
   API (session cookie), beets empty + Navidrome dropped both (0 rows) after
   rescan. No bug found — happy path is correct.

## What it does

Uploads audio files into the logged-in user's Subbox library through the app's
**Sync → Watch** feature, pointed at a **source directory** of tracks. The driver
`scripts/qa/watch-upload.mjs` copies the source files into a throwaway staging
folder and drives the real UI to watch that folder; the watcher then tags +
uploads them to the user's cloud library.

## The upload path (verified from source)

`subbox-app/src/main/features/core/sync/index.ts`:

- **`sync:select-watch-directory`** → native `dialog.showOpenDialog` (folder
  picker). The driver **stubs this in the main process** so the real *Select
  Directory* button resolves to the staging dir headlessly.
- **`sync:start-watch`** → starts a poller (`pollAndUpload`, default every 10 s).
  Each tick: `getAudioFiles(watchDir)` (recurses; skips dot-dirs; extensions
  `.aac .flac .m4a .mp3 .ogg .opus .wav .wma`), then for each file
  `getOrCreateSubboxId(filePath)` — **which writes a `SUBBOX_ID` tag into the file
  in place** — then TUS-uploads new files to filebrowser `uploads/`, skipping ones
  already uploaded. Emits `sync:watch-progress` (`phase`: `scanning` / `uploading`
  / `idle` / `error`, plus `uploaded` / `total` / `currentFile`).
- **`sync:stop-watch`** → clears the interval.
- The uploader is **deferred while a download runs** (`watchPaused`) — see
  `watch-download-concurrency.md`.

### Two consequences that shape the driver

1. **The watcher mutates the files it watches** (writes `SUBBOX_ID`). So the driver
   **copies** the source into a staging dir and watches the copy — the source is
   never touched. Never point the watcher directly at a library you care about.
2. **`watchDir` is any folder you choose** — it is *not* the dev local library
   (`subbox-dev/music`, which is the *download* destination). Upload source and
   download destination are independent.

## What the driver does

`scripts/qa/watch-upload.mjs`:

1. Gathers audio files under `QA_SOURCE_DIR` (recursive), takes up to
   `QA_UPLOAD_LIMIT`, **copies** them into a temp staging dir preserving relative
   paths. Originals untouched.
2. Launches the Electron build (`resolveAppEntry` / `QA_APP_ENTRY`), logs in with
   the shared helpers, stubs `dialog.showOpenDialog` → staging dir.
3. Drives the genuine UI: sidebar **Sync** → **Watch** tab → **Select Directory**
   (stub returns the staging dir; the path renders) → **Start Watching**.
4. Re-issues `sync:start-watch` with a faster `pollIntervalMs` (default 2 s vs the
   app's 10 s) so progress is visible sooner; `watchDir: null` reuses the folder
   the button set.
5. Records `sync:watch-progress`, logs progress, and waits until an `uploading`
   burst returns to `idle` (or all files were already present), then **Stop
   Watching**, screenshot, cleanup.

Prints `copied`, `uploaded` (may be `< copied` when some tracks already exist
server-side — deduped by the "already uploaded" skip), and `DONE` / `TIMED OUT`.

## Env knobs

| Var | Default | Meaning |
|---|---|---|
| `QA_SOURCE_DIR` | — (**required**) | Directory of audio files to upload (recursed) |
| `QA_UPLOAD_LIMIT` | all | Max files to copy/upload |
| `QA_APP_ENTRY` | this worktree's build | `out/main/index.js` to launch |
| `QA_POLL_MS` | 2000 | Watch poll interval |
| `QA_WATCH_DIR` | fresh mkdtemp | Explicit staging dir |
| `QA_KEEP_WATCH_DIR` | unset | Keep the staging dir on exit (inspect it) |
| `QA_UPLOAD_TIMEOUT_MS` | 1200000 | Cap waiting for the uploader to drain |

## Relaunch auto-resume (verified 2026-07-21)

After **Start Watching → quit → relaunch**, the watcher **genuinely re-arms** — it
is not just a cosmetic "Stop Watching" flag. The restore happens at **app boot**,
not in the Sync → Watch component:

- `src/renderer/app.tsx` ("Auto-resume watch directory on app launch",
  added 2026-06-05) reads persisted `watch_directory` + `watch_active` on mount
  and re-invokes `sync:start-watch` as soon as `currentServer.fbToken` is
  hydrated — **independent of whether the user ever opens Sync → Watch**.
- `sync-watch.tsx`'s own mount effect only restores the `watching` UI flag
  (`setWatching(true)`); the actual re-arm is app.tsx's job.

**Verified** via `scripts/qa/watch-resume-relaunch.mjs` (pollution-free — the
watch dir is kept empty, so nothing uploads): launch 1 Start Watching → quit →
launch 2 (same userData) emits `[scanning,idle]` watch-progress events **before**
navigating anywhere (proving the boot restore fired), Stop Watching shown, watcher
running. This directly refutes subbox-app **#23**, which reported the watcher as
never re-arming — that report inspected only `sync-watch.tsx` and missed the
app.tsx restore. Issue closed as not-a-bug; no code change.

## Dedup guard (verified 2026-08-21)

**Status:** verified end-to-end, all 4 phases PASS, against a fresh 4-track
fixture (`make-test-rekordbox-xml` audio-only, no `SUBBOX_ID`) on `test060826`.
Driver: `scripts/qa/watch-dedup-guard.mjs` — a pass/fail regression (unlike
`watch-upload.mjs` above, deterministic enough to be one) for the specific
failure mode the watch/download-concurrency and poller-re-entrancy fixes exist
to prevent: **the watcher must upload each file exactly once**, never more.

Four phases against one staging dir, driving the real Sync → Watch UI:

- **A — fresh upload.** N untagged files land before the watcher starts →
  exactly one `uploading` burst, every file tagged + uploaded, no duplicates
  within the burst.
- **B — linger.** Poller keeps ticking for 45s with the same (now-tagged)
  files still in place → zero re-upload bursts.
- **C — dribble.** One more file is written in slowly (12 chunks over 24s)
  while the watcher is live → confirms subbox-app #108 (never tagged mid-write,
  only after the last byte lands) and that it's picked up and uploaded exactly
  once, not before completion. Confirmed live: the real upload lands up to
  ~10s after the last byte, because a file only becomes upload-eligible once
  `fileStabilityHistory` sees the same `(size, mtime)` on two consecutive
  polls (`src/main/features/core/sync/index.ts`) — a real, correct debounce
  against in-progress writes, not a bug.
- **D — relaunch.** Quit and relaunch, Start Watching on the same dir again.
  The new process starts with an empty in-memory `knownPresentIds`, so this
  exercises the **server-side** `POST /tracks/presence` dedup instead of the
  client cache → zero re-uploads.

**Driver bug found and fixed while first running this** (not a product bug):
`waitForDrain` read the *entire* accumulated `window.__watchEvents` list with
no lower time bound. Called a second time in the same launch (phase C), it saw
phase A's already-idle-after-upload state as "the latest event" and returned
"drained" instantly — before the real, slower phase-C upload (which the
`fileStabilityHistory` debounce above legitimately delays) had happened. The
driver then raced ahead to phase D (stop watching, close, relaunch) before the
dribbled file's genuine first upload occurred, which then landed under the
*relaunch* process instead — misreported as C3/C4 "never uploaded" and D2 "a
re-upload after relaunch", when the DB behind it (checked directly via
`beet list`) only ever had one row for that file the whole time. Fixed by
scoping `waitForDrain` to a `since` timestamp per phase; re-run afterward is
clean 4/4 phases, no product code touched.

## Boundaries / gotchas

- **Writes to a live dev user.** Uploads land in the logged-in user's per-user
  container (filebrowser → pymix import → Navidrome). **Local dev stack only** —
  never a staging/prod build. Confirm the intended test account before a big run.
- **Watcher progress ≠ library visibility.** The watcher reports success at the
  filebrowser hand-off. Files then go through pymix's async import + a Navidrome
  rescan before showing in the library UI — expected lag, not tracked here.
- **Not a `test-*` regression.** Like `wishlist-import-dev`, this is a **mutating
  exerciser** with no clean pass/fail (upload count depends on what's already
  present), so it is deliberately not in the loop's regression rotation.
- Build the app in **dev mode** (`electron-vite build --mode development`) so it
  targets `pymix.docker.localhost`; plain `build:electron` bakes the prod URL.
