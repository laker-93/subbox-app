# Feature: Library → Album Artists browse → detail → sub-routes → play

**Verified 2026-08-03** by driving the built Electron app (development build,
pointing at the local stack) with `scripts/qa/album-artists-journey.mjs`.
Client-only journey; no backend change. Account `test260526`.

This is the dedicated **Album Artists** nav item (`/library/album-artists`),
distinct from the **Artists** nav item covered in `artists-browse.md` — both
ultimately land on the same album-artist detail route, but this journey drives
the flow via its own direct entry point rather than via an Artists-grid card
click, and exercises the sub-routes unique to this route family (`songs`,
`favorite-songs`, `top-songs`, `discography`).

## What was driven, and what happened

1. **Album Artists grid** (`/library/album-artists`). Renders a virtualized
   card grid (33 cards in DOM at a time, **634** total at time of test — grown
   from 228 at the 2026-07-13 check via ongoing upload/import testing). Sort
   control present (Name, ascending/descending, refresh). No empty-state
   issue — populated as expected.
2. **Detail** (`/library/album-artists/:id`). Clicking the first card (Hamdi)
   navigated correctly: header shows the artist image, **ALBUM ARTIST** label,
   name, "2 albums • 8 tracks", Play/Next/Last buttons, star rating, favorite
   heart, `…` menu, VIEW DISCOGRAPHY / VIEW ALL TRACKS / ARTIST RADIO links,
   and EXTERNAL LINKS icons (last.fm/MusicBrainz/ListenBrainz/Spotify).
3. **Sub-routes**, all rendered without error and with real data (no
   `[subbox]`-unrelated 404/`InvalidRoute` fallback):
   - `.../songs` — 9 rows (all tracks across both albums).
   - `.../favorite-songs` — 1 row (the one favorited track).
   - `.../top-songs` — 3 rows.
   - `.../discography` — 5 album-card links in a carousel (no `[role=row]`
     rows, expected — it's a card layout not a table, same as
     `artists-browse.md`'s discography finding).
4. **Play from detail**. Clicking Play started real playback — `audio`
   element advanced to `2.5s`, not paused, player bar showed the correct
   track/artist ("Simplicity Original Mix … — Hamdi").

No bugs or friction found — this route family works cleanly end-to-end via its
own direct nav entry point, consistent with the shared album-artist detail
page already verified in `artists-browse.md`. Because the Album Artists index
is (by construction) restricted to artists with ≥1 album, the role-only-artist
empty-detail friction documented against the **Artists** nav item
(`ux-notes.md`) does not apply here — every card in this grid has a non-empty
detail.

## Driver / harness notes

- `scripts/qa/album-artists-journey.mjs`: same clean-Library-view reset
  pattern as `artists-journey.mjs` (forces `appMode='library'`,
  `sidebar.rightExpanded=false`), then drives `/library/album-artists`
  directly rather than via an Artists-grid card.
