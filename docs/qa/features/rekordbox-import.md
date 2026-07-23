# Rekordbox import — Sync → Upload (Rekordbox), metadata-only path

Partial coverage of the `[subbox]` "Rekordbox/Serato import-export UI" README row —
**only the metadata-only import sub-path** is verified here. The full track-upload
path (non-metadata-only `sync:upload-from-xml`) and the Serato import/export UI are
**not yet covered**; leave the README row unchecked until those are driven too.

Verified: 2026-07-23, live against the local dev stack (`test260526`,
`laker93/pymix:qa-local`), driven end to end via
`scripts/qa/rekordbox-metadata-import.mjs`.

## Flow

1. Sync → "Upload (Rekordbox)" tab (default tab).
2. "Select XML File" (native picker stubbed in Playwright to resolve to a fixture
   path via `QA_XML_PATH`).
3. Preview step: tick "Import metadata only (no track uploads)".
4. "Import Metadata Only" → `ipc sync:upload-xml` (uploads XML to filebrowser) →
   `PymixController.rbImport` (`POST /rekordbox/import`) → polls
   `GET /beets/import/progress` (`importProgress`) until `in_progress` flips false.

## Building a real fixture

`QA_XML_PATH` must point at a real Rekordbox XML whose tracks already exist in the
target library (metadata-only matches by Name/Artist/Album via
`SubsonicClient.get_track_match`). Built live by round-tripping the app's own
export: `POST /rekordbox/export` with a session cookie and a small `playlistIds`
filter (e.g. "Dance Mix", 3 tracks) writes `subbox_rb_export.xml` into the user's
filebrowser `downloads/` dir; download it via `GET /api/raw/downloads/<name>` with
an `X-Auth` filebrowser token. This keeps the data 100% real instead of hand-rolled.
Note: this app's own export never populates `AverageBpm` on any `<TRACK>` node — see
the bug below, which every self-round-tripped fixture will hit.

## Verified behavior (post-fix, 2026-07-23)

- XML upload no longer 401s — `sync:upload-xml` now refreshes an expired
  filebrowser token and retries, same as the sibling upload/download handlers
  (fixed this cycle, issue #30 / PR #31).
- A **failed** server-side import job (`GET /beets/import/progress` →
  `{"result":false}`) now renders "Import Failed" with the server's `reason` (or a
  generic fallback) instead of a false "Upload Complete / Success" toast (also
  fixed this cycle, same PR).
- A **successful** import job still renders "Upload Complete" with the
  `n_tracks_processed` success toast (existing behavior, unchanged, sanity-checked
  by code reading — the true happy path needs a fixture whose tracks all have a
  populated `AverageBpm`, which the round-tripped export can't produce; see below).

## Known separate bug (not fixed here)

**pymix#37** — `rekordbox_xml_controller.py::_set_metadata_from_xml` does
`bpm={int(track.AverageBpm)}` uncaught; `AverageBpm` is `None` whenever the source
XML omits it (which this app's own export always does), so `int(None)` raises a
`TypeError` that aborts metadata/cue/loop processing for **every** track in the
batch, not just the offending one. This is why the "successful import" happy path
above couldn't be driven with a self-round-tripped fixture in this cycle — a real
Rekordbox-authored XML (which does populate `AverageBpm`) would be needed, or the
pymix bug fixed first. Logged in `../pymix-qa/docs/qa/bugs.md` (OPEN), issue #37.

## Driver notes

`scripts/qa/rekordbox-metadata-import.mjs`: stubs `dialog.showOpenDialog` in the
main process to resolve to `QA_XML_PATH` (Playwright can't drive a real OS file
picker); flips the persisted `store_app` Zustand `appMode` to `'sync'` + reloads
rather than clicking the mode toggle (a right-sidebar overlap can intercept the
click on some profiles); races "Upload Complete" against
`/import failed|failed to check import progress/i` with a bounded timeout so a
hang is reported as a real failure, never silently backgrounded.
