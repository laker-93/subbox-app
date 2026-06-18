---
name: ui-snapshot
description: Screenshot any route of the subbox-app web build at a chosen viewport size, so a reported or suspected UI/layout problem can be visually inspected and fixed instead of guessed at. Use whenever asked to fix, check, or verify a UI bug — misaligned/overlapping/off-screen elements, broken responsive layout, "this looks wrong", or any visual regression — and whenever a UI change should be confirmed by actually looking at it before declaring it done.
---

# UI snapshot

Logs into the running web dev build with a local test account and screenshots a
given route at a given viewport size, so UI problems can be diagnosed and fixed
by actually looking at the rendered page rather than reasoning about CSS blind.

This is the default tool for any "fix this UI bug" request in subbox-app (web).
Don't attempt to diagnose a layout/alignment/overflow problem from source alone —
reproduce it with a screenshot first.

**Scope:** web build only (`pnpm dev:web`). It does not cover the Electron desktop
build — if a bug is desktop-specific, say so rather than assuming the web
screenshot is representative.

## Prerequisites

1. The local dev stack must be up (`../traefik`) — pymix and the per-user Navidrome
   container the test account auths against both live there. See
   `../subbox-workspace/docs/deployment.md`.
2. `pnpm dev:web` must be running (port 4343 by default — check the log if it falls
   back to another port, e.g. because a previous instance is already running).
   Start it in the background if it isn't.
3. `.env.ui-snapshot.local` must exist with `UI_SNAPSHOT_USERNAME` /
   `UI_SNAPSHOT_PASSWORD` for a test account (copy `.env.ui-snapshot.local.example`
   if missing and ask the user for credentials — never invent them).
   This file is gitignored — never commit real credentials into the example file.

## Usage

```bash
node scripts/ui-snapshot.mjs <route> [width] [height]
```

- `route` is an app-internal path from the `AppRoute` enum
  (`src/renderer/router/routes.ts`), e.g. `/wishlist`, `/favorites`, `/`.
- `width`/`height` default to `1440x900`. Responsive/overlap bugs often only show
  up at narrower widths — also check e.g. `1024 900` and `800 900` whenever the
  bug report mentions misalignment, overlap, or off-screen elements, even if no
  specific width was given.

The script prints the absolute path of the saved PNG to stdout — **Read that
file** to actually look at the result; don't infer the outcome from the script
exiting successfully.

It logs in once via the landing page's pymix auth modal and saves the session to
`.ui-snapshots/auth-state.json` (gitignored) for fast reuse on later runs (~2s).
Delete that file to force a fresh login (e.g. after rotating the test account's
password).

## Fix loop

For any UI bug, regardless of cause:

1. **Reproduce.** Screenshot the affected route. If the report mentions a specific
   window size, use it; otherwise try the default plus a narrower width (most
   real layout bugs are width-dependent).
2. **Diagnose from the image**, not just the source — read the screenshot before
   forming a theory about the cause.
3. **Find the component** (usually `src/renderer/features/<feature>/components/`)
   and check it against equivalent components elsewhere in the codebase. A lot of
   layout bugs come from a component drifting from an established shared pattern
   rather than from a one-off CSS mistake — e.g. most page headers wrap their
   title and action buttons in `<Flex justify="space-between" w="100%">` inside
   `<PageHeader>` (see `favorites-header.tsx` or `song-list-header.tsx`); a header
   missing that wrapper will overlap the `Library`/`Sync` mode toggle at narrow
   widths, which is exactly how the wishlist header bug was found and fixed.
4. **Edit, then re-screenshot at the same width(s)** to confirm the fix — don't
   declare it fixed from the diff alone.
5. Run `pnpm lint` (and `pnpm typecheck` for anything non-trivial) before
   considering the change done.

## Known quirks (script-level — only matters if extending ui-snapshot.mjs itself)

- The app uses `HashRouter` — routes live at `#/wishlist`, not `/wishlist`. The
  script handles this; pass routes without a leading `#`.
- Screenshots are viewport-only, not full-page: full-page capture can render
  solid black with this app's fixed-position player bar.
- Routes fade in via a 300ms `AnimatedPage` motion transition. The script waits
  for the loading spinner to clear plus a short settle delay — if a screenshot
  ever comes back solid black, that transition is almost certainly the cause.
