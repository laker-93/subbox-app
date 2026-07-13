# Feature: Library → Genres browse → genre detail (album/track target) → play

**Verified 2026-07-13** by driving the built Electron app (development build,
pointing at the local stack) with `scripts/qa/genres-journey.mjs`, cross-checked
against Navidrome's Subsonic (`/rest/…`) and native (`/api/…`) APIs. Client-only
journey; no backend change. Account `test260526`.

## What was driven, and what happened

1. **Genres grid** (`/library/genres`). Renders a virtualized list/grid of genre
   cards; each card links to `/library/genres/:genreId`. This run saw 18 anchors
   in the DOM at a time (virtualized). Live library has **63 genres** (Subsonic
   `getGenres` / native `/api/genre` agree).
2. **First-card nav** works: clicking the first grid genre navigates to
   `/library/genres/:genreId` (the app's first grid genre is **"Dance"**, id
   `01T2kwzyeJQraLbr1InhLz` — note it has only **1 song / 1 album**, a poor
   content test, which is why the driver deep-links to a rich genre below).
3. **Genre detail** (`/library/genres/:genreId`). Header = `GenreDetailHeader`:
   a header **Play** button, the genre name as title, an item-count **Badge**, a
   search input, and a `FilterBar` carrying the **genre-target toggle** + sort.
   The body is either an album grid or a song table depending on `genreTarget`.
   Verified against **"Electronic"** (id `7bLYq0Np81m1Wgy5N31nuG`, 146 songs / 60
   albums):
   - **Target = TRACK (default)** → a `SongListView` scoped to the genre. Badge
     read **146**, 13 song rows rendered (ag-grid virtualizes; `[role="row"]`
     count ≈ visible rows). Matches the API's 146 songs for Electronic.
   - **Toggle → ALBUM** → an `AlbumListView` scoped to the genre. Badge read
     **60**, 24 album cards rendered. Matches the API's 60 albums.
4. **Play a track**: double-clicking the first data row started a real Navidrome
   stream (`/rest/stream.view?id=…`), `audio.paused=false`, `currentTime`
   advancing (e.g. 2.8s → 34s across runs), player bar showing the genre track
   ("Kai Whiston — Quiet as Kept, F.O.G."). Playback of a genre-scoped list uses
   the same shared queue/player path as `albums-browse-and-play.md` /
   `songs-browse-and-play.md`; it is only *scoped* by `genreIds`, not a distinct
   code path.

**No bug found.** Grid, detail (both target modes), the target toggle, and
playback all behave correctly. Badge counts match the live API exactly.

## Key facts (verified against source + live)

- **`genreTarget` is a global setting, not per-genre.** It lives in the persisted
  settings store (`store_settings` → `state.general.genreTarget`: `'track' |
  'album'`; **default `'track'`** — `settings.store.ts`). The genre detail route
  picks `ItemListKey.GENRE_SONG` vs `GENRE_ALBUM` from it
  (`genre-detail-route.tsx`), and the same value drives the header Play button
  variant. Because it's persisted and global, it carries across genres **and
  across app launches** — a driver must force it deterministically (the driver
  writes `genreTarget='track'` before deep-linking).
- The **target toggle button** (`toggleGenreTarget` prop on
  `Song/AlbumListHeaderFilters`) labels itself with the **current** target
  ("Tracks" while showing tracks, "Albums" while showing albums), with an
  ⇄ (`arrowLeftRight`) icon — i.e. it shows the mode you're in, and clicking
  flips it. Same shared control as the plain library Songs/Albums pages, so not
  genre-specific friction; documented here as expected behavior, not logged as a
  UX note.
- **The header Play button does not play on a single click** — it's an icon-only
  `DefaultPlayButton` (`LibraryHeaderBar.PlayButton`) whose `onClick` opens a
  `PlayButtonGroupPopover` offering **Add next / Play / Add last** (the filled
  middle button is Play Now). A real user clicks it, then picks a play mode. This
  is the app-wide header-play pattern (same on library Songs/Albums), not
  genre-specific.

## Driver / harness notes

- `scripts/qa/genres-journey.mjs`: forces a clean Library view (appMode='library',
  right queue collapsed), forces `genreTarget='track'`, verifies the grid + a
  real first-card click, then **deep-links to a rich genre** (`QA_GENRE_ID` env,
  default Electronic `7bLYq0Np81m1Wgy5N31nuG`) for the detail/toggle/play checks.
  Reads the header **Badge** and the store `genreTarget` at each step to
  disambiguate which view is showing.
- **ag-grid data rows report `height: 0`** in this Playwright build (the row
  element is 0-height; the visual row is drawn downward from `box.y`). A
  coordinate double-click at `box.y + box.height/2` lands on the row's top edge
  and misses; double-click at **`box.y + ~18`** to hit the first visible row.
  (Same 0-height quirk noted in `songs-browse-and-play.md` — that journey worked
  around it with the header Play instead.)
- The header Play button is icon-only with **no accessible name**, so
  `getByRole('button', {name:/play/})` can't find it; target the CSS-module class
  `…-text-button-…` (kebab-cased in the dev build) instead. The popover's Play-Now
  option is the button with class `…-play-button-module-fill`.
- Order matters: drive the **target toggle before playback** — an open play
  popover otherwise sits over the toggle and swallows the click.
