# Feature: Library → Artists browse → artist (album-artist) detail

**Verified 2026-07-10** by driving the built Electron app (development build,
pointing at the local stack) with `scripts/qa/artists-journey.mjs`, plus direct
calls to Navidrome's native (`/api/…`) and Subsonic (`/rest/…`) APIs to explain
what the UI shows. Client-only journey; no backend change. Account `test260526`.

## What was driven, and what happened

1. **Artists grid** (`/library/artists`). Renders a virtualized card grid
   (~33 cards in DOM at a time). **Unlike album cards, artist cards do not carry
   a `/library/artists/:id` anchor** — they link to
   `/library/album-artists/:id`. Clicking one navigates to the **album-artist
   detail** page (see below). Cover art loads via `/rest/getCoverArt.view?id=ar-…`.
2. **Artist detail** = the album-artist detail route
   (`/library/album-artists/:albumArtistId`). Header: artist image (or a person
   placeholder), the label **ALBUM ARTIST**, the name, `N albums • M tracks`,
   **Play / Next / Last** buttons, star rating, favorite heart, `…` menu,
   **VIEW DISCOGRAPHY / VIEW ALL TRACKS / ARTIST RADIO**, and **EXTERNAL LINKS**
   (last.fm / MusicBrainz-ish / ListenBrainz / Spotify icons).
3. **Sub-routes**: `…/top-songs` (a "Top Songs From <name>" table with the same
   columns as a song list) and `…/discography` (album card carousel) both
   render without error.

## Key facts (verified against the live APIs)

- **"Artists" and "Album Artists" are two different lists on Navidrome.**
  - `getAlbumArtistList` ("Album Artists" nav) → Subsonic-style **album-artist
    index**: 61 artists, every one has ≥1 album.
  - `getArtistList` ("Artists" nav) → Navidrome **native** `/api/artist`
    (`?_end=…&_start=…&missing=false`, no role param) → **85 artists**, i.e. all
    credited artists across *every* role (album-artist, artist, composer, …),
    ~24 more than the album-artist index.
- Both artist cards and album-artist cards route to the **same** album-artist
  detail page (`getTitlePath`/`getItemNavigationPath` map `ARTIST` data — whose
  `_itemType` is `ALBUM_ARTIST` on Subsonic/Navidrome — to
  `LIBRARY_ALBUM_ARTISTS_DETAIL`). So on Navidrome the two nav items differ only
  in which *list* they show; the detail experience is identical.

## Known friction (logged, not fixed) — role-only artists → empty detail

See `ux-notes.md` "Artists list shows role-only artists whose detail page is
empty (0 albums / 0 tracks)". Short version: the "Artists" list includes artists
credited **only** via non-album-artist roles (e.g. **composers**). Example:
**"Marco Masis"** shows in the Artists grid with **1 album · 1 song** (native
`/api/artist` counts his composer credit), but his album-artist **detail page
shows "0 albums • 0 tracks"** and the top-songs sub-route is empty, because the
detail is album-artist-centric and he is not the album artist of anything. Play
on such an artist does nothing (queues a silent/empty source). This is default
behaviour (no user filter involved) and affects the ~24 role-only artists.

## Driver / harness notes

- `scripts/qa/artists-journey.mjs`: launches the built app, forces a clean
  Library view (resets `store_app.appMode='library'` and
  `sidebar.rightExpanded=false` — a prior cycle's playback can leave the
  right-hand **queue panel** open at 600px, and the fullscreen queue overlay
  makes the grid look empty), clears any persisted Artists **Role** filter
  (`${serverId}-filters` localStorage → `{artist:{role}}`, though it was empty
  this run), then clicks the first card and reads the resulting URL rather than
  guessing the href.
- The artist **list** is served by the Navidrome **native** API under `/api/…`,
  **not** `/rest/…`. A network probe that only watches `/rest/` sees zero
  artist-list traffic (just `getCoverArt`) and can be fooled into thinking the
  grid is served from cache — it is not.
