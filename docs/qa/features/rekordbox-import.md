# Rekordbox import — Sync → Upload (Rekordbox format)

> **UI moved (2026-08-28, `serato/sync-ui-substrate`, unmerged).** The two Upload
> tabs are one **Upload** tab with a Rekordbox/Serato control on its first screen,
> persisted per direction. The drivers referenced here were updated to match but
> **have not been re-run live**. Details and the full driver list: `features/sync.md`.

Full coverage of the `[subbox]` "Rekordbox/Serato import-export UI" README row.
Both the **metadata-only** import sub-path and the **full track-upload** sub-path
(non-metadata-only `sync:upload-from-xml`) are verified — see below. The Serato
side has **no client UI at all** to drive — see "Serato: no client UI" below,
confirmed 2026-07-23.

Verified: 2026-07-23, live against the local dev stack (`test260526`,
`laker93/pymix:qa-local`), driven end to end via
`scripts/qa/rekordbox-metadata-import.mjs`.

**Phase reporting + job-completion honesty re-verified 2026-08-21** (see the new
section below) against `test060826` and the running `pymix` container
(`laker93/pymix:main-20260821-local`, already carrying pymix#133 — not rebuilt
this cycle). Covers the pause-era `[subbox]` README row "Rekordbox import phase
reporting" (#79) plus the same-day #109/pymix#133 fix ("stop declaring a
Rekordbox import successful before it is").

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

## Serato: no client UI

Confirmed 2026-07-23 (code trace, no driver needed — there is nothing to click):
`PymixController.seratoDownload`/`seratoImport` (`pymix-controller.ts:247,258`)
and their API definitions (`pymix-api.ts`) exist, but zero UI component
references them (`grep -rn -i serato src/renderer` matches only the controller/API
files themselves plus one marketing line on the landing page). The Sync screen's
tab set is hardcoded to exactly four modes — `SyncTab = 'download' | 'external-drive'
| 'upload' | 'watch'` (`sync-mode-placeholder.tsx:14`) — `'upload'` renders only
`SyncRekordbox`; there is no fifth Serato tab or toggle anywhere. This matches
`../pymix-qa/docs/qa/features/serato-export.md`'s finding that `seratoDownload` has
no UI callsite, from the other side. **Nothing to drive; this half of the row is
"verified absent," not "still needs a cycle."**

Landing page (`features/home/components/landing-page.tsx:37-40`) advertises "Sync
and convert libraries between **Serato**, Rekordbox, and more" — logged as a
ux-note (`ux-notes.md`) since it's ambiguous whether this is inaccurate present-tense
copy or intentional whole-platform/roadmap framing; not changed this cycle.

## Phase reporting + job-completion honesty, verified 2026-08-21

Two pieces of freshly-merged surface, driven live for the first time: the
frozen-100% fix from #79/pymix#100/#109/#110, and the same-day #109/pymix#133
fix for the two ways the import screen used to lie about whether it had
finished. Fixture: `make-test-rekordbox-xml`, 20 real tracks, seed `20260821`
(`pymix scripts/make_test_rekordbox_xml.py --num-tracks 20 --seed 20260821`),
`/tmp/qa/rekordbox-phase-fixture.xml` + `/tmp/qa/audio/`.

**Full track-upload path — phase reporting.** New driver
`scripts/qa/rekordbox-import-phase-progress.mjs` samples the progress screen's
text every ~1.2s through the whole import. Live run against the 20-track
fixture: `[1.2s] Importing into library... | 0 / 20 tracks (0%)` →
`[3.7s] Linking tracks to your library... | 20 / 20 tracks (85%)` → done at
7.5s. Confirms the phase label changes (not a frozen percentage), the
per-phase `n_total` is the real track count (not 0), and the weighted overall
percentage (`_PHASE_WEIGHTS` in `pymix/services/import_progress.py`: audio
80%, mapping_ids 5%, applying_metadata 15%) moves monotonically. The
`applying_metadata` phase itself wasn't caught mid-flight in this run — at 20
tracks it resolved between two 1.2s polls — but its `n_total`/label are
exercised by the metadata-only run below, which spends longer in it.

**Metadata-only path — the #55/#109 fix, the real-world repro.** New driver
`scripts/qa/rekordbox-metaonly-progress.mjs`. The metadata-only path uploads
*no* audio ever, so `n_tracks_for_import` is 0 on **every** run of it, not an
edge case — this is the path that made the old "0 tracks means nothing to do"
assumption wrong on every single use. Re-ran the same 20-track fixture (now
already in the library from the full-upload run above) as a metadata-only
import: the driver's `sawProgressScreen` flag came back `true` (`[0.5s]
Importing into library... | 80%` observed before completion) — it did **not**
skip straight to "done" the instant the upload POST returned, which is exactly
what #55 used to do. Final toast: **"Success / Library updated from your
Rekordbox XML"** — the new #109 copy for a metadata-only completion, not the
old "Imported 0 tracks" (which used to read like nothing happened, or worse,
like a failure). "Everything is already up to date" also rendered correctly
(0 uploaded, 0 net-new imported).

**Failure-path distinction (#48/pymix#133) — verified by code reading only,
not live-triggered.** `failure_reason()` (`pymix/services/import_progress.py`)
formats any exception into a short single-line reason and
`run_import_task`'s `finally` always calls `db_controller.job_completed(job_id,
success, reason)` with it, regardless of which phase raised — so the job row's
`phase` column is left wherever the exception happened, not force-moved to
`complete`. Client-side, `sync-rekordbox.tsx`'s failure screen reads exactly
that: `tracksAreSafe = failedPhase === 'applying_metadata' || failedPhase ===
'mapping_ids'` selects between "Imported, with problems" (audio landed, only
metadata/playlists missing — don't re-upload) and "Import Failed" (may not
have landed) title/copy, and a "Copy details" button surfaces
`reason`/`phase`/counts verbatim. Not live-triggered this cycle: forcing an
exception in the tail passes means deliberately breaking a real
job on the shared dev `pymix` container (currently the user's own
`main-20260821-local` build, confirmed idle but not disposable), which is a
different risk profile than driving the happy paths above. A future cycle
wanting to close this out could point a fixture's XML at a track whose
Name/Artist/Album match resolves to more than pymix's playlist-building code
tolerates, or add a temporary fault-injection hook — left as a follow-up, not
blocking the "Rekordbox import phase reporting" README row (the two behaviors
that row is actually about — phase reporting and completion honesty — are
both now live-verified).

## Driver notes

`scripts/qa/rekordbox-metadata-import.mjs`: stubs `dialog.showOpenDialog` in the
main process to resolve to `QA_XML_PATH` (Playwright can't drive a real OS file
picker); flips the persisted `store_app` Zustand `appMode` to `'sync'` + reloads
rather than clicking the mode toggle (a right-sidebar overlap can intercept the
click on some profiles); races "Upload Complete" against
`/import failed|failed to check import progress/i` with a bounded timeout so a
hang is reported as a real failure, never silently backgrounded.

`scripts/qa/rekordbox-import-phase-progress.mjs` /
`scripts/qa/rekordbox-metaonly-progress.mjs`: same login/navigation pattern,
but launch on a **cold** `--user-data-dir` profile (a warm one can come up with
the sidebar collapsed and the Sync switch unreachable) at 1440×900 — a smaller
content size (1280×860 was the original scratch value) intermittently landed
under the 768px mobile-Sync breakpoint (`useIsMobile`, `max-width: 768px`) and
rendered `MobileSyncPlaceholder` instead of the real Sync tabs, failing the
`uploadTab` wait. Both sample the progress screen's body text on a tight poll
loop and screenshot on every text change, so a stall shows up as a repeated
last line rather than silence.
