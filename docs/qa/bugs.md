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

### Row-level favorite heart icon (list views) silently no-ops — `item._serverId` doesn't match the live server

Added: 2026-07-29. Route: any table list with the `USER_FAVORITE` column (`/library/songs`,
`/favorites`, etc). Resumed from a multi-day abandoned/uncommitted investigation found
uncommitted at cycle start (a chain of `_debug-*.mjs`/`_fav-click-test*.mjs` scratch scripts
dated 2026-07-26 through 2026-07-29, plus an uncommitted temporary `console.log` in
`favorite-column.tsx` — no journal trace, evidently a run of crashed cycles chasing this same
symptom under the "player-bar favorite button" framing). Driver:
`scripts/qa/favorites-row-toggle.mjs` (recovered/cleaned up this cycle, was
`favorites-row-toggle-v2.mjs`).

**What a user sees.** Clicking the row's own inline heart icon (in the table list, as
opposed to the player-bar `FavoriteButton`) to add or remove a favorite does **nothing**:
no visible state change, no toast, no network request — a fully silent no-op. Confirmed via
`.ui-snapshots/qa-fav-toast-check-1785285454378.png` (no toast rendered) and a
`page.on('request')` listener that saw zero `star.view`/`unstar.view` (or any
favorite-shaped) request in the 800ms+ after the click, across 3 separate runs (2 fresh-login,
1 plain resume of an existing session).

**Root cause (confirmed, but not fully pinned to a trigger).** Instrumented
`favorite-column.tsx`'s `onClick` with a temporary `console.log` (now reverted) and confirmed:
the click handler DOES fire, `props.controls.onFavorite` IS present, and the row item has a
real `id` and `_serverId`. But `controller.ts`'s `createFavorite`/`deleteFavorite` both do
`const server = getServerById(args.apiClientProps.serverId); if (!server) throw ...` — and a
direct dump of `localStorage['store_authentication']` at the same moment showed the row's
`_serverId` (e.g. `qezW8uzZSGePPZdudqjS_`) **does not match any entry** in the live
`serverList` (which had exactly one server, a different id, e.g. `mQJc9Hmx8cNv6Udq7G_le`).
`getServerById` returns `undefined` → the mutation throws before any HTTP call → react-query's
`onError` reverts the optimistic update and shows a toast — except no toast was observed
either, so even that fallback isn't visibly reaching the user (not investigated further: could
be a toast timing/dedup issue, or the throw happens somewhere not wrapped by the mutation's
`onError` at all).

**What's still unpinned.** Where the stale `_serverId` on the row data comes from. Ruled out:
(1) IndexedDB-persisted react-query cache — `main.tsx`'s `shouldDehydrateQuery` only persists
`lyrics`+`select` queries, not song lists, so this isn't stale disk-persisted data. (2) A
simple multi-server mix-up — `serverList` only ever contained one entry in every repro.
Suspected but unconfirmed: a race at app boot between an early session-resume path and
`pymix-auth-modal.tsx`'s `authenticateServices`/`addServer`/`setCurrentServer` reauth flow
(which the file's own comment says is *supposed* to reuse the existing server id via
`findExistingServerId`, to avoid "stale, credential-stripped entries" accumulating) — if the
song list's first fetch fires against an early/preliminary server identity that gets replaced
moments later, the already-fetched rows would carry the orphaned id forever (nothing refetches
them). Not confirmed with a direct trace of the boot sequence — would need instrumenting
`authenticateServices`/`addServer`/`setCurrentServer` call order relative to the first
`getSongList` fetch, which wasn't completed this cycle.

**Possible connection to issue #38** (closed not-reproducible 2026-07-24, full text
`bugs-archive.md`): that investigation found the player-bar favorite REMOVE action flaky
(3/5 fail) then later 21/21 reliable with no code change and no root cause pinned. A boot-order
race producing an intermittently-stale `_serverId` is at least consistent with that
flakiness-then-disappearance pattern, though the player-bar button reads `currentSong`, a
different data path than this table column — not confirmed as the same bug, just flagged as a
plausible shared root cause for whoever picks this up.

**Why not fixed this cycle.** The failure mode is confirmed and reproducible, but the actual
trigger (why/when a row's `_serverId` diverges from the live server) isn't pinned down — a fix
without knowing that would be a guess (e.g. patching `getServerById` to fall back to
`currentServer` would mask the symptom without fixing why stale data is being rendered at
all). Needs a boot-sequence trace before a conservative fix is possible. `bugs-archive.md`
note for whoever resumes: the recovered `favorites-row-toggle.mjs` driver's `hoverAndClick`
diagnostics (`cls before/after click`) are a red herring — the CSS class checked (`hover-only`)
reflects hover-visibility, not favorited state, so it never signals success/failure; rely on
the `star.view`/`unstar.view` network listener instead, as this writeup did.
Issue: https://github.com/laker-93/subbox-app/issues/53

<!-- One entry per bug. Include: date found, journey/route it showed up on,
     repro steps, evidence (screenshot path / console error), your hypothesis
     for root cause + which repo owns it, and an `Issue: <github url>` line
     (every bug gets a qa-bug tracking issue — see README hard rules / skill
     Step 1½). Remove an entry (move to FIXED) once actually fixed and verified,
     don't just mark it done. -->

### (latent, NOT user-reachable — no issue filed by design) `/action-required` route + its entire component tree are dead code

Added: 2026-07-25. Found while closing out the `[mixed]` "Action required /
no-network states" coverage row (`features/no-network-and-action-required.md`).

**Observation.** `AppRoute.ACTION_REQUIRED` (`/action-required`) and its full
component tree (`features/action-required/routes/action-required-route.tsx` +
`action-required-container.tsx` + `server-credential-required.tsx` +
`server-required.tsx`) are never mounted: `grep -rn "AppRoute.ACTION_REQUIRED"
src/` finds zero hits outside the enum declaration, and `app-router.tsx`'s
`<Routes>` tree has no `<Route path={AppRoute.ACTION_REQUIRED}>` and never
lazy-imports the route component (it does mount its sibling `NoNetworkRoute`
from the same folder). The scenarios this component was built to cover — no
server (`ServerRequired`), server-with-no-credential
(`ServerCredentialRequired`, with a log-off action) — are instead fully
handled by `AppOutlet` rendering `LandingPage` + `PymixAuthModal` directly
whenever `!currentServer`, a different (subbox-specific) flow that never
navigates here.

**Why NOT filed / fixed.** No live symptom — nothing a user does reaches this
code, so there's no correctness bug with a repro. Unlike the `syncTracks`/
serato-`playlistIds` dead-surface findings (dormant call paths one UI wiring
change away from firing), this looks like code fully **superseded** by
`AppOutlet`'s later pymix-auth-modal flow, not paused-pending-a-caller — so
the natural resolution is deletion, not a future wire-up. Not done this cycle:
deleting is a 4-file cleanup/refactor call, not a small bug fix (and
`ServerCredentialRequired`'s "log off" affordance has no equivalent in the
`AppOutlet` flow, so it isn't a strict no-op removal) — outside the
conservative "bug fixes and small UX improvements only" bar. No `qa-bug` issue
by design (nothing a user hits).

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
- 2026-07-24 | Player-bar favorite button: removing a favorite often doesn't visually update | NOT REPRODUCIBLE on re-check — 21/21 fresh trials (8 REMOVE) correct with full request/state/render tracing; original 3/5 remove-failure cause unknown, not present now; no code change | issue #38 (closed not-reproducible)
- 2026-07-25 | Export Settings backup wrote no file until the whole app was quit (Electron) | FIXED — onExportSettings now routes Electron through window.api.utils.download (data: URL + will-download handler names the file); re-verified live via settings-journey.mjs (export lands in ~300ms, was previously stuck until app quit) | issue #39, PR #40
- 2026-07-26 | Wishlist create modal: link parse-link prefill never fired (onBlur silently overwritten by form.getInputProps spread) | FIXED — reordered so handleLinkBlur runs after the spread; re-verified live via wishlist-bulk-and-sheet.mjs (artist/title now prefill from a pasted YouTube link) | issue #44, PR https://github.com/laker-93/subbox-app/pull/45
