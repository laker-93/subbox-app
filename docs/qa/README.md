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

## How to read this directory

- `directives.md` — **check this first, every cycle.** User-steered focus
  always takes priority over the loop's own rotation logic. See that file for
  how to add one.
- `bugs.md` — correctness bug log. OPEN entries are unverified, ambiguous,
  cross-repo, or otherwise judged too risky to auto-fix; FIXED entries link to
  the commit that resolved them. Check OPEN entries for "is this still
  reproducible" before picking new ground to explore.
- `ux-notes.md` — UX friction log, for things that aren't wrong so much as
  rough. Judgment calls (does this actually need fixing, is this intentional)
  default to logging, not fixing — only act on friction with an obvious, small,
  low-risk improvement (e.g. a missing loading indicator, a confusing but
  easily-clarified label), the same conservative bar as `bugs.md`.
- `features/*.md` — one file per feature area or user journey, written once
  it's been driven and verified. Treat an existing file as ground truth for
  "expected behavior" on subsequent cycles — if real behavior no longer
  matches, that's a regression, not necessarily a doc error.
- `log.md` — one line per cycle: timestamp, what was done, outcome. Skim the
  last ~10 entries to avoid repeating the same cycle back-to-back.

## Automation

Don't build browser automation from scratch — extend what's already here:

- `scripts/ui-snapshot-electron.mjs` + `scripts/ui-snapshot-shared.mjs` —
  Playwright `_electron` launch of the built app (`out/main/index.js`), login
  flow (`performLogin`/`getCredentials`), session-expiry handling
  (`forceFreshLogin`), route-settle detection (`waitForRouteSettled`).
  Credentials come from `.env.ui-snapshot.local` (gitignored — see
  `.env.ui-snapshot.local.example`; must exist locally already or the loop
  needs it created once with a local dev test account).
- Requires `pnpm run build:electron` before a run reflects the latest source
  — rebuild whenever you've made a fix you want to re-verify.
- Add new driver scripts under `scripts/qa/` (create if missing) rather than
  bloating the snapshot scripts — reuse the shared helpers by importing from
  `../ui-snapshot-shared.mjs`.

## Feature coverage checklist

Routes below come from `src/renderer/router/routes.ts` (`AppRoute`). Check one
off (link to its `features/*.md`) once it's been driven and documented, not
just read in source. Prefer exercising these as part of a realistic multi-step
journey rather than one route in isolation — real friction often shows up in
the transition between screens, not within one screen.

- [ ] Login / servers (`/login`, `/servers`)
- [ ] Home / explore (`/`, `/explore`)
- [ ] Library — albums (`/library/albums`, detail)
- [ ] Library — artists (`/library/artists`, detail incl. discography/top songs)
- [ ] Library — album artists (`/library/album-artists`, detail)
- [ ] Library — songs (`/library/songs`)
- [ ] Library — genres (`/library/genres`, detail)
- [ ] Library — folders (`/library/folders`)
- [ ] Favorites (`/favorites`)
- [ ] Playlists (`/playlists`, `/playlists/:id/songs`)
- [ ] Now playing / playing queue (`/now-playing`, `/playing`)
- [ ] Radio (`/radio`)
- [ ] Search (`/search/:itemType`)
- [ ] Wishlist (`/wishlist`) — pymix wishlist API integration
- [ ] Settings (`/settings`)
- [ ] Action required / no-network states (`/action-required`, `/no-network`)
- [ ] Sync flows (subbox-app side of pymix `/sync/*` — see pymix-qa journal)
- [ ] Rekordbox/Serato import-export UI (subbox-app side of pymix
      `/rekordbox/*`, `/serato/*` — see pymix-qa journal)
- [ ] Sharing
- [ ] Filebrowser integration

This list isn't exhaustive — add rows as you discover sub-flows worth tracking
separately (e.g. drag-and-drop reorder within playlists, context menus, theming).

## Hard rules (do not relax these)

- **Bug fixes and small UX improvements only.** No new features, no
  refactors, no redesigns, no "while I'm here" cleanup.
- **Conservative fixes only.** Only commit a fix once you've re-run the exact
  flow that exposed the issue and confirmed it now behaves correctly. Anything
  you can't fully verify, or that's a subjective/design judgment call, goes in
  `bugs.md` or `ux-notes.md` as OPEN, not into a commit.
- **One fix commit per cycle**, on this branch (`claude/continuous-ux`) only.
- **Never push.** Never open a PR. Never merge to `development`. The user
  reviews and pushes manually.
- **Never touch staging or prod.** Only the local dev stack
  (`../traefik/docker-compose.yml`) and the local Electron/dev builds.
- **Cross-repo bugs**: if the root cause is in `pymix` (or fixing the
  subbox-app side requires a matching pymix change), do not implement a
  one-sided fix. Log it in `bugs.md` (and cross-reference in
  `../pymix-qa/docs/qa/bugs.md`) with which side needs what, and stop there.
- Kill any Electron process you launch before ending the cycle — don't leave
  orphaned windows/processes across cycles.
