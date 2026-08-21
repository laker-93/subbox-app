# Continuous UX loop journal (subbox-app / client)

This directory is the persistent memory for the autonomous continuous-UX loop
(driven by the `continuous-ux` skill in `subbox-workspace/.claude/skills/`).
Each loop cycle is a fresh context — **this journal is the only thing that
carries state between cycles.** Read it before doing anything else.

The loop's job is broader than QA: **emulate a real user's end-to-end
experience** of the app — not isolated feature pokes, but realistic journeys
(e.g. "new user connects a server, imports a Rekordbox library, browses it,
builds a playlist, syncs it back") — and continuously improve that experience.
That means noticing and fixing two different things as it goes:

1. **Bugs** — behavior that's outright wrong (errors, crashes, data loss,
   broken flows).
2. **UX friction** — behavior that "works" but is confusing, inconsistent,
   slow, or awkward for a real user (unclear empty states, silent failures,
   inconsistent interaction patterns vs. the rest of the app, missing
   feedback on long operations, etc.).

Write down how things actually work (verified by driving the app, not by
reading code alone), and fix what it can verify — conservatively. It does not
add net-new features or do large redesigns; it sands down rough edges and
fixes bugs in what already exists.

## ⚠️ The dev test account changed (2026-08-13) — read this before driving anything

**`test260526` is gone.** Not stopped — deleted. `user_table` in `pymix-postgres`
now holds exactly one user, **`test060826`**, and the only per-user containers on
the stack are `navidrometest060826` / `beetstest060826`. Around 69 mentions of the
old account across this journal (and ~99 more in `../pymix-qa`) are therefore
**historical, not reusable**: the playlists, `subbox_id`s, track counts and byte
sizes in every `features/*.md` written before this date describe a library that no
longer exists. The behaviour those docs record is still the best available account;
the fixtures are dead. Don't chase a "missing" playlist — mint your own.

`.env.ui-snapshot.local` has been re-pointed at `test060826` (login re-verified
2026-08-13, HTTP 200), so `getCredentials()` and every driver authenticate
correctly again.

**`test060826` is NOT a disposable account — it is the user's own working
fixture.** Its Navidrome `/music` holds `t104before/`, `t104after/`, `t104a2/`,
`t104b2/` and `backup/`: the before/after comparison data for the pymix #104/#105
import-performance work, 97 tracks. The usual "it's a test account, write freely"
latitude **does not apply**. Concretely:

- **Never** bulk-delete, re-tag, or re-import anything under those five
  directories, and never run a library-wide mutation on this account.
- Create scratch fixtures under an obviously-scratch name and delete them at end
  of cycle, exactly as if this were a shared account.
- A destructive step you can't scope tightly is a reason to **log the check as
  not-run**, not to proceed carefully.

## How to read this directory

- `directives.md` — **check this first, every cycle.** User-steered focus
  always takes priority over the loop's own rotation logic. See that file for
  how to add one.
- `bugs.md` — correctness bug log. OPEN entries are unverified, ambiguous,
  cross-repo, or otherwise judged too risky to auto-fix; the **Closed** index at
  the bottom is one line per fixed bug (full text in `bugs-archive.md`, which the
  loop never reads). Check OPEN entries for "is this still reproducible" before
  picking new ground. **When you fix a bug, move its full text to
  `bugs-archive.md` and leave one line in Closed** — keep this hot file small.
- `ux-notes.md` — UX friction log, for things that aren't wrong so much as
  rough. Judgment calls default to logging, not fixing — only act on friction
  with an obvious, small, low-risk improvement, the same conservative bar as
  `bugs.md`. Same archiving rule: RESOLVED/IMPROVED notes move to
  `ux-notes-archive.md`, one line stays in the Closed index.
- `features/*.md` — one file per feature area or user journey, written once
  it's been driven and verified. Treat an existing file as ground truth for
  "expected behavior" on subsequent cycles — if real behavior no longer
  matches, that's a regression, not necessarily a doc error.
- `log.md` — one line per cycle: timestamp, what was done, outcome. Skim the
  last ~10 entries to avoid repeating the same cycle back-to-back. **Rotate it**
  when it passes ~15 entries: oldest block moves verbatim to `log-archive.md`
  (loop never reads it). Same for the pymix journal.

## Automation

Don't build browser automation from scratch — extend what's already here:

- `scripts/ui-snapshot-electron.mjs` + `scripts/ui-snapshot-shared.mjs` —
  Playwright `_electron` launch of the built app (`out/main/index.js`), login
  flow (`performLogin`/`getCredentials`), session-expiry handling
  (`forceFreshLogin`), route-settle detection (`waitForRouteSettled`).
  Credentials come from `.env.ui-snapshot.local` (gitignored — see
  `.env.ui-snapshot.local.example`; must exist locally already or the loop
  needs it created once with a local dev test account).
- Requires an Electron build reflecting the latest source before a run
  actually exercises it. **Use `pnpm exec electron-vite build --mode
  development`, not plain `pnpm run build:electron`** — the latter defaults
  to Vite's production mode and bakes in the real prod pymix URL
  (`pymix.sub-box.net`) instead of the local stack
  (`pymix.docker.localhost`). Rebuild whenever you've made a fix you want to
  re-verify.
- Known local dev test account (already in `.env.ui-snapshot.local`, which
  is gitignored — recorded here so it isn't lost): `test260526` /
  `1234test260526`. Matches the running `navidrometest260526` /
  `beetstest260526` per-user containers and has a real populated library
  (774 local tracks, 13 playlists at last check) — useful for realistic
  journeys, not just empty-state smoke tests.
- Add new driver scripts under `scripts/qa/` (create if missing) rather than
  bloating the snapshot scripts — reuse the shared helpers by importing from
  `../ui-snapshot-shared.mjs`.
- **Driving a long/async flow (download, upload, import) to a terminal state.**
  These flows can *hang* (a main-process error that never gets forwarded to the
  renderer leaves the UI spinning forever) — that's a real bug class, so a driver
  must be able to tell "completed", "surfaced an error", and "hung" apart. Race
  the success UI against the error UI with a bounded timeout, and treat timeout
  as a **hang failure**, not a slow pass:

  ```js
  const outcome = await Promise.race([
      page.getByText(/Download Complete/i).waitFor({ timeout: 180_000 }).then(() => 'done'),
      page.locator('text=/Download failed/i').first().waitFor({ timeout: 180_000 }).then(() => 'error'),
  ]).catch(() => 'hang');            // timeout ⇒ the flow hung
  process.exit(outcome === 'done' ? 0 : outcome === 'error' ? 1 : 3);
  ```

  Also mirror the Electron **main** process stdout so you can see the
  `[Subbox]` server-side logs and any thrown error the renderer never showed:
  `electronApp.process().stdout.on('data', d => process.stdout.write('[main] '+d))`.
  `scripts/qa/download-all.mjs` is the worked reference (Sync → Download →
  Select all → Preview → Download & Extract → assert done-or-error). Note the sync
  UI is reached via the **mode toggle** (`appMode`), not a route — click the
  "Sync" segment, then the "Download" tab. Force a fresh login first
  (`forceFreshLogin`) so a session persisted against a *different* backend from an
  earlier build doesn't get reused against the dev stack.

## Feature coverage checklist

Routes below come from `src/renderer/router/routes.ts` (`AppRoute`). Check one
off (link to its `features/*.md`) once it's been driven and documented, not
just read in source. Prefer exercising these as part of a realistic multi-step
journey rather than one route in isolation — real friction often shows up in
the transition between screens, not within one screen.

**Priority — subbox-only rows first.** subbox-app is a fork of the mature,
heavily-tested Feishin player, so the bugs are overwhelmingly in the custom
functionality bolted on top (uploading, deleting, local download, sync, wishlist,
import-export, sharing, filebrowser — anything touching pymix), **not** in the
inherited upstream browse/search/playback surface. Each row is tagged
`[subbox]` (custom — high yield, drive these first), `[upstream]` (inherited from
Feishin — low yield, a cheap regression check at most), or `[mixed]` (a subbox flow
riding on an upstream screen — the subbox part is what matters). When picking an
unchecked row, **an unchecked `[subbox]`/`[mixed]` row beats an unchecked
`[upstream]` one even if the upstream one is listed higher.** Only spend a cycle on
an `[upstream]`-tagged area as light regression coverage or when a realistic journey
naturally passes through it.

<!-- Checked rows are compacted to one line — the detail lives in the linked
     features/*.md (ground truth). Keep new [x] rows to a single line too. -->

- [x] `[upstream]` Login / servers (`/login`, `/servers`) — classic upstream manual-server-entry
      flow, not subbox's real login path and unreachable via any UI link: `features/login-servers-home-explore-folders.md`
      (found `/login`'s logged-out state is a dead-end raw-JSON-dump page; `/servers` unmounted, 404s gracefully)
- [x] `[upstream]` Home / explore (`/`, `/explore`) — Home verified working; `/explore` is a dead
      enum value, never mounted: `features/login-servers-home-explore-folders.md`
- [x] `[upstream]` Library — albums — grid → detail → play → Now Playing: `features/albums-browse-and-play.md`
- [x] `[upstream]` Library — artists — grid → album-artist detail → discography/top-songs → play: `features/artists-browse.md` (role-only-artist friction in ux-notes)
- [x] `[upstream]` Library — album artists — grid → detail → songs/favorite-songs/top-songs/discography → play, driven via the dedicated nav item (not an Artists-card click): `features/album-artists-browse.md` (no bugs — clean because this index excludes role-only artists)
- [x] `[upstream]` Library — songs — list render + play-from-list: `features/songs-browse-and-play.md` (player-bar favorite toggle verified both directions; issue #38 closed not-reproducible)
- [x] `[upstream]` Library — genres — grid → detail → album/track toggle → play: `features/genres-browse.md`
- [x] `[upstream]` Library — folders (`/library/folders`) — root list + double-click descend into
      a subfolder verified live: `features/login-servers-home-explore-folders.md`
- [x] `[upstream]` Favorites (`/favorites`) — row-level add/remove toggle (own code path from the player-bar button, issue #53) verified live 2026-08-02: `features/songs-browse-and-play.md` (found+fixed a virtualization-staleness bug in the driver itself, not the product; surfaced a real ux-note on unfavorite-from-`/favorites` list staleness)
- [x] `[mixed]` Playlists — add-to-playlist + sync-download: `features/playlist-add-and-download.md`
- [x] `[subbox]` Delete a track — `DELETE {pymix}/track` by `subbox_id`: `features/delete-track.md` (fixed false-success toast #18/#19; do **not** hand-roll `beet remove` — that's the no-`subboxid` fallback only)
- [x] `[upstream]` Now playing queue — tail of albums journey: `features/albums-browse-and-play.md` (NB `/playing` is a dead orphaned route, not a bug)
- [x] `[upstream]` Radio (`/radio`) — internet-radio create/play/stop/delete lifecycle, real
      Icecast stream, admin-gated edit/delete verified correct: `features/radio.md`
- [x] `[upstream]` Search — Tracks/Albums/Artists tabs + no-match/empty-query edges: `features/search.md` (2 ux-notes)
- [x] `[subbox]` Wishlist — full CRUD journey: `features/wishlist.md` (client correct; surfaced pymix #31 resolve-overwrite). Bulk actions + single-track parse-link prefill + sheet-status-badge now also verified live (issue #44 found+fixed). Sub-flows still unchecked: collection-link create, inbox items, full Google-Sheet sync, match-youtube.
- [x] `[mixed]` Settings (`/settings`) — all 5 tabs render content; subbox-specific
      Export/Import settings backup (Advanced tab) driven live: `features/settings.md`
      (found + fixed issue #39, Electron export never completed until app quit)
- [x] `[mixed]` Action required / no-network states — `/no-network` verified end-to-end
      (real network failure → retry → redirect, credentials preserved, Retry recovers);
      `/action-required` confirmed dead/unreachable code, not fixed: `features/no-network-and-action-required.md`
- [x] `[subbox]` Sync flows (subbox-app side of pymix `/sync/*`): Download tab, both
      Electron (`features/sync.md`) and web (`features/sync.md` "WEB build" section,
      fixed issue #25) verified; watch/concurrency (`watch-download-concurrency.md`).
      "External Drive" tab verified: `features/external-drive-sync.md` (drive is
      compare-only by design, not a routing bug — corrects a prior misdiagnosis,
      issue #27/PR #29). Sync-plan classification (no false "missing locally" on
      duplicate-`subbox_id`/no-album-folder tracks) re-verified live 2026-07-27, no
      regression: `features/sync-plan-classification.md`, skill
      `test-sync-plan-matching`.
- [x] `[subbox]` Sync — watch vs. download concurrency: `features/watch-download-concurrency.md`, skill `test-watch-download-concurrency`
- [x] `[subbox]` Sync — External Drive tab: `features/external-drive-sync.md` (drive is
      compare-only by design, not a routing bug — corrects a prior misdiagnosis,
      issue #27/PR #29)
- [x] `[subbox]` Upload music — watch-dir uploader (Sync → Watch): verified
      end-to-end 2026-07-21 — `features/watch-upload.md`. No-`SUBBOX_ID` source →
      real UI upload → watcher mints a fresh `SUBBOX_ID` per file → pymix import →
      beets → Navidrome library. Skill `upload-music-dev` drives this; the
      wishlist → Soulseek → watch-dir import path (`wishlist-import-dev`) is the
      background variant.
- [x] `[subbox]` Rekordbox/Serato import-export UI (subbox-app side of pymix
      `/rekordbox/*`, `/serato/*` — see pymix-qa journal): `features/rekordbox-import.md`
      (Rekordbox metadata-only + full track-upload paths verified; Serato has
      **no client UI at all** — confirmed absent, not undriven. Landing-page
      "Serato" claim logged as a ux-note)
- [x] `[subbox]` Sharing — `features/sharing.md`: Navidrome-native share, offered app-wide but **always fails** (per-user Navidrome has sharing disabled → `/api/share` 404s → "Failed to create share" toast). Logged ux-note (design call: enable server-side vs hide client-side)
- [x] `[subbox]` Filebrowser integration — no standalone UI; `FilebrowserController` methods all already exercised via other sync flows: `features/filebrowser-integration.md`

This list isn't exhaustive — add rows as you discover sub-flows worth tracking
separately (e.g. drag-and-drop reorder within playlists, context menus, theming).
When you add a row, tag it `[subbox]` / `[upstream]` / `[mixed]` per the priority
note above so the next cycle can weight it correctly.

**When every row is checked, the loop does not run out of work** — it switches to
self-directed discovery (skill Step 1, tier 5): re-drive the feature whose
`features/*.md` is oldest to catch regressions (refresh its verified date), probe
the unhappy edges of a covered happy path (empty/invalid/oversized input, network
failure mid-flow, slow libraries, rapid/concurrent actions), and add new rows here
for any sub-flow that surfaces. Same conservative bar — find and fix/log, never add
features. Skim the last ~10 `log.md` lines and pick the least-recently-touched
area so cycles don't repeat. **Keep the subbox-over-upstream weighting even in
discovery** — bias regression sweeps and edge-probing toward the `[subbox]`/`[mixed]`
surface (upload, delete, local download, sync, wishlist, import-export, sharing,
filebrowser), and re-drive an `[upstream]` browse/search path only as low-priority
filler when the subbox areas were all exercised recently.

### Added 2026-08-13 — surface that landed during the runner pause, none of it driven

The client went **1.10.16 → 1.10.23** between 2026-08-04 and 08-13 while the loop
was paused. The checklist above read 100% `[x]` only because it predates this
code. All `[subbox]` unless noted, so all high-priority.

- [x] `[subbox]` **Sync → Download, rebuilt** (#101/#102/#103) — one download with
  tick-boxes for tracks/XML, web `user_root` gains a `music` segment, and web now
  shows a manifest where desktop shows a diff. Detail: `features/sync.md`.
  2026-08-14: desktop half (tick-boxes, XML-only vs. tracks+XML, full diff
  tabs). 2026-08-17: web half (manifest view, no diff tabs, tick-boxes, extract-path
  field, both download outcomes) — all sub-steps now driven and verified.
- [x] `[subbox]` **Sync below the 768px breakpoint** (#81) — `ModeToggle` in
  `MobileLayout`'s header + `MobileSyncPlaceholder`. Verified live 2026-08-17 at
  400×800: mobile layout mounts, placeholder shows with working "Back to
  Library", real Sync tabs don't leak through: `features/sync.md`.
- [x] `[subbox]` **Rekordbox import phase reporting** (#79) — verified live
  2026-08-21 against a 20-track fixture, alongside the same-day #109/pymix#133
  job-completion-honesty fix: `features/rekordbox-import.md` new section. Phase
  label + n/total confirmed real (not frozen); metadata-only path (which always
  has `n_tracks_for_import: 0`) confirmed to poll to real completion instead of
  the old skip-to-done. Failure-path distinction ("Imported, with problems" vs.
  "Import Failed") verified by code reading only, not live-triggered — see the
  doc for why.
- [x] `[subbox]` **Invite funnel** (`features/invite/`, #72/#91) — landing-page and
  create-account entry points driven live, bug found + fixed (mutation retry was
  burning the invite endpoint's 5/hour rate limit): `features/invite-funnel.md`,
  `bugs.md` (issue #105, PR #106, FIXED). `DemoBanner`/`InviteLockedPanel`
  (`source: demoBanner`/`blockedAction`) still undriven — both require a demo
  session, not available on the local dev stack; same caveat as the "Demo session
  restrictions" row below.
- [ ] `[subbox]` **Demo session restrictions** (#92) — delete-track action hidden
  for a demo session. Client half of pymix #115. Not drivable on the local dev
  stack (no demo account) — needs the deployed demo login or a code-read.
- [ ] `[mixed]` **Settings → About tab** (#93/#96/#89) — new `about-tab.tsx`,
  `legal-settings.tsx`, `licence-settings.tsx`, `music-credits-settings.tsx` plus
  a generated `credits/music-credits.json`. Covers the GPL-3.0 notices shipped
  with every build and the Creative Commons demo-library attribution. Worth
  checking the credits render against the real `music-credits.json`, since that
  file is regenerated whenever the demo library changes (workspace
  `docs/demo-library.md`).
- [ ] `[mixed]` **Legal pages** (#98) — `src/renderer/public/legal/` (ToS, privacy
  notice, notice-and-action) plus `legal-footer-links.tsx` / `use-legal-links.ts`.
  Static pages, but the footer links and their reachability from the landing page
  are drivable.
- [ ] `[mixed]` **Analytics beacon removed** (#99) — upstream Feishin's beacon no
  longer loads (`analytics-settings.tsx`). Verifiable as a negative: assert no
  request to the upstream endpoint on boot.

## Hard rules (do not relax these)

- **Bug fixes and small UX improvements only.** No new features, no
  refactors, no redesigns, no "while I'm here" cleanup.
- **Conservative fixes only.** Only commit a fix once you've re-run the exact
  flow that exposed the issue and confirmed it now behaves correctly. Anything
  you can't fully verify, or that's a subjective/design judgment call, goes in
  `bugs.md` or `ux-notes.md` as OPEN, not into a commit.
- **One fix commit per repo per cycle**, on the `claude/continuous-ux` branch
  only. A cross-repo fix may commit once here *and* once in `../pymix-qa`.
- **Open a PR per verified fix; never merge.** After committing a verified fix to
  `claude/continuous-ux`, run `../subbox-workspace/qa-runner/open-pr.sh <this
  worktree>` — it cuts a clean branch off `development` (cherry-pick into a
  throwaway worktree), pushes, and opens **one PR per fix** labelled `qa-auto`.
  Record the PR URL in this `bugs.md` `FIXED` entry. **Never merge, never
  force-push a shared branch.** The user merges on GitHub; the next daily run
  rebases this branch onto the updated `development` to pull the merged code in.
  **Keep the fix commit code-only** (`src/`, not `docs/qa/`): `docs/qa/*` on
  `development` is a stale, infrequently-synced snapshot, so a commit that
  bundles product code with journal edits (bugs.md/log.md/features/*.md) will
  often fail `open-pr.sh`'s cherry-pick with a conflict (e.g. a modify/delete on
  `bugs-archive.md`, which may not exist on `development` at all). Commit the
  journal update separately (before or after the PR) — this repo's history is
  full of exactly this split (e.g. a `fix(...)` commit + a following `qa:
  journal — ... (PR #N)` commit).
- **Every bug gets a GitHub issue, and a closed issue means it's fixed.** When you
  log a bug OPEN in `bugs.md`, file a tracking issue with
  `../subbox-workspace/qa-runner/open-issue.sh <this worktree> "<title>" "<body>"
  "<dedup-key>"` (label `qa-bug`; `<dedup-key>` is a short stable string — endpoint
  or function/file ref — used to search existing open `qa-bug` issues before
  filing, so a duplicate discovery gets handed the existing URL instead of a new
  issue) and record its URL as an `Issue:` line in the entry **immediately, as its
  own commit** — never defer this to the cycle's final commit, since a cycle that
  crashes/times out later would otherwise leave the issue orphaned on GitHub with
  no journal record, and the next cycle would rediscover and re-file it (this is
  how pymix#32/#33 happened). Never re-file an entry that already has the link.
  A fix commit/PR carries `Closes #<n>`, so merging it closes the issue; the
  issue's closed state is the signal the bug is fixed in `development`, which the
  loop reconciles back into `bugs.md` each cycle (skill Step 1½). A cross-repo bug
  gets an issue on each affected repo, cross-linked. (This is for `bugs.md`
  correctness bugs — `ux-notes.md` friction
  doesn't get an issue.)
- **Never touch staging or prod.** Only the local dev stack
  (`../traefik/docker-compose.yml`) and the local Electron/dev builds.
- **Cross-repo fixes are allowed, but only as a coordinated, end-to-end-verified
  pair — never one-sided.** If the root cause is in `pymix` (or fixing the
  subbox-app side requires a matching pymix change), you may implement both sides:
  the client change here, the server change in `../pymix-qa`, one commit per repo
  on each `claude/continuous-ux` branch. Commit **only** after you've driven the
  full flow with *both* changes live — rebuild the pymix image to
  `laker93/pymix:qa-local` and swap the running container (per the pymix journal's
  rules), rebuild this Electron client, then reproduce the original symptom and
  confirm it's resolved. Cross-reference both commit SHAs in this `bugs.md` and in
  `../pymix-qa/docs/qa/bugs.md`. If you can't verify both sides in this cycle (the
  shared `pymix` container is busy, or the flow won't drive), do **not** ship a
  one-sided fix: log both `bugs.md` files as OPEN with which side needs what, and
  stop there.
- Kill any Electron process you launch before ending the cycle — don't leave
  orphaned windows/processes across cycles.
