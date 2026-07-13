# Bug log (subbox-app)

Correctness bugs only — things that are outright wrong. For rough-but-working
UX friction, use `ux-notes.md` instead. See `README.md` for the conservative
fix policy before touching either an OPEN entry or committing a FIXED one.

## OPEN

<!-- One entry per bug. Include: date found, journey/route it showed up on,
     repro steps, evidence (screenshot path / console error), your hypothesis
     for root cause + which repo owns it, and an `Issue: <github url>` line
     (every bug gets a qa-bug tracking issue — see README hard rules / skill
     Step 1½). Remove an entry (move to FIXED) once actually fixed and verified,
     don't just mark it done. -->

### (unconfirmed — needs real-usage repro) Player-bar favorite button appears inert for the now-playing song

Added: 2026-07-11. Found on the Library → Songs → play → Favorites journey
(`scripts/qa/songs-favorites-journey.mjs` + `scripts/qa/_probe-fav.mjs`),
account `test260526`.

**Symptom (reproduced across 3 runs).** While a track plays, the player-bar
FavoriteButton (`right-controls.tsx` `FavoriteButton`, tooltip
"Favorite"/"Unfavorite") shows the current song as **un-favorited even for
tracks that are already starred** (present in `/favorites`). Clicking it does
not flip its state, and the favorites list is unchanged after a supposed
add/remove. In `_probe-fav.mjs`, clicking the button (via its found handle)
fired **0** `star.view`/`unstar.view` **requests** (captured at the request
level) and the tooltip stayed "Favorite".

**Evidence.**
- Journey run: now-playing scratch track "00 - _unknown - _unknown.4" was in
  `/favorites` (present-after-add = true), yet button tooltip read "Favorite"
  through both the add and the remove clicks; favorites row count stayed 12,
  track still present after "remove".
- Probe run: track playing (`audio.paused=false`), button found, click → **0**
  star/unstar requests, no state change. Endpoint confirmed as `star.view` /
  `unstar.view` (`subsonic-api.ts:28,270`), so the driver's matcher would have
  caught a real request.

**Hypothesis.** The favorite wiring itself is correct (create-favorite mutation
→ `USER_FAVORITE` event → `audio-players.tsx` → `updateQueueFavorites`; and
`subsonic-normalize.ts:209` sets `userFavorite` from `starred`). The only way a
click fires **no** request is `handleToggleFavorite`/`handleAddToFavorites`
hitting the `if (!song?.id) return` guard — i.e. `usePlayerSong()` /
`getCurrentSong()` returns an **undefined or id-less** current song at click
time (the button still renders, and its tooltip falls to "Favorite" when
`currentSong?.userFavorite` is undefined), even though audio plays via the
separate player1/player2 path. That would also explain the never-filled icon.

**Why NOT filed as a GitHub issue / fixed this cycle.**
1. **Only observed under the Playwright bare-`out/main` launch.** This harness
   has produced a launch-specific *false lead* before (the `app.getName()` /
   userData-path artifact — see `features/sync.md`, log 2026-07-09 13:35). The
   known artifact is narrow (getName/userData) and doesn't obviously touch the
   renderer player store, so this is *more* likely real than that one — but it
   still must be confirmed in real `pnpm dev`/packaged usage before treating it
   as a product defect.
2. **Flaky repro.** The hover-tooltip button finder found the control in 3 of 4
   runs (1 NOT-FOUND), and the "0 requests" result was captured once. A stable
   locator is needed to nail it down.

**Next step (for a future cycle or the user).** Confirm in a real
`pnpm dev`/packaged session: play a track that IS favorited and check whether
the player-bar heart shows filled/"Unfavorite"; then toggle it and watch for a
`star.view`/`unstar.view` request. If it reproduces there, file a `qa-bug`
issue and it's a real single-repo (subbox-app) fix; if it doesn't, it's another
harness artifact — document alongside the sync.md one and close. **No issue
filed yet by design** — see reasoning above; do not auto-backfill one until
confirmed in real usage.

### (informational, not urgent) Playlist "Kodzo" has a duplicate track server-side

Added: 2026-07-09. Found while validating pymix#22's new
`subbox_id_divergence` signal for real (see `directives.md`).

Test account `test260526`'s "Kodzo" playlist has two distinct server tracks
with identical title/artist/album ("Damager (Hamdi Edit)" — Sammy Virji &
Interplanetary Criminal — DUBSTEP DELUXE (LDS 246)), each with its own
`subbox_id`. Downloading the playlist fetches one; the second then shows as
"missing" on the next preview forever (correctly — its distinct subbox_id
genuinely has no local match), and would be re-downloaded as an apparent
duplicate if the user did.

Not filing as a bug to fix — this is a data question (is the duplicate
intentional, a re-import artifact, two different masters of the same
track?), not a code defect, and out of scope for the sync-matching
directive. Flagging here so it isn't mistaken for a `subbox_id_divergence`
false positive if seen again — it's a real, correctly-flagged case.

## FIXED

<!-- One entry per fix: date, one-line description, commit SHA on this
     branch, and a note on how it was re-verified. -->

_(none yet)_
