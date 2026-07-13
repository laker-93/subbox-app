# Feature: Full-page Search (`/search/:itemType` — Tracks / Albums / Artists)

**Verified 2026-07-13** by driving the built Electron app (development build,
pointing at the local stack) with `scripts/qa/search-journey.mjs`. Client-only
journey; search hits Navidrome's Subsonic `search3`, not pymix. Account
`test260526`.

## The two distinct search surfaces (don't confuse them)

- **Full-page search** — `/search/:itemType`, this doc. Reached via the
  magnifier ActionIcon at the **top-right of the content header** (next to the
  "Search" title). Header has a `Tracks / Albums / Artists` tab group + a
  `SearchInput`; results render in the same virtualized list/grid components as
  the library pages (`SongListView` / `AlbumListView` / `AlbumArtistListView`),
  fed an `overrideQuery.searchTerm` from the URL `?query=` param
  (`search-content.tsx`).
- **Global command palette** — the readonly **"Search" box in the sidebar
  top-left**. Clicking it opens a cmdk modal with `Albums / Album Artists /
  Tracks / Commands` (Search…, Create playlist…, Go to page…, Server
  commands…). Separate feature, not covered here.

## What was driven, and what happened

Term **"Hamdi"** (matches songs, an album, and the Hamdi artist) + edge terms.

1. **Tracks tab** (`/search/song?query=Hamdi`). 4 result rows; table mentions
   "Damager (Hamdi Edit)" — correct. Box shows "Hamdi".
   Screenshot `qa-search-songs-match-*.png`.
2. **Albums tab** — clicked the real **Albums** tab button (a `<Link replace>`
   that preserves `?query=`). 2 album cards, both by Hamdi
   (`[Unknown Album]`, `Top Streamed Tracks 2024: …`). Screenshot
   `qa-search-albums-match-*.png`.
3. **Artists tab** — clicked the **Artists** (album-artist) tab. Renders the
   matching artist card(s). Screenshot `qa-search-artists-match-*.png`.
4. **No-match edge** (`?query=zzqqxnomatchzz`). Results grid correctly empty
   (0 data rows), **no crash / no error boundary**. Screenshot
   `qa-search-no-match-empty-*.png`.
5. **Empty query** (`?query=`). Renders the full library list (13 song rows /
   album+artist anchors), no crash — behaves like an unfiltered list.

All five states behave correctly. Cross-checked term selection against the
live Navidrome `search3` API (see driver header) so the expected match counts
are real, not assumed.

## Notes / gotchas for a future cycle

- **The `SearchInput` is a collapse-to-expand magnifier**, and its `<input>`
  is uncontrolled (`defaultValue` read at mount). Automating the expand+type
  widget via Playwright is flaky; because `SearchContent` reads `?query=`
  straight from the URL, **deep-linking the query is the reliable,
  behaviour-equivalent programmatic entry** and is what the driver uses. Tab
  switching is still driven by real button clicks.
- A naive `document.querySelector('input[type=text]')` grabs the **sidebar
  command-palette** readonly box (value `""`), not the header search box — read
  results from the grid/anchors, not from that input's value.
- Two UX-friction items were logged this cycle (both `ux-notes.md` OPEN, not
  fixed — subjective / upstream-shared): no "no results" empty-state message on
  a zero-match query; and the search box text going stale vs. the active
  results when the query changes via navigation rather than typing.
