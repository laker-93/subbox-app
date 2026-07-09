# Sync (Rekordbox ↔ Subbox), Download side

Verified 2026-07-09 against subbox-app `claude/continuous-ux` (rebased onto
`development` @ ec1bcf4c) driving Electron directly, and pymix rebuilt from
`claude/continuous-ux` (rebased onto `main` @ 99a7ffe, image
`laker93/pymix:qa-local`) in the local dev stack. Test account `test260526`
(774 real local tracks, most already SUBBOX_ID-tagged from prior real usage).

## UI path

Library/Sync segmented control (top of main content area, always rendered) →
"Sync" → tab bar: "Upload (Rekordbox)" (default tab), "Download", "Watch",
"External Drive". This doc covers **Download**.

Download tab: playlist checklist (`Select all` / `Select none` /
per-playlist checkbox rows showing name + track count) → "Preview Download"
(disabled until ≥1 playlist selected) → plan screen (counts: requested /
already present / missing / metadata updates / total download size, plus
expandable Missing / Already Present / Conflicts / Metadata Updates
sections) → "Download & Extract".

## What "Preview Download" actually does (client)

Confirmed live: clicking it triggers a **client-side local library scan**
first ("Generating sync plan..." state) — this is `scanLocalTracks()`
reading every local file, which for SUBBOX_ID purposes means opening each
file with TagLib **unless it's already in the on-disk subboxId cache**
(`electron-store`, keyed by path+mtime+size — see subbox-app #14). On a
cold cache (774 local files, first scan since this worktree/build was set
up) this took **under ~15s** end-to-end including the network round trip —
not instant, but not alarming either. A warm-cache re-run should be
noticeably faster; not yet verified (see Next steps).

Once the scan finishes, the client calls `POST /sync/plan` with the
selected playlist(s) and all 774 local tracks (each now carrying a
`subboxId` when the file had one).

## What pymix does with it (server)

Confirmed via pymix's own logs (`sync.py`), not just source reading:

- Of 774 local tracks sent, 759 carried a `subboxId` (the other 15 didn't —
  presumably never tagged). The 759 tagged ones are matched directly against
  the requested playlist's server tracks by `subbox_id` (O(1)); only the 15
  untagged ones go through the old fuzzy title/artist match.
- Result for playlist "Kodzo" (9 server tracks): 8 already present, 1
  missing, 1 metadata update — identical to what the **pre-PR fuzzy-only
  server** produced for the same request, confirming the fast path doesn't
  change the actual sync outcome, just how it gets there.
- **Known logging bug found here**: pymix logs `subbox_id_match_summary` at
  ERROR level almost every time for a real library (see
  `../pymix-qa/docs/qa/bugs.md` — the denominator isn't scoped to the
  requested playlist, so it fires on any sync where the local library is
  bigger than what's selected). Don't treat that ERROR log alone as a signal
  something is wrong — the actual sync result is what to check.

## Verified safe (not a bug, checked while investigating something that looked worrying)

`unzipAndMerge()`'s cache-priming for newly-downloaded files
(`cacheSubboxIdsForNewFiles`, subbox-app #14) reads each file right after the
zip parser's `finish` event, which *could* race a per-entry write stream
that hasn't flushed yet. Traced through the code: this is self-healing even
if it does — the cache key is `(path, mtimeMs, size)`, so if a file is read
mid-write, the stat captured then won't match the file's final (fully
flushed) stat, causing a correct cache miss and re-read on the next scan.
Worst case is one wasted reopen per affected file, not incorrect data.
`readSubboxId()` also catches all errors and returns `null`, so a read of a
truly-incomplete file just means "no id yet, try again next scan," not a
crash or bad cache entry.

## Not yet verified (next steps for a future cycle)

- `sync/playlists` (actual "Download & Extract") — only `sync/plan`
  (preview) has been driven so far.
- Warm-cache re-scan timing (does the second scan actually skip TagLib
  reads for unchanged files, and is it meaningfully faster).
- Cache invalidation (edit/touch a file, confirm re-read) and pruning
  (remove/move a file, confirm cache entry dropped).
- Fuzzy fallback correctness for untagged local tracks in isolation.
- The unexplained first-click 400 (see `ux-notes.md`) — reproduced twice,
  not yet root-caused.
- yt-dlp cookie auth (bundled in pymix #21, unrelated to sync) — not tested
  this cycle; local dev has no cookies file mounted, confirmed it degrades
  gracefully (`ytdlp_support.py` warning logged at startup, no crash) but
  the actual cookie-auth path itself needs prod-like conditions to test.
