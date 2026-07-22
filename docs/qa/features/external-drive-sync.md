# Sync — External Drive Comparison tab

Verified 2026-07-22 against subbox-app `development` @ f8bfe244 (PR #29,
merged), driving Electron directly (`electron-vite build --mode
development`). Test account `test260526`, playlist "Kodzo" (8 tracks).

## UI path

Library/Sync segmented control → "Sync" → tab bar → "External Drive". Select
a root folder (native folder-picker dialog) → pick one or more playlists (or
"All server tracks") → "Compare" → preview screen (Missing from Drive /
Already on Drive / Conflicts tabs, with byte-size summary) → optionally tick
"Include Rekordbox XML" → "Download Missing Tracks" → "Download Complete"
(with "Show Music" / "Show Rekordbox XML" reveal buttons).

Under the hood: "Compare" invokes IPC `sync:scan-external-drive` (reads
audio tags from every file under the selected folder) then `POST
/sync/plan` with `direction: 'download'`. "Download Missing Tracks" invokes
IPC `sync:download-missing-tracks`, whose main-process handler
(`src/main/features/core/sync/index.ts:1797`) itself posts directly to
`POST /sync/tracks` (a raw `axios.post`, not through the renderer's
`PymixController` wrapper) to get a server-side zip, downloads it via
filebrowser, then unzips/merges it locally.

**Correction to prior journal entries:** both this repo's `bugs.md` (latent
`syncTracks` path-mismatch note) and `../pymix-qa/docs/qa/bugs.md` /
`features/sync.md` previously stated `/sync/tracks` has "no client callsite
on either side" / is "dead server surface". That's wrong — the External
Drive tab's main-process download handler calls it directly via `axios`,
bypassing the renderer's `pymix-api.ts`/`pymix-controller.ts` layer entirely
(which is why a `grep` for `syncTracks`/`PymixController.syncTracks` call
sites missed it). `/sync/tracks` **is** live, user-reachable server surface.
The renderer-side `PymixController.syncTracks` wrapper (with its own
separate `'sync'`-vs-`'sync/tracks'` path bug) genuinely has no call site
and remains correctly flagged dead.

## Design intent — the drive folder is compare-only (important, previously misdiagnosed)

**The selected drive/USB folder is only ever used to diff against.**
"Download Missing Tracks" always extracts into the app's own Subbox library
folder (`getAppPath()`, e.g. `~/Library/Application Support/subbox-dev`) —
the same destination a regular playlist download uses — never into the
drive path the user picked for comparison. This is intentional, not a
routing bug: the point of the feature is "find what my playlists have that
my USB doesn't, pull those tracks into my library, then add them to
Rekordbox and re-export the playlist to the drive from there" — the same
DJ workflow as a normal Subbox → Rekordbox → USB export, just with the
drive-diff step bolted on front to save re-downloading tracks already on
the stick.

### The prior cycle's misdiagnosis (issue #27, PR #28 — closed unmerged)

An earlier cycle read `handleDownload` never passing `drivePath` into the
`sync:download-missing-tracks` IPC call as a routing bug, filed issue #27,
and opened PR #28 to make the handler unzip into the user's chosen
drive/USB folder instead of `getAppPath()`. That fix worked *against* the
feature's actual design, not with it — confirmed directly with the
maintainer. PR #28 was closed unmerged; do not reopen or re-attempt that
direction.

The real defect was the UI copy: the "Download Missing Tracks" button's
tooltip claimed it would "Copy the missing tracks from your Subbox library
onto the selected drive folder" (flatly false), and the intro text never
mentioned where downloads actually land. That's what led both a user and
this QA loop to expect drive-write behavior that was never intended.

### The actual fix (PR #29, merged f8bfe244)

- Reworded the select-screen intro and both button tooltips to state the
  true behavior: the drive is compare-only; downloads go to the Subbox
  library, ready to add to Rekordbox and re-export.
- Added the same "Include Rekordbox XML" export (posts to pymix
  `/rekordbox/export`, downloads the XML via filebrowser) and "Show Music" /
  "Show Rekordbox XML" reveal buttons already used on the regular Download
  tab (`sync-download.tsx`), scoped to the playlists selected for
  comparison (`NOPLAYLIST` filtered out client-side since pymix's export
  endpoint only understands real playlist ids; an empty list exports every
  playlist, which doubles as "All server tracks" support). This closes the
  actual gap the misdiagnosis was reacting to: without it, a user had to
  hunt through the whole app music folder by hand to find which files were
  just downloaded.
- No change to *where* files are written — `unzipAndMerge` already skips
  any file that exists at its target path, so re-running this download (or
  overlapping with a prior normal playlist download) can't create duplicate
  files on disk. Rekordbox's XML import separately matches tracks by file
  path, so re-importing an XML that references an already-imported track
  doesn't duplicate it in the Rekordbox collection either — both dedup
  paths were free, nothing new needed.

**Verified live** via `scripts/qa/external-drive-rekordbox-xml.mjs`
(replaces the now-retired `external-drive-download.mjs`, which asserted the
opposite — and now wrong — expectation that files should land in the drive
folder):
- mocked the native folder dialog to an empty scratch tmp dir, selected
  playlist "Kodzo", compared, left "Include Rekordbox XML" ticked (checked
  by default) and downloaded
- scratch "drive" dir: **0** audio files afterward (confirms compare-only)
- app music folder: **18** real audio files extracted
- Rekordbox XML present at the app-library path
- "Show Music" / "Show Rekordbox XML" buttons rendered on the done screen
- clarified intro copy visible on the select screen

## What's still unverified

- The "Compare" step's actual tag-scanning/matching behavior for a folder
  that already has *some* but not all tracks (mixed existing/missing/
  conflict result) — this cycle used a deliberately empty scratch dir to
  make the download-destination question provable, not a realistic
  partially-populated drive.
- "All server tracks" mode (not playlist-scoped) — untested this cycle.
- The scan's handling of a very large drive/folder (performance).
- User-chosen (non-default) Rekordbox XML output directory for this tab —
  exercised only the default-directory path this cycle.
