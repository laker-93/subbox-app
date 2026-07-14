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

### Delete track showed a success toast even when the delete failed

Found + fixed: 2026-07-14. Journey: song context menu → "Delete track" → confirm
(`scripts/qa/delete-track-journey.mjs`), account `test260526`.
Issue: https://github.com/laker-93/subbox-app/issues/18

**Bug.** pymix signals a failed delete **in the body, not the HTTP status**:
`DELETE /track` returns **200** with
`{"success": false, "results":[{"success": false, "reason": "…"}]}`. The client
threw that body away — `pymix-types.ts` declared the response schema as
`const deleteSong = z.null()` — and `PymixController.deleteSong` only checked
`res.status !== 200`. So the mutation resolved, and `delete-song-action.tsx`
fired the **success toast for a delete that never happened**. The user believes
the track is gone; it's still on disk and still in the library.

Reachable whenever pymix's beets state and the Navidrome library have drifted
apart (also confirmed directly against the API for any unknown/stale
`subbox_id`).

**Repro (live).** Import a scratch track via the watch dir, then create a
realistic desync by dropping its beets row only, leaving the file + Navidrome
entry: `docker exec beetstest260526 beet rm -f "subbox_id::<id>"`. Delete it in
the app. Before the fix: `DELETE /track` → 200 `success:false` (reason: a raw
`DockerException` — `beet rm -df … 'error: No matching items found.'`), UI showed
the **success** toast, file still at
`/private-music/test260526/QA Desync Probe/qa-desync-scratch/00 - ….mp3`.

**Fix.** `pymix-types.ts`: the `deleteSong` response schema now captures pymix's
`{success, results, reason}` instead of `z.null()`. `pymix-controller.ts`:
`deleteSong` throws when `success === false`, with the per-id reasons logged to
the console and a concise message for the toast. `delete-song-action.tsx` already
catches and shows an error toast, so nothing else changed.

**Re-verified live** (rebuilt `electron-vite build --mode development`, re-drove
the identical desync repro): the flow now shows **"Error / Failed to delete the
track"** and the track correctly stays listed. **Happy-path regression checked**
on a fresh scratch track: still exactly 1 request, success toast, and the file /
beets row / pymix rows all actually deleted. `pnpm typecheck` clean;
`pnpm lint-code` clean on the changed files (3 pre-existing errors remain in
older `scripts/qa/` drivers, untouched).

Noted, not a regression: a *failed* delete now fires 4 requests, because the
app's standing `mutations.retry: 3` policy (`renderer/lib/react-query.ts:24`)
only becomes reachable once the mutation actually rejects. Harmless (re-deleting
a gone id fails identically) and consistent with every other mutation.

Commit: see `claude/continuous-ux`. PR: https://github.com/laker-93/subbox-app/pull/19
Writeup: `features/delete-track.md`. Single-repo (subbox-app). The pymix half of
this story — a failed delete still commits pymix's DB-row deletion, orphaning the
file — is logged separately as pymix issue #30, and is **not** fixed.
