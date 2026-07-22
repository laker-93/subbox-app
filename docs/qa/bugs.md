# Bug log (subbox-app)

Correctness bugs only — things that are outright wrong. For rough-but-working
UX friction, use `ux-notes.md` instead. See `README.md` for the conservative
fix policy before touching either an OPEN entry or committing a FIXED one.

**Archiving (do this when you close a bug):** this file is re-read on every turn
of every cycle, so keep it to `OPEN` entries plus the compact **Closed** index at
the bottom. When you move a bug to FIXED, put its **full text verbatim** in
`bugs-archive.md` (which the loop never reads) and add **one line** to the Closed
index here (date | title | verdict | issue/PR). The one-liner is enough to stop a
future cycle re-investigating; the archive has the detail if ever needed.

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

**2026-07-21 attempt (inconclusive, no issue filed).** Tried the packaged-app
route to rule out the harness explanation: `electron-vite build --mode
development` + `electron-builder --dir` (unsigned, arm64, `--config.mac.identity=null`
— arm64 electron-builder warns signing is normally required but the unsigned
`.app` still launches fine locally), then Playwright `_electron.launch` with
`executablePath` pointing at the real `Subbox.app` binary. Confirmed this route
resolves the **real** app identity (`app.getName()` → `subbox`, matching
`productName` in `electron-builder.yml`) unlike the bare `out/main/index.js`
launch every other driver uses — so it's a genuinely different code path from
the `app.getName()` artifact in `features/sync.md`. **Caution for next attempt:**
a first run without `--user-data-dir` reused the machine's real, persistent
`~/Library/Application Support/subbox-dev` profile (auto-logged-in, real
playlists) rather than an isolated one — always pass
`--user-data-dir=/tmp/<scratch>` to `electron.launch({ args: [...] })` when
using `executablePath`, confirmed that isolates cleanly and a fresh login still
lands on the same `test260526` library (playlist names match — they're
server-side, not local). Never got to a clean repro attempt this cycle: hit an
unrelated first-run "settings sync" restart toast
(`error.settingsSyncError`, fires ~5s after mount whenever the main-process
electron-store has no prior config to compare against, i.e. any fresh profile —
see `use-sync-settings-to-main.ts`) that ate click-target space, and the driver
hung/timed out reaching the songs list via a sidebar-text click. Ran out of
cycle time debugging harness plumbing rather than the actual bug. Scratch probe
script was not kept (deleted, not committed). **Still needs real interactive
`pnpm dev` usage to confirm** — the packaged-Playwright route is not obviously
faster than that at this point.

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

## Closed (full detail in `bugs-archive.md`)

<!-- One line per FIXED bug: date | title | verdict | issue/PR. Full text lives
     in bugs-archive.md, which the loop never reads. -->

- 2026-07-21 | Watch uploader "restores UI but never re-arms watcher" on relaunch | NOT A BUG — app.tsx already auto-resumes at boot (since 2026-06-05); re-verified live via watch-resume-relaunch.mjs | issue #23 (closed not-a-bug)
- 2026-07-14 | Delete track showed a success toast even when the delete failed | FIXED (client captured pymix's 200+`success:false` body; throws on failure) | issue #18, PR #19
- 2026-07-22 | External Drive "Download Missing Tracks" — misdiagnosed as ignoring drivePath (it doesn't; drive is compare-only by design) | NOT A ROUTING BUG — real defect was misleading tooltip/copy claiming tracks land on the drive; fixed by rewording copy + adding Rekordbox XML export, not by changing where files are written; full writeup `features/external-drive-sync.md` | issue #27, PR #29 (supersedes closed PR #28, which had wrongly routed downloads to drivePath)
