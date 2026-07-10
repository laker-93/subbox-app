# Feature: Library → Albums browse → album detail → play → Now Playing

**Verified 2026-07-10** by driving the built Electron app (development build,
pointing at the local stack) with `scripts/qa/albums-journey.mjs`. This is a
real-user client-only journey; no backend change involved. Account
`test260526` (774-track real library).

## What was driven, and what happened

1. **Albums grid** (`/library/albums`). Renders a virtualized card grid —
   ~8 album cards in the DOM at a time (16–21 `<a href="/library/albums/:id">`
   anchors, image + title per card). Cards are anchors, so an album id is
   reachable straight from the grid DOM. Screenshot: cover-art tiles.
2. **Album detail** (`/library/albums/:albumId`). Rich header: cover art,
   release type (e.g. "EP"), title, `<date> • N track(s) • <duration> • <size>`,
   album artist, **Play / Next / Last / Album radio** buttons, star rating,
   favorite heart, `…` menu, and below: an external link, GENRE and TAGS
   chips. The track table is virtualized (a 1-track EP renders essentially just
   the header; a 3-track album shows the rows).
3. **Play** — clicking the album header **Play** button starts real playback:
   the `<audio>` element's `currentSrc` becomes a live Navidrome stream
   (`https://navidrometest260526.docker.localhost/rest/stream.view?id=…`),
   `paused=false`, `currentTime` advances. Player bar fills in
   title/artist/album and the `M:SS / M:SS` counter. Verified with album
   "1 on 1 / Empire" (0Distance, 3 tracks).
4. **Now Playing** (`/now-playing`). Full-screen queue with columns
   `# / TITLE / ⏱ / ALBUM / GENRE / YEAR / BPM / ♥`; the currently-playing row
   carries a blue ▶ indicator. The 3 played tracks appeared in order, current
   row highlighted. Window title reflects `(1 / 3) 1 on 1 — Distance — Subbox`.

**Verdict: works cleanly end to end. No bug, no UX friction worth fixing.**
The grid → detail → play → queue transitions are smooth and consistent.

## Gotchas for future cycles (not bugs)

- **`appMode` gates the whole router Outlet.** The app has a persisted
  Library/Sync segmented toggle (`store_app.state.appMode`, values
  `'library'` | `'sync'`). `main-content.tsx` renders `<SyncModePlaceholder/>`
  instead of `<Outlet/>` whenever `appMode === 'sync'` — so **navigating to any
  `/library/*` route while in Sync mode silently shows the Rekordbox-sync
  placeholder, ignoring the URL.** This is by design (a real user clicks the
  "Library" toggle first). If a driver script deep-links a library route and
  lands on the Sync page, set `appMode` to `'library'` first (the journey
  script patches `localStorage.store_app` then reloads — same end state as a
  click, but deterministic vs. clicking the tooltip-wrapped segment label).

- **`/playing` is a dead route — do not file it as a bug.** `AppRoute.PLAYING`
  (`'/playing'`) is defined in `router/routes.ts` but **wired to no route
  element** in `app-router.tsx` (only `AppRoute.NOW_PLAYING = '/now-playing'`
  is), and has **zero usages** anywhere else in the renderer — nothing in the
  UI ever navigates to it. Deep-linking `#/playing` directly hits the app's
  catch-all **"Unable to route request /playing"** error page (with a back
  button), which is correct fallback behavior for an unknown route. A real user
  cannot reach `/playing`; the real queue route is `/now-playing`. Removing the
  orphaned enum value would be refactor/cleanup, which is out of this loop's
  conservative-fix scope, so it's left as-is and documented here instead. The
  coverage checklist lists both `/now-playing` and `/playing`; only
  `/now-playing` is a live route.

## Driver

`scripts/qa/albums-journey.mjs` (reuses the shared login/settle helpers): logs
in, forces `appMode='library'`, walks grid → first album's detail → Play →
`/now-playing`, and reports DOM facts (album ids, play button, `<audio>` state,
queue rows) at each step so a fresh cycle can re-verify quickly.
