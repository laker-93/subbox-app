# Rekordbox import — Sync → Upload (Rekordbox)

Partial coverage of the `[subbox]` "Rekordbox/Serato import-export UI" README row.
Both the **metadata-only** import sub-path and the **full track-upload** sub-path
(non-metadata-only `sync:upload-from-xml`) are now verified — see below. The
Serato import/export UI is **still not covered**; leave the README row unchecked
until that's driven too.

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

## Known separate bug — FIXED 2026-07-23

**pymix#37** (fixed, PR [laker-93/pymix#39](https://github.com/laker-93/pymix/pull/39))
— `rekordbox_xml_controller.py::_set_metadata_from_xml` did
`bpm={int(track.AverageBpm)}` uncaught; `AverageBpm` is `None` whenever the source
XML omits it (which this app's own export always does), so `int(None)` raised a
`TypeError` that aborted metadata/cue/loop processing for **every** track in the
batch, not just the offending one. Fixed by skipping just that track's bpm modify
when `AverageBpm is None` (logs and continues). Re-verified live 2026-07-23 against
`laker93/pymix:qa-local`: re-exported "Kodzo" (8 tracks, 0 `AverageBpm` attrs) and
re-imported metadata-only via this same driver — job completed `success=True`
("Upload Complete"), no crash. See `../pymix-qa/docs/qa/bugs-archive.md`.

## Full track-upload path (non-metadata-only), verified 2026-07-23

Flow: same Preview step as above but "Import metadata only" left **unchecked** →
"Upload Selected Playlists" → `ipc sync:upload-from-xml` (main process): uploads the
XML to filebrowser, calls `POST /sync/match_tracks` per track to find which are
already on the server, TUS-uploads only the unmatched ("missing") tracks' audio
files, then triggers `POST /rekordbox/import`.

Driven live via `scripts/qa/rekordbox-full-upload.mjs` against a fresh 4-track
fixture (`make-test-rekordbox-xml` skill, self-contained real audio + XML, seed
777). Confirmed **the happy path works end-to-end**: the one track genuinely new
to the library (`match_tracks` correctly returned unmatched) uploaded via TUS with
no 401s (PR #31's retry-on-401 fix still holds on this path too), `/rekordbox/import`
ran, and the UI showed "Upload Complete / 1 tracks uploaded / 1 tracks imported into
library / Success — Imported 1 tracks". Scratch track cleaned up via `DELETE /track`
(subbox_id `f8ff35e8-5944-4e57-98d3-beb97d6b0beb`) after.

**Not a subbox-app/pymix bug, but a QA-tooling footgun worth knowing:** the other 3
of 4 fixture tracks were falsely reported `matched: true` by `/sync/match_tracks`
against unrelated tracks left over from *earlier, unrelated* QA fixture runs (e.g.
seed 31/42), so their audio was silently skipped from upload. Root-caused to
`pymix/scripts/make_test_rekordbox_xml.py`: every track it ever generates gets a
literal, shared `"(QA Fixture <seed>-<n>)"` suffix baked into the title, and draws
artist/album from a small fixed pool — so repeated runs of this generator create
self-colliding fake libraries. `sync.py`'s `/sync/match_tracks` uses
`SubsonicClient.get_track_match`, which does live per-token Subsonic full-text
search with a threshold that falls as low as 0.4 on the last tier — real user
libraries won't have this shared-boilerplate-title collision pattern, but this test
tool's own leftover fixtures do. Confirmed by re-running with hand-randomized,
non-colliding album names: still 3/4 false-matched purely on title+artist overlap
with old `(QA Fixture ...)` tracks. **Takeaway for future cycles using this
generator for the full-upload path:** the false "already matched" result is
expected noise from accumulated fixture debris in this shared dev library, not a
regression to chase — a track only proves the upload path broken if it's the one
`match_tracks` legitimately calls unmatched. No fix made (out of scope: the
generator script lives in `../pymix`, not this worktree's `claude/continuous-ux`
branch, and this doesn't reproduce for real users).

Scratch fixtures from this cycle left in place for reuse (ephemeral `/tmp`, not
repo-tracked): `/tmp/qa/rekordbox-overlap-fixture.xml` (6-playlist overlap fixture
for the dedup driver) and `/tmp/qa/rekordbox-full-upload-fixture{,-uniquealbum}.xml`
+ `/tmp/qa/audio/` (4-track fixture for the full-upload driver, seed 777). A future
cycle wanting a truly clean (non-colliding) full-upload fixture should regenerate
with a fresh `--seed` rather than reusing these, given the false-match finding above.

## Driver notes

`scripts/qa/rekordbox-metadata-import.mjs`: stubs `dialog.showOpenDialog` in the
main process to resolve to `QA_XML_PATH` (Playwright can't drive a real OS file
picker); flips the persisted `store_app` Zustand `appMode` to `'sync'` + reloads
rather than clicking the mode toggle (a right-sidebar overlap can intercept the
click on some profiles); races "Upload Complete" against
`/import failed|failed to check import progress/i` with a bounded timeout so a
hang is reported as a real failure, never silently backgrounded.
