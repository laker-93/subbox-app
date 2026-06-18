---
name: ui-snapshot
description: Screenshot any route of subbox-app — the web build or the Electron desktop build — at a chosen window size, so a reported or suspected UI/layout problem can be visually inspected and fixed instead of guessed at. Use whenever asked to fix, check, or verify a UI bug — misaligned/overlapping/off-screen elements, broken responsive layout, "this looks wrong" in the browser or the desktop app, or any visual regression — and whenever a UI change should be confirmed by actually looking at it before declaring it done.
---

# UI snapshot

Logs into the app with a local test account and screenshots a given route at a
given window size — in the web build (`scripts/ui-snapshot.mjs`) or the Electron
desktop build (`scripts/ui-snapshot-electron.mjs`) — so UI problems can be
diagnosed and fixed by actually looking at the rendered page rather than
reasoning about CSS blind.

This is the default tool for any "fix this UI bug" request in subbox-app. Don't
attempt to diagnose a layout/alignment/overflow problem from source alone —
reproduce it with a screenshot first. If a report doesn't say which build
(browser vs desktop app), check the web build first — it's faster to iterate on
— then confirm with the Electron script if the bug could plausibly be
desktop-specific (window chrome, native title bar, MPV-related UI) or if the web
fix needs cross-checking in the actual desktop app before calling it done.

## Shared setup (both scripts)

1. The local dev stack must be up (`../traefik`) — pymix and the per-user Navidrome
   container the test account auths against both live there. See
   `../subbox-workspace/docs/deployment.md`.
2. `.env.ui-snapshot.local` must exist with `UI_SNAPSHOT_USERNAME` /
   `UI_SNAPSHOT_PASSWORD` for a test account (copy `.env.ui-snapshot.local.example`
   if missing and ask the user for credentials — never invent them). Gitignored —
   never commit real credentials into the example file.
3. Both scripts print the absolute path of the saved PNG to stdout — **Read that
   file** to actually look at the result; don't infer the outcome from the script
   exiting successfully.

## Web build: `scripts/ui-snapshot.mjs`

```bash
node scripts/ui-snapshot.mjs <route> [width] [height]
```

Extra prerequisite: `pnpm dev:web` must be running (port 4343 by default — check
the log if it falls back to another port because a previous instance is already
running). Start it in the background if it isn't.

## Electron desktop build: `scripts/ui-snapshot-electron.mjs`

```bash
node scripts/ui-snapshot-electron.mjs <route> [width] [height]
```

Extra prerequisite: build first, pointed at the local dev stack —

```bash
npx electron-vite build --mode development
```

(`pnpm run build:electron` defaults to **production** URLs — `pymix.sub-box.net`
etc — and will silently 502/401 against the real production backend instead of
your local stack. Always pass `--mode development` for this.) Rebuild before
every snapshot run that should reflect a source change — there's no hot reload
here, unlike the web build.

The script launches a real Electron process via Playwright's `_electron` driver,
resizes the actual OS window to the requested size (`width`/`height` map to the
window's content size, not a browser viewport), logs in if needed, navigates,
and screenshots. It closes the app when done.

## Both: shared args

- `route` is an app-internal path from the `AppRoute` enum
  (`src/renderer/router/routes.ts`), e.g. `/wishlist`, `/favorites`, `/`.
- `width`/`height` default to `1440x900`. Responsive/overlap bugs often only show
  up at narrower widths — also check e.g. `1024 900` and `800 900` whenever the
  bug report mentions misalignment, overlap, or off-screen elements, even if no
  specific width was given. The Electron window's real minimum is 480x120 (see
  `minWidth`/`minHeight` in `src/main/index.ts`) if you need to test near that.

## Fix loop

For any UI bug, regardless of cause:

1. **Reproduce.** Screenshot the affected route in whichever build(s) are
   relevant. If the report mentions a specific window size, use it; otherwise try
   the default plus a narrower width (most real layout bugs are width-dependent).
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
   declare it fixed from the diff alone. For Electron, remember to rebuild
   (`npx electron-vite build --mode development`) before re-screenshotting.
5. Run `pnpm lint` (and `pnpm typecheck` for anything non-trivial) before
   considering the change done.

## Known quirks (script-level — only matters if extending these scripts)

- The app uses `HashRouter` — routes live at `#/wishlist`, not `/wishlist`. Both
  scripts navigate via a real `page.goto(...#route)`, not by mutating
  `window.location.hash` directly — the latter is racy in Electron (the
  hashchange listener isn't guaranteed to be attached yet on a fresh mount, so
  the navigation can be silently dropped).
- Screenshots are viewport-only, not full-page: full-page capture can render
  solid black with this app's fixed-position player bar.
- Routes fade in via a 300ms `AnimatedPage` motion transition, and route data
  loads async after navigation. `waitForRouteSettled` (in
  `scripts/ui-snapshot-shared.mjs`) waits for the loading spinner to clear plus a
  settle delay — if a screenshot ever comes back solid black, that transition is
  almost certainly the cause.
- **The pymix session credential is short-lived (~5–10 min observed).** A
  freshly-launched process that resumes a saved/persisted session (web's
  `auth-state.json`, Electron's own persisted profile) can load an already-expired
  token; the app retries the failing request a few times but never re-logs-in on
  its own, so the route gets stuck on its loading spinner indefinitely. Both
  scripts detect this (`waitForRouteSettled` returns whether it's still stuck) and
  recover via `forceFreshLogin` + a retry — if you see a screenshot stuck on a
  spinner, this expired-session path failing to recover is the first thing to
  check, not a real app bug.
- Electron's window size is controlled via the main process
  (`electronApp.evaluate(({ BrowserWindow }) => ...)`), not
  `page.setViewportSize()` — that only applies to normal browser pages.
- Electron is launched with `NODE_ENV=development` and `DISABLE_AUTO_UPDATES=1`.
  This isn't just for speed: in production mode the app calls
  `app.requestSingleInstanceLock()` and would quit immediately if you have the
  real Subbox app open, and it'd hit the live auto-updater. Development mode also
  uses a separate `<userData>-dev` profile, so this never touches your real
  installed app's data (see `src/main/index.ts`).
