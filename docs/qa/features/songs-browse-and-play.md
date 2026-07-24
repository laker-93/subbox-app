# Feature: Library → Songs (Tracks) browse → play; Favorites list

**Verified 2026-07-11** by driving the built Electron app (development build,
pointing at the local stack) with `scripts/qa/songs-favorites-journey.mjs` +
`scripts/qa/_probe-fav.mjs`. Client-only journey; account `test260526`.

## What was driven, and what happened

1. **Songs list** (`/library/songs`, labelled **"Tracks"** in the sidebar).
   Renders a virtualized ag-grid table with a "Tracks 78" count badge, a
   header row of sortable columns (`# / TITLE / ⏱ / ALBUM / GENRE / YEAR / BPM /
   ♥`), a sort control ("Name" ▲), a filter button, refresh, a display-type
   toggle, and **bottom pagination** (page 1 highlighted) — this list paginates
   rather than infinite-scrolls. Screenshot: `.ui-snapshots/qa-songs-list-*.png`.
   - The server (Navidrome) library for this account currently holds **78
     tracks** (the "774" figure in the journal README is the *client's local
     filesystem* count — a different thing from the Navidrome `media_file`
     count, which recent pymix cycles tracked climbing 77→78).
   - Rows 1–6 are stripped-metadata scratch imports left by earlier QA cycles
     ("00 - _unknown - _unknown[Unknown Artist] [Unknown Album]", default blue
     vinyl art). Rows 7+ have real tags/art (e.g. "1 on 1 / Empire", Electro,
     2005, 140 BPM; a Trance track, 2023, 76 BPM). Not a bug — test-data
     pollution; noted so a future cycle doesn't mistake it for missing metadata.

2. **Play from the list** — double-clicking a track row starts real playback:
   `<audio>.paused=false`, `currentTime` advances, and the player bar fills in
   title/artist/album + the `M:SS / M:SS` counter. Verified on both a scratch
   track and the real "1 on 1 / Empire" track (bar read
   "1 on 1 … Distance … 1 on 1 / Empire … 5:07").

3. **Favorites list** (`/favorites`, defaults to Songs / favorite=true) renders
   the account's starred songs in the same table layout (12 rows at time of
   run, including the scratch `_unknown` tracks and "1 on 1"). Navigating there
   after playing shows the list correctly.

## Driving notes (for future cycles — ag-grid interaction quirks)

- **ag-grid rows have a 0-height `[role="row"]` wrapper.** Its `boundingBox()`
  is meaningless (every row reports the same top-of-grid box, height 0), and
  Playwright's actionability check reports the row "not visible" even though it
  renders fine on screen. So `locator(...).dblclick()` on a row **times out**,
  and coordinate-based clicks must use an *absolute* on-screen `y` (well down
  the list) rather than a row's reported box. `songs-favorites-journey.mjs`
  starts playback via the header **Play** button (reliable) with a
  coordinate-dblclick fallback; `_probe-fav.mjs` double-clicks at a fixed
  screen `y` to land on a real-metadata row.
- The **player-bar FavoriteButton** is a react-icons `LuHeart` SVG with no
  text/aria and inline row hearts carry no tooltip either. The original
  hover-tooltip finder was unreliable (flaky NOT-FOUND, stale-handle clicks).
  `_probe-fav.mjs` (rewritten 2026-07-24) instead locates it by its SVG
  heart-path `d` signature and clicks live-computed coordinates — reliable
  across 9 fresh-launch trials.

## Confirmed bug (see bugs.md, issue #38)

The player-bar favorite button reliably fires a real `star.view`/`unstar.view`
request on every click (the earlier "completely inert, 0 requests" hypothesis
was a false lead from the old hover-tooltip finder, and is retracted). But
un-favoriting the now-playing track fails to visually update the icon in ~60%
of trials (3/5) — it keeps showing "favorited" indefinitely — while favoriting
is reliable (4/4). Root cause not yet nailed down (see `bugs.md` for the
hypothesis); not fixed this cycle, tracked as issue #38.

Coverage: **Songs list render + play — verified.** **Favorites toggle round-trip
— confirmed buggy** (add works; remove often doesn't reflect — issue #38).
