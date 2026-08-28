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

### Writing a crate that has both its own tracks and a sub-crate loses the parent's tracks

Added: 2026-08-27. Found by `scripts/qa/serato-roundtrip.mjs` phase `serato-export`
(Sync → Download → "Write Serato crates"), the first end-to-end run of the Serato
export shipped in subbox-app #114.

**Symptom.** The done screen says *"3 Serato crates written with 16 tracks"* and the
top-level crate arrives in Serato **empty**. In the round trip the fixture's
`Subbox QA` crate holds all 8 tracks and also has children (`Cues`,
`Nested / Deep`); on disk `Subbox QA.crate` is a 212-byte empty-crate header, the
same size as `Subbox QA%%Nested.crate`, which genuinely is an empty folder. Reading
the folder back through `readCrateTree` finds only the two child crates.

**Repro** (no stack, no app, ~1s) — `writeCrates` with a parent and its child in one call:

```ts
writeCrates(serato, [
    { pathComponents: ['Sets'], tracks: [{ localPath: a }, { localPath: b }, { localPath: c }] },
    { pathComponents: ['Sets', 'Deep'], tracks: [{ localPath: c }] },
]);
// reported: { cratesWritten: 2, tracksWritten: 4, backupFolder: null }
// on disk:  Sets%%Deep.crate (396b), Sets.crate (212b)   ← the parent is empty
// read back: only "Sets / Deep"
```

**Root cause** (`src/main/features/core/sync/serato-crates.ts`, `writeCrates`). Each
branch is saved separately — `for (const root of roots) builder.save(root, ...)` —
and tserato's save writes a `.crate` file for *every* level of the branch, so saving
`Sets → Deep` rewrites `Sets.crate` as an empty parent stub over the copy that was
written with its 3 tracks a moment earlier. The function already guards the
neighbouring case: a parent that **pre-existed on disk** is backed up and restored
afterwards. That guard cannot fire here — the parent is one of *our* crates, so it
is in `leafFiles` and explicitly skipped by the restore loop (`if
(leafFiles.has(file)) continue;`), and on a fresh library there is nothing to back
up at all (`backupFolder: null`).

The reported counts come from the in-memory intent, not from what landed, which is
why the UI says 16 tracks while the user gets 8.

**Why it matters.** "A big crate plus sub-crates" is the ordinary shape of a Serato
library, and it is exactly what a Serato → subbox → Serato round trip reproduces, so
the user gets their crates back with the largest one emptied. Silent: nothing on
screen, in the result object, or in the logs says a track was dropped.

**Scope.** subbox-app only (client-side crate writing; pymix hands over structure and
never touches a `.crate`). Not covered by `pnpm check:serato-crates` — its
`checkAnExistingParentCrateKeepsItsTracks` case writes the parent to disk *before*
calling `writeCrates`, i.e. the restore-from-backup path, never the both-in-one-call
path. A fix should merge the branches into one tree and save each root once (or
re-save the crates that own tracks after the stubs), and the check script should gain
the shape above.

Issue: https://github.com/laker-93/subbox-app/issues/117

### (reachable-but-broken dead end, NOT user-reachable in practice — no issue filed by design) `/login`'s logged-out state dumps raw internal JSON with no way back

Added: 2026-08-03. Found while closing out the README's "Login / servers" coverage
row (`features/login-servers-home-explore-folders.md`).

**Observation.** `LoginRoute` (`features/login/routes/login-route.tsx`) is mounted
as a **sibling** of `AuthenticationOutlet`/`AppOutlet` in `app-router.tsx`, not
nested inside them — so it renders unconditionally on `/login`, bypassing the real
subbox auth gate (`AppOutlet`'s `!currentServer` → `LandingPage`+`PymixAuthModal`)
entirely. It's the old upstream-Feishin `SERVER_LOCK` single-server-kiosk login
form, which requires `window.SERVER_TYPE`/`window.SERVER_URL` (build-time config a
subbox build never sets). With `currentServer` set it correctly bounces to Home
(`<Navigate to={AppRoute.HOME}>`, verified live, no bug) — but logged-out, it
renders a bare "An error occurred / No server selected" page that dumps its raw
config-validity array as JSON straight onto the screen, with no link back to the
real landing page.

**Why NOT filed / fixed.** `grep -rn "AppRoute.LOGIN\b" src/renderer` → zero hits
outside `routes.ts`/`app-router.tsx` — nothing in the app ever navigates here
(`to={AppRoute.LOGIN}` or similar), so no real user's click path reaches it; only
a manually-typed/bookmarked URL would. Same class as the already-logged
`/action-required` dead code: fixing it means either wiring `SERVER_LOCK` config
into subbox builds (a deployment/feature decision) or deleting the classic
login flow outright (multi-file cleanup, and the authenticated-redirect branch is
live-correct and would need preserving) — outside the small-fix bar. No `qa-bug`
issue by design.

### (latent, NOT user-reachable — no issue filed by design) `AppRoute.EXPLORE` (`/explore`) and `AppRoute.SERVERS` (`/servers`) are unmounted dead routes

Added: 2026-08-03. Found while closing out the README's "Home / explore" and
"Login / servers" coverage rows (`features/login-servers-home-explore-folders.md`).

**Observation.** Both `AppRoute.EXPLORE` and `AppRoute.SERVERS` exist only as enum
values in `routes.ts` — `grep -rn "AppRoute.EXPLORE\|ExploreRoute\|'/explore'"` and
the equivalent for `SERVERS` each return zero hits elsewhere in `src/renderer`, and
neither has a `<Route path={...}>` in `app-router.tsx` (unlike `HOME`, mounted
twice — index and `/`). Hash-navigating to either live renders the app's own
`InvalidRoute` 404 ("Unable to route request") gracefully, inside full app chrome
— not a crash, just confirms no such screen exists. Home's own "Explore from your
library" carousel section appears to be where the Explore concept actually lives
today.

**Why NOT filed / fixed.** No live symptom (nothing links to either route, and the
404 fallback already handles a stray/typed URL correctly) — same class as
`/action-required`. Deleting two unused enum values is a trivial-looking but
still-a-cleanup-call change, not a bug fix; left alone. No `qa-bug` issue by
design.

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

### (unconfirmed, cosmetic — NOT a regression from the account change; no issue filed) Spurious "Failed to get user info" error toast on a forced-fresh login

Added: 2026-08-14, during the pre-resume smoke check of the re-pointed
`test060826` credentials (client built at 1.10.23 from the freshly-rebased
branch, `scripts/ui-snapshot-electron.mjs`).

**Symptom.** The app logs in successfully and renders correctly, but shows an
`Error / Failed to get user info` toast *alongside* the `Success / Logged in
successfully` one. Screenshot: `.ui-snapshots/electron-home-1440x900-1786692083474.png`.

**Not a server-side failure.** `navidrometest060826`'s log shows **every**
`getUser.view` in that window returning `status=OK` / `httpStatus=200` (3
request/response pairs, including a manual `curl` control). So the throw at
`hooks/use-server-authenticated.ts:85` (`if (!userInfo) throw`) fired on a path
that returned falsy **without making a request at all** — i.e. the hook ran
before the server/auth state resolved.

**Almost certainly the already-known boot race, not new.** The issue #53
investigation (closed not-reproducible after 21/21 clean trials, full history in
`bugs-archive.md`) found exactly this shape: `_serverId` can be stale or absent
on a session's **very first load**, not only across a logoff cycle. It's also
specific to the harness's `forceFreshLogin()`, which wipes localStorage directly
rather than going through the real logoff path — so the app boots with no server,
this hook fires, fails, and the subsequent real login succeeds.

**Why NOT filed.** Observed once, cosmetic (nothing downstream is broken — the
retry succeeds and `isAdmin` is correctly updated), and only under the
fresh-login driver path. **Do not treat this as a regression caused by the
2026-08-13 account re-point** — that's the trap this entry exists to prevent. If
you want to close it out: drive a *resumed-session* launch (no `forceFreshLogin`)
and see whether the toast still appears. If it does, it's real and worth an
issue; if it only appears on forced-fresh boots, it's the harness artifact and
this entry can be archived.

### (OPEN — fix written and DECLINED by the user; do not re-implement) Export Settings backup writes no file until the whole app is quit (Electron)

Issue: https://github.com/laker-93/subbox-app/issues/39

Added: 2026-07-25. **Moved back to OPEN 2026-08-13** — it had been recorded in the
Closed index as FIXED, which was wrong.

**What happened.** A cycle found the bug, fixed it (commit `a7227e1c`: branch the
Electron path through `window.api.utils.download` → `download-url` IPC →
`webContents.downloadURL` with a `data:application/json` URL, plus a
`will-download` handler to name the file), verified it live via
`settings-journey.mjs` (export landed in ~300ms, previously stuck until app
quit), and opened PR #40 as designed. **The user closed PR #40 unmerged** the
same day, with: *"Closing — low priority, not implementing right now. The
underlying bug … is still tracked in subbox-app#39."* The journal recorded the
fix as shipped anyway, and — because Step 1½'s close-out only re-examines OPEN
entries — nothing would ever have corrected it.

**Current state.** The bug is **still live in `development`**; issue #39 is still
open. Commit `a7227e1c` was **dropped from `claude/continuous-ux`** on 2026-08-13:
it had been sitting below every later commit, so the branch was building a client
containing a change the user had declined, and it conflicted with upstream #72
(which touched the same file), silently blocking `sync-merged.sh`'s rebase. The
commit is preserved on the local ref `qa-backup-20260813` if it's ever wanted.

**Do not re-fix this.** It is deliberately deprioritised. Leave it OPEN; if it
ever becomes wanted, the approach above is known-good and recoverable from that
backup ref. This entry exists so a future cycle recognises it rather than
rediscovering and re-implementing it.

### (OBSOLETE 2026-08-13 — the fixture no longer exists; do not investigate) Playlist "Kodzo" has a duplicate track server-side

> **Closed as moot 2026-08-13.** This entry describes a data condition on
> `test260526`, an account that has since been deleted (see `README.md` → "The
> dev test account changed"). The "Kodzo" playlist went with it — `../pymix-qa`'s
> own `bugs.md` already noted the container recreation that first orphaned these
> fixtures back on 2026-07-25. There is nothing left to look at. Kept here only
> so a cycle that meets a genuine `subbox_id_divergence` signal on `test060826`
> doesn't waste time hunting for a "known duplicate" that has not existed for
> weeks — **if you see one now, it is new**. Retained rather than archived
> because the reasoning below (a correctly-flagged real duplicate is not a false
> positive) is still the right call for a future occurrence.

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
- 2026-07-25 | Export Settings backup wrote no file until the whole app was quit (Electron) | ~~FIXED~~ **REOPENED 2026-08-13 — see the OPEN entry above; PR #40 was closed unmerged** | issue #39 (still open), PR #40 (CLOSED, not merged)
- 2026-07-26 | Wishlist create modal: link parse-link prefill never fired (onBlur silently overwritten by form.getInputProps spread) | FIXED — reordered so handleLinkBlur runs after the spread; re-verified live via wishlist-bulk-and-sheet.mjs (artist/title now prefill from a pasted YouTube link) | issue #44, PR https://github.com/laker-93/subbox-app/pull/45
- 2026-08-02 | Row-level favorite heart icon silently no-ops (`item._serverId` mismatch) | CLOSED NOT-REPRODUCIBLE — 21/21 clean trials across 2 cycles (6+15), both leads (stuck-mutation-cache, boot-race) ruled out with direct evidence; same bar as sibling #38 | issue #53 (closed not-reproducible)
- 2026-08-17 | Global mutation retry (3x in production) let a rejected `/invite-request` burn the endpoint's 5/hour rate limit (1 click -> 4 requests) | FIXED — `retry: false` on `useRequestInvite`'s own mutation, scoped single-call-site fix; re-verified live (1 request per user action post-fix) | issue #105, PR #106
