# Feature: upload music via the watch-dir uploader

**Status:** driver written; drive it once end-to-end against the local stack to
promote this doc from "expected" to "verified".

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
