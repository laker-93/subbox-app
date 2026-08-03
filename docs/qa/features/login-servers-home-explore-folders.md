# Login/servers, Home/Explore, Folders (`/login`, `/servers`, `/`, `/explore`, `/library/folders`)

**Verified:** 2026-08-03. Closes out 3 `[upstream]` README rows. Driver
`scripts/qa/login-servers-home-folders-journey.mjs`, account `test260526`.

## `/` (Home) — VERIFIED, works well

Real content: 30 cards / 42 carousel-ish elements across "Home", a spotlight
album, "Genres", "Most played", "**Explore from your library**", "Newly added
releases", "Recently played", "Recently released". The spotlight album/heading
rotates per load (seen "Live at Yoshi's" and "The Sound of Dubstep 4" across
two runs) — expected randomized-pick behavior, not flakiness.

## `/explore` — CONFIRMED DEAD, unreachable code (not fixed — see bugs.md)

`AppRoute.EXPLORE = '/explore'` exists **only** as an enum value:
`grep -rn "AppRoute.EXPLORE\|ExploreRoute\|'/explore'" src/renderer` → one hit,
the enum declaration itself. No route is mounted for it in `app-router.tsx`
(unlike `HOME`, which is mounted twice — index and `/`), and nothing links to
it. Hash-navigating there live renders the app's `InvalidRoute` 404 ("Unable to
route request — /explore") inside full app chrome — graceful, not a crash, but
confirms there is no Explore screen at all. This isn't a regression: Home's own
"Explore from your library" carousel (see above) appears to be where that
concept actually lives today; the standalone route looks like a leftover enum
from an earlier design, same shape as the already-documented `ACTION_REQUIRED`
dead route.

## `/library/folders` — VERIFIED, works well

Root: 332 folders/items listed (ag-grid list, not anchor-based — same pattern
as Genres/Songs). Double-clicking the first data row descends correctly: URL
gains `?folderPath=[{"id":"...","name":"2XM"}]`, row count changes to reflect
the subfolder's contents, breadcrumb-style "Home" link at the top returns to
root. No bug.

## `/login` — reachable-but-broken dead end (not fixed — see bugs.md); `/servers` — CONFIRMED DEAD, unreachable code

Both are the *classic* upstream-Feishin manual-server-entry flow
(`SERVER_LOCK`-gated single-server-kiosk login), a different mechanism from
subbox's real login path (pre-login `LandingPage` → `PymixAuthModal`, gated by
`AppOutlet`'s `!currentServer` check — exercised by every other driver's
`performLogin`). `grep -rn "AppRoute.LOGIN\b" src/renderer` and
`AppRoute.SERVERS` both return **zero** hits outside `routes.ts`/
`app-router.tsx` — nothing in the app ever navigates to either route
(`to={AppRoute.LOGIN}`, etc.), so a real user never lands here through normal
use.

**Structurally, `/login` isn't even behind the same auth gate as the rest of
the app** — in `app-router.tsx`'s `<Routes>` tree, `LoginRoute` is mounted as a
**sibling** of `AuthenticationOutlet`/`AppOutlet`, not nested inside it, so it
renders unconditionally regardless of `currentServer` state:

- **Authenticated** (`currentServer` set): `LoginRoute`'s own top-of-component
  check (`if (currentServer) return <Navigate replace to={AppRoute.HOME} />`)
  correctly bounces back to Home. Verified live — no bug.
- **Logged out** (`currentServer` null, the state a real unauthenticated user
  would actually be in): `LoginRoute` requires `window.SERVER_TYPE` /
  `window.SERVER_URL` to be set (the `SERVER_LOCK` build-time config a subbox
  build never sets) — with those invalid, it renders a bare **"An error
  occurred / No server selected"** page that dumps its raw internal config
  array as JSON directly onto the screen, with **no link back to the real
  landing page and no way to recover except manually editing the URL hash**.
  Live-captured body text:
  ```
  An error occurred
  No server selected
  [
    {"isValid":true,"key":"SERVER_LOCK","value":false},
    {"isValid":false,"key":"SERVER_TYPE","value":null},
    {"isValid":true,"key":"SERVER_NAME","value":""},
    {"isValid":false,"key":"SERVER_URL","value":""},
    {"isValid":true,"key":"REMOTE_URL","value":""}
  ]
  ```

`/servers` isn't mounted as a route at all (`grep -rn "AppRoute.SERVERS"
src/renderer` → zero hits outside `routes.ts`) — it falls through to the same
`InvalidRoute` 404 as `/explore`, gracefully, inside full app chrome. No bug
there.

**Why not fixed.** Same shape as the already-documented `/action-required`
dead code and pymix's `syncTracks`/serato-`playlistIds` unreachable-surface
findings: no real user can hit either route today (nothing links to them), so
there's no live correctness bug with a repro, and "fixing" `/login`'s dead-end
page would mean either wiring `SERVER_LOCK` config into subbox builds (a
deployment/feature decision, not a bug fix) or deleting the whole classic
login/servers flow (a multi-file cleanup call, since `/login`'s authenticated-
redirect branch is technically live-correct and would need to be preserved or
re-homed) — outside the conservative "bug fixes and small UX improvements
only" bar. Logged informationally, no `qa-bug` issue, per the established
policy for this class of finding.
