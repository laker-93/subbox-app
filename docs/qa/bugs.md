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

### (latent, NOT user-reachable — no issue filed by design) `PymixController.syncTracks` posts to the wrong path

Added: 2026-07-22. Found while driving the pymix-qa `Sync` coverage row
(`../pymix-qa/docs/qa/features/sync.md`).

**Observation.** `pymix-api.ts`'s `syncTracks` definition
(`src/renderer/api/pymix/pymix-api.ts:159-167`) sets `path: 'sync'` —
identical to the plain `sync` action right above it (line 135) — instead of
`'sync/tracks'`. The two client actions exist to reach two different backend
matchers (`POST /sync` = single-stage `get_track_match`; `POST /sync/tracks` =
lenient multi-stage `query_tracks_by` → fallback `query_track_by_name`,
verified live in `../pymix-qa/docs/qa/features/sync.md`), but as written
`syncTracks` would silently hit the stricter `/sync` matcher instead.

**Why NOT filed / fixed.** `grep -rn "syncTracks\b" src/` finds zero call
sites outside `pymix-api.ts`/`pymix-controller.ts`/`pymix-types.ts`
themselves — no `features/` component ever invokes
`PymixController.syncTracks`. Same shape as the pymix-qa serato
`playlistIds`-ignored finding and the `/match/tracks` #28→#29 dead-duplicate
removal: repairing unreachable surface risks becoming its own bug if the real
fix (wiring up an actual caller) has different requirements than guessed here.
**Fix it when a UI callsite for the lenient matcher is wired up, alongside
that change, not now.** No `qa-bug` issue by design (nothing a user hits).

### Player-bar favorite button: removing a favorite often doesn't visually update

Added: 2026-07-11, re-investigated and confirmed 2026-07-24. Route: player bar,
any playing song. Driver `scripts/qa/_probe-fav.mjs` (rewritten this cycle —
see below), account `test260526`.

Issue: https://github.com/laker-93/subbox-app/issues/38

**The original "completely inert" hypothesis is NOT reproducible and is
retracted.** It rested on a hover+tooltip button finder that itself proved
unreliable (found the control 3/4 runs previously; this cycle it was NOT FOUND
2/2 times using the old script, and the process hung after failing to find
it). Rewrote the probe to locate the button by its SVG heart-path signature
(`d` starts `"M19 14c1.49"`) instead of the racy portalled tooltip, and to
click computed live coordinates rather than a snapshot `elementHandle`.

**Confirmed finding, 9 fresh-launch trials against the real dev stack:** every
click fires exactly one real `star.view`/`unstar.view` request (200) — the
button is not inert. But the visual result is asymmetric:
- **Add (`star.view`): 4/4 trials** — icon fill flips to "primary" (favorited)
  within 200ms, every time.
- **Remove (`unstar.view`): 2/5 trials** correct; **3/5 trials** the icon kept
  showing "favorited" through 200ms/500ms/1s/2s/4s checkpoints and never
  self-corrected (checked across further playback re-renders too).

**Hypothesis (not confirmed as root cause).** Both `create-favorite-mutation.ts`
and `delete-favorite-mutation.ts` emit `USER_FAVORITE` synchronously in
`onMutate`, consumed by `audio-players.tsx` → `updateQueueFavorites`
(`player.store.ts`) to mutate the matching queue song's `userFavorite`;
`usePlayerSong()`'s selector equality includes `userFavorite`, so a real
change should always re-render. Static review of both mutation files found no
asymmetry between add/remove that would explain the skew — this looks like an
intermittent race (a `favoriteSongs` query-invalidation refetch or similar
racing the optimistic event?) rather than a missing wire-up, but needs actual
tracing (e.g. temporary logging around `updateQueueFavorites`/`getCurrentSong`)
to pin down.

**Why NOT fixed this cycle.** Root cause isn't confidently identified — only a
reproducible symptom plus a disproven alternate hypothesis — so it doesn't meet
the conservative "confidently root-caused, fully verifiable" bar. Logged with a
tracking issue for a future cycle or the user to pick up; the rewritten probe
script is the reusable repro tool (run it a handful of times to see the ~60%
remove-side failure rate).

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

- 2026-07-22 | External Drive "Download Missing Tracks" — misdiagnosed as ignoring drivePath (it doesn't; drive is compare-only by design) | NOT A ROUTING BUG — real defect was misleading tooltip/copy claiming tracks land on the drive; fixed by rewording copy + adding Rekordbox XML export, not by changing where files are written; full writeup `features/external-drive-sync.md` | issue #27, PR #29 (supersedes closed PR #28, which had wrongly routed downloads to drivePath)
- 2026-07-22 | Web build Sync->Download always failed (401 no X-Auth, then would 404 on missing .zip ext) | FIXED — blob-fetch download via FilebrowserController.download + corrected filename; re-verified live via web-sync-download-zip.mjs | issue #25, PR #26
- 2026-07-21 | Watch uploader "restores UI but never re-arms watcher" on relaunch | NOT A BUG — app.tsx already auto-resumes at boot (since 2026-06-05); re-verified live via watch-resume-relaunch.mjs | issue #23 (closed not-a-bug)
- 2026-07-14 | Delete track showed a success toast even when the delete failed | FIXED (client captured pymix's 200+`success:false` body; throws on failure) | issue #18, PR #19
- 2026-07-22 | External Drive "Download Missing Tracks" — misdiagnosed as ignoring drivePath (it doesn't; drive is compare-only by design) | NOT A ROUTING BUG — real defect was misleading tooltip/copy claiming tracks land on the drive; fixed by rewording copy + adding Rekordbox XML export, not by changing where files are written; full writeup `features/external-drive-sync.md` | issue #27, PR #29 (supersedes closed PR #28, which had wrongly routed downloads to drivePath)
- 2026-07-23 | Rekordbox metadata-only import: filebrowser 401 not retried + failed import shown as success toast | FIXED — sync:upload-xml now uses createFbAuth/fbRequest retry; poll loop + done screen now branch on prog.result/error; re-verified live via new rekordbox-metadata-import.mjs | issue #30, PR #31
