# Action required / no-network states (`/action-required`, `/no-network`)

**Verified:** 2026-07-25. `[mixed]` README row.

## `/no-network` — VERIFIED, no bug

`useServerAuthenticated` (`src/renderer/hooks/use-server-authenticated.ts`) runs
on app boot / server change, calling `getUserInfo` against the persisted
server. If that call fails with a genuine network error (`isNetworkError`:
axios `ERR_NETWORK`/`ECONNABORTED`/`ETIMEDOUT`, or `!navigator.onLine`) it
retries once (`MAX_NETWORK_RETRIES=1`, 500ms delay); if the retry also fails as
a network error it navigates to `AppRoute.NO_NETWORK` (`/no-network`,
`NoNetworkRoute`) **without clearing the saved server/credentials** — the
comment in the hook is explicit about preserving them so the app can resume
once connectivity returns.

Drove this live end-to-end via a new driver, `scripts/qa/no-network-journey.mjs`
(account `test260526`): launch 1 logs in normally; launch 2 relaunches with the
persisted session but Playwright-intercepts and aborts every request to the
server's host (`route.abort('connectionrefused')`) — a real network-level
failure, not an HTTP error response, and isolated to the test (no shared
docker container was touched). Confirmed:

- The full-chrome `/no-network` page renders (`NoNetworkRoute`, mounted
  **outside** `AuthenticationOutlet`/`AppOutlet` in `app-router.tsx:328-335`,
  so the sidebar/library-nav/player-bar stay visible around it — by design,
  not a layout bug). i18n key `error.noNetwork` = "server unavailable" /
  `error.noNetworkDescription` = "couldn't connect to this server" — note the
  displayed copy does **not** literally contain the words "no network" (a
  driver gotcha, not a product issue: the route/hash is `/no-network`, the
  rendered text is "Server unavailable").
- Credentials/server ARE preserved in `localStorage` (`store_authentication`)
  while on this page — confirmed via direct read, not just absence of a
  logged-out state.
- Clicking **Retry** navigates to Home, which re-triggers
  `useServerAuthenticated`; once the intercepted requests are unblocked
  (`page.unroute`), the app fully recovers — sidebar, playlists, and player
  bar all reload correctly, no re-login required.

Screenshots: `.ui-snapshots/no-network-blocked-*.png` (error state),
`.ui-snapshots/no-network-recovered-*.png` (post-Retry recovery).

## `/action-required` — CONFIRMED DEAD, unreachable code (not fixed — see bugs.md)

`AppRoute.ACTION_REQUIRED` (`/action-required`) and its full component tree
(`features/action-required/routes/action-required-route.tsx` +
`components/action-required-container.tsx` +
`components/server-credential-required.tsx` + `components/server-required.tsx`)
are never mounted anywhere:

- `grep -rn "AppRoute.ACTION_REQUIRED" src/` → **zero hits** outside the enum
  declaration itself (`router/routes.ts:2`).
- `app-router.tsx`'s `<Routes>` tree has no `<Route path={AppRoute.ACTION_REQUIRED}>`
  and never lazy-imports `action-required-route.tsx` (contrast: it does
  lazy-import and mount `NoNetworkRoute` and `InvalidRoute` from the same
  `action-required/` folder).
- The scenarios `ActionRequiredRoute` was clearly built to cover — no current
  server (`ServerRequired`), a server with no saved credential
  (`ServerCredentialRequired`, with a "Log off" button) — are instead handled
  entirely by `AppOutlet` (`router/app-outlet.tsx`), which renders
  `LandingPage` + `PymixAuthModal` directly whenever `!currentServer`. That's a
  different, subbox-specific flow (pymix-backed login/create-account), not a
  route navigation, so `ActionRequiredRoute` never gets a chance to render.

No live symptom follows from this (nothing a user can trigger reaches it), so
this isn't a `bugs.md`-style correctness bug with a repro — it's dead code,
logged as a latent/no-issue finding per the existing pattern for other
confirmed-unreachable surfaces (pymix `syncTracks` wrong path, serato
`playlistIds`). See `bugs.md` for the entry. Not touched this cycle — removing
it is a cleanup/refactor call (four files, and `ServerCredentialRequired`'s
"log off" affordance has no equivalent in the `AppOutlet` flow, so it's not a
strict no-op deletion), outside the "bug fixes and small UX improvements only"
bar.
