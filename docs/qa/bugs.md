# Bug log (subbox-app)

Correctness bugs only — things that are outright wrong. For rough-but-working
UX friction, use `ux-notes.md` instead. See `README.md` for the conservative
fix policy before touching either an OPEN entry or committing a FIXED one.

**Archiving (do this when you close a bug):** this file is re-read on every turn
of every cycle, so keep it to `OPEN` entries plus the compact **Closed** index at
the bottom. When you move a bug to FIXED, put its **full text verbatim** in
`bugs-archive.md` (which the loop never reads) and add **one line** to the Closed
index here (date | title | verdict | issue/PR). The one-liner is enough to stop a
future cycle re-investigating; the archive has the detail if ever needed.

## OPEN

<!-- One entry per bug. Include: date found, journey/route it showed up on,
     repro steps, evidence (screenshot path / console error), your hypothesis
     for root cause + which repo owns it, and an `Issue: <github url>` line
     (every bug gets a qa-bug tracking issue — see README hard rules / skill
     Step 1½). Remove an entry (move to FIXED) once actually fixed and verified,
     don't just mark it done. -->

### Export Settings backup writes no file until the whole app is quit (Electron)

Added: 2026-07-24. Route: Settings → Advanced → Export settings. Found while
driving the never-checked `[mixed]` Settings coverage row. See `features/settings.md`.

Issue: https://github.com/laker-93/subbox-app/issues/39

**Observation.** Clicking "Export settings" in the Electron desktop app produces
no visible file in `~/Downloads` while the app keeps running — confirmed via
`fs` polling up to 60s, clicking Export twice, and forcing the window to
foreground/focus (rules out App Nap / background throttling). The real, valid
53KB `subbox-settings.json` only materializes the instant the app fully quits
(file absent right before `electronApp.close()`, present right after, PID
already dead). No toast/dialog/feedback in the meantime — a real user would
reasonably conclude the button does nothing.

**Hypothesis.** `export-import-settings.tsx`'s `onExportSettings` always uses
`Blob` + `URL.createObjectURL` + anchor `.click()` + `URL.revokeObjectURL()`,
regardless of `isElectron()`. That pattern is correct and proven-working for
the **web** build (`sync-download.tsx`'s `downloadFileFromFilebrowser` is the
same pattern, verified working, issue #25/#26). No `will-download` handler
exists anywhere in `src/main/index.ts`; on Electron the download apparently
never completes until the app's own shutdown forces a flush. The app already
has a different, proven Electron download path used elsewhere:
`download-action.tsx` → `window.api.utils.download(url)` → preload's
`download-url` IPC → `mainWindow.webContents.downloadURL(url)`
(`main/index.ts:632`). `export-import-settings.tsx` doesn't use it.

**Why NOT fixed.** Root cause isn't pinned to the exact Chromium/Electron
mechanism (ruled out focus/App Nap and zombie processes across 6+ trials), and
a fix touches shared main-process download plumbing also used by the
song-download feature — needs care to avoid regressing that proven path, plus
a slower rebuild+relaunch verify loop than fit this cycle. Suggested fix
shape: branch `onExportSettings` on `isElectron()`; route the Electron case
through a `data:application/json` URL + the existing `download-url` IPC
instead of blob+anchor (likely needs a new `will-download` handler to force
the saved filename, since a `data:` URL carries no `Content-Disposition`).
Keep the web build on the current blob approach.

**Also verified (separately, working correctly):** Import Settings — flip a
setting, import the exported file, diff screen renders, confirm applies it,
setting correctly reverts to the imported value, success message shown.

### (latent, NOT user-reachable — no issue filed by design) `PymixController.syncTracks` posts to the wrong path

Added: 2026-07-22. Found while driving the pymix-qa `Sync` coverage row
(`../pymix-qa/docs/qa/features/sync.md`).

**Observation.** `pymix-api.ts`'s `syncTracks` definition
(`src/renderer/api/pymix/pymix-api.ts:159-167`) sets `path: 'sync'` —
identical to the plain `sync` action right above it (line 135) — instead of
`'sync/tracks'`. The two client actions exist to reach two different backend
matchers (`POST /sync` = single-stage `get_track_match`; `POST /sync/tracks` =
lenient multi-stage `query_tracks_by` → fallback `query_track_by_name`,
verified live in `../pymix-qa/docs/qa/features/sync.md`), but as written
`syncTracks` would silently hit the stricter `/sync` matcher instead.

**Why NOT filed / fixed.** `grep -rn "syncTracks\b" src/` finds zero call
sites outside `pymix-api.ts`/`pymix-controller.ts`/`pymix-types.ts`
themselves — no `features/` component ever invokes
`PymixController.syncTracks`. Same shape as the pymix-qa serato
`playlistIds`-ignored finding and the `/match/tracks` #28→#29 dead-duplicate
removal: repairing unreachable surface risks becoming its own bug if the real
fix (wiring up an actual caller) has different requirements than guessed here.
**Fix it when a UI callsite for the lenient matcher is wired up, alongside
that change, not now.** No `qa-bug` issue by design (nothing a user hits).

### (informational, not urgent) Playlist "Kodzo" has a duplicate track server-side

Added: 2026-07-09. Found while validating pymix#22's new
`subbox_id_divergence` signal for real (see `directives.md`).

Test account `test260526`'s "Kodzo" playlist has two distinct server tracks
with identical title/artist/album ("Damager (Hamdi Edit)" — Sammy Virji &
Interplanetary Criminal — DUBSTEP DELUXE (LDS 246)), each with its own
`subbox_id`. Downloading the playlist fetches one; the second then shows as
"missing" on the next preview forever (correctly — its distinct subbox_id
genuinely has no local match), and would be re-downloaded as an apparent
duplicate if the user did.

Not filing as a bug to fix — this is a data question (is the duplicate
intentional, a re-import artifact, two different masters of the same
track?), not a code defect, and out of scope for the sync-matching
directive. Flagging here so it isn't mistaken for a `subbox_id_divergence`
false positive if seen again — it's a real, correctly-flagged case.

## Closed (full detail in `bugs-archive.md`)

<!-- One line per FIXED bug: date | title | verdict | issue/PR. Full text lives
     in bugs-archive.md, which the loop never reads. -->

- 2026-07-22 | External Drive "Download Missing Tracks" — misdiagnosed as ignoring drivePath (it doesn't; drive is compare-only by design) | NOT A ROUTING BUG — real defect was misleading tooltip/copy claiming tracks land on the drive; fixed by rewording copy + adding Rekordbox XML export, not by changing where files are written; full writeup `features/external-drive-sync.md` | issue #27, PR #29 (supersedes closed PR #28, which had wrongly routed downloads to drivePath)
- 2026-07-22 | Web build Sync->Download always failed (401 no X-Auth, then would 404 on missing .zip ext) | FIXED — blob-fetch download via FilebrowserController.download + corrected filename; re-verified live via web-sync-download-zip.mjs | issue #25, PR #26
- 2026-07-21 | Watch uploader "restores UI but never re-arms watcher" on relaunch | NOT A BUG — app.tsx already auto-resumes at boot (since 2026-06-05); re-verified live via watch-resume-relaunch.mjs | issue #23 (closed not-a-bug)
- 2026-07-14 | Delete track showed a success toast even when the delete failed | FIXED (client captured pymix's 200+`success:false` body; throws on failure) | issue #18, PR #19
- 2026-07-22 | External Drive "Download Missing Tracks" — misdiagnosed as ignoring drivePath (it doesn't; drive is compare-only by design) | NOT A ROUTING BUG — real defect was misleading tooltip/copy claiming tracks land on the drive; fixed by rewording copy + adding Rekordbox XML export, not by changing where files are written; full writeup `features/external-drive-sync.md` | issue #27, PR #29 (supersedes closed PR #28, which had wrongly routed downloads to drivePath)
- 2026-07-23 | Rekordbox metadata-only import: filebrowser 401 not retried + failed import shown as success toast | FIXED — sync:upload-xml now uses createFbAuth/fbRequest retry; poll loop + done screen now branch on prog.result/error; re-verified live via new rekordbox-metadata-import.mjs | issue #30, PR #31
- 2026-07-24 | Player-bar favorite button: removing a favorite often doesn't visually update | NOT REPRODUCIBLE on re-check — 21/21 fresh trials (8 REMOVE) correct with full request/state/render tracing; original 3/5 remove-failure cause unknown, not present now; no code change | issue #38 (closed not-reproducible)
