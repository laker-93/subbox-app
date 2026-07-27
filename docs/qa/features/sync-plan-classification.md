# Sync-plan classification — no false "missing locally" (regression)

Verified 2026-07-27 driving Electron directly against the local dev stack, test
account `test260526`, `pymix` container **not rebuilt** (already carries the
change-A fix — `docker exec pymix grep -c matched_subbox_ids
/app/pymix/routers/sync.py` → 3). Client build: `../feishin` `development` @
`65e064ae`, built fresh via `electron-vite build --mode development` and driven
via `QA_APP_ENTRY`. Drivers: `scripts/qa/sync-plan-classification.mjs` +
`scripts/qa/make-dup-playlist.mjs`. Skill: `test-sync-plan-matching`.

This doc didn't exist before this cycle even though the skill and test plan
(`subbox-workspace/docs/testplans/sync-plan-false-missing.md`) reference it —
the fix branches (pymix `add-subbox-id-recovery-scripts`, subbox-app
`fix/sync-plan-false-missing-tracks`) were squash-merged into their bases at
some point (confirmed live: `watchPaused`, `subboxDir`, `stream/promises`, and
the recursive `walk`/`processAudioFile` scan are all present in `development`
HEAD; `git merge-base --is-ancestor` says the old branch isn't a literal
ancestor, consistent with a squash merge), but nobody had re-run the plan since
to write up the doc. This cycle closes that gap.

## Fixture drift from the original test plan (important for future runs)

The test plan's fixtures assume the **old** `test260526` state — a "Kodzo"
playlist and an ~873-track local library. Neither exists anymore:
`navidrome-data` was namespaced per-user and `test260526`'s container recreated
from scratch on 2026-07-25 (pymix-qa issue #41), replacing all named playlists
with 30 auto-generated **"QA Load Test / QA Load Test NN"** playlists (~85
tracks each), and the local dev library
(`~/Library/Application Support/subbox-dev/music`) is now just 18 files across
5 artist folders (leftover from other test sessions), not the original library.
**Use a `QA Load Test NN` playlist as `QA_SOURCE_PLAYLIST`/`QA_PLAYLIST`, not
`Kodzo`,** and expect very low overlap between any one playlist and the local
18 tracks (playlist 01: 1/85 present) — resolve a present track's song id first
(`QA_LIST_EXISTING=1` report-only run, or query `getPlaylist.view` directly) and
pass it explicitly as `QA_SONG_ID` rather than relying on
`make-dup-playlist.mjs`'s "first song of source playlist" default, which is very
likely to pick a track that isn't present locally and silently make the test
fixture invalid (every occurrence "genuinely missing", not proving anything).

## Test A/1 — duplicate `subbox_id` in one playlist (change A, pymix)

**Purpose:** a playlist listing the same locally-present song N× must classify
all N occurrences as present, not just the first (pre-fix: occurrences past the
first fell through to "missing").

**Fixture:** resolved a present track from `QA Load Test / QA Load Test 01`
("Zion y Lennox ft. Daddy Yankee — Yo Voy (Luca Durán Rework)", id
`B127fpEDhnNYkDDHz1ilRU`), built "QA Dup Test" (3× the same song) via
`make-dup-playlist.mjs`, then ran the classification driver:

```
tracks requested:      3
already present:       3
MISSING (to download): 0
OVERALL: PASS
```

**Result: PASS, no regression.** Scratch playlist deleted after (subsonic
`deletePlaylist.view`) — account left clean.

## Test B/2b — recursive-walk sweep (change B, subbox-app), no fixture

**Purpose:** the recursive `scanLocalTracks` rewrite must still discover all
local tracks across mixed depths without crashing.

Every run above (`localTracks: real scan via sync:get-local-tracks (18
tracks); 17 carry a subboxId`) confirms this on today's library: 18 files
found, no crash, only one benign warning (a genuinely-corrupt fixture MP3,
`Various Artists/Wipeout 3/13 - Sasha - Xpander.mp3`, "MPEG audio header not
found" — logged and skipped, not a scan failure; pre-existing file, not
created by this cycle). **Result: PASS, no regression.**

Full physical-relocation Test B/2 (move a track up one level, confirm it's
still found) and Test C (watch/download concurrency) were **not** re-run this
cycle — B/2b already answers the regression question for change B on today's
data, and C has its own more-recently-dedicated coverage via the
`test-watch-download-concurrency` skill (`features/watch-download-concurrency.md`,
verified 2026-07-11). Fair game for a future cycle.

## Driver gotcha: intermittent session-bootstrap flake

Across ~4 fresh Electron launches this cycle, the driver's "Preview Download"
UI-bootstrap step (`sync-plan-classification.mjs`) failed non-deterministically
(~50%) with `WARNING: preview button not enabled; session may not bootstrap` →
subsequent `POST /sync/plan` 401s, no product code involved. Retrying the exact
same command with no changes succeeded. Not chased further — looks like
first-launch cold-start timing (extension loading / devtools protocol noise
visible in the main log around the same window) rather than a UI defect, and
real users don't repeatedly cold-launch fresh dev builds the way this driver
does. If a future cycle sees this often enough to be worth fixing, the fix is
likely a longer/smarter wait before the row-click + preview-button steps in the
driver, not product code.
