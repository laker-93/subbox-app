# Subbox Architecture

Companion to the root `CLAUDE.md`. This explains the data-flow seams an agent needs in order to
add features safely. Subbox is a fork of Feishin with added DJ-workflow features.

## 1. Process model

Electron splits the app into three JS contexts plus a shared layer:

```
┌─────────────────┐   IPC (ipcMain/ipcRenderer)   ┌──────────────────────────┐
│   main (Node)   │ <───────────────────────────> │   preload (contextBridge) │
│  src/main/*     │                                │   src/preload/*           │
└─────────────────┘                                └────────────┬─────────────┘
        │ MPV, MPRIS, media keys,                      window.api │ (typed)
        │ lyrics scraping, file open,                             ▼
        │ auto-update, discord-rpc              ┌──────────────────────────────┐
        └─────────────────────────────────────>│   renderer (React app)        │
                                                │   src/renderer/*              │
                                                └──────────────────────────────┘
                         src/shared/*  ── types, UI wrappers, themes (imported everywhere)
```

- **Renderer never imports `electron`.** It calls `window.api.<group>.<fn>()`, defined by
  `src/preload/index.ts` and typed in `src/preload/index.d.ts`.
- `window.api` groups: `autodiscover, browser, discordRpc, ipc, localSettings, lyrics, mpris,
  mpvPlayer, mpvPlayerListener, remote, utils` (see `src/preload/index.ts`).
- The **web** and **remote** builds run renderer code without a main process; features that depend
  on `window.api` must degrade gracefully (`is-electron` is used to branch).

### Adding a native (main-process) capability

1. `src/main/index.ts` (or a module under `src/main/features/`): register
   `ipcMain.handle('my-thing', async (_e, arg) => {...})` for request/response, or `ipcMain.on`
   for fire-and-forget.
2. `src/preload/<group>.ts`: wrap it — `myThing: (arg) => ipcRenderer.invoke('my-thing', arg)`.
3. `src/preload/index.d.ts`: add the type so the renderer gets autocompletion.
4. Renderer: call `window.api.<group>.myThing(arg)`.

Existing IPC handlers to model on live around `src/main/index.ts:531-970` (window controls,
cache clear, power-save-blocker, `open-item`, `download-url`).

## 2. Music-server API abstraction (the core pattern)

Subbox supports three music servers behind **one interface**. This is the most important pattern
in the codebase.

```
renderer feature
   │  api.controller.getAlbumList({...})
   ▼
src/renderer/api/controller.ts   ── apiController(endpoint, serverType)
   │  picks adapter by current server type
   ▼
endpoints = { jellyfin, navidrome, subsonic }
   │
   ▼
src/renderer/api/<type>/<type>-controller.ts   ── implements ControllerEndpoint
   │  builds request via ts-rest client in <type>-api.ts
   ▼
remote music server (HTTP)
```

- The contract is `ControllerEndpoint` in `src/shared/types/domain-types.ts` (~line 1371). Every
  method (e.g. `getAlbumList`, `createPlaylist`, `scrobble`, `shareItem`) is declared here.
- Each server type implements it: `src/renderer/api/{jellyfin,navidrome,subsonic}/*-controller.ts`.
- `controller.ts` resolves the right adapter from the **current server** (`useAuthStore`) and also
  injects cross-cutting context like `pathReplace` settings (`addContext`).
- Methods marked optional (`?:` in the type, e.g. `getLyrics?`, `shareItem?`, `setRating?`) need
  not be implemented by every server; `apiController` throws a user-facing toast if a feature is
  called on a server that lacks it.

### Adding a music-server endpoint

1. Add the method signature to `ControllerEndpoint` (and the `*Args`/`*Response` types) in
   `domain-types.ts`. Make it optional (`?:`) if not all servers can support it.
2. Implement it in each `*-controller.ts` (or only the relevant ones, if optional).
3. Wrap it in a React Query hook, calling `api.controller.<method>`. Placement varies by
   feature — `features/<domain>/api/` and `features/<domain>/hooks/` for reads,
   `mutations/` for writes. (There is no `queries/` directory; older notes claiming one
   are wrong.)
4. Add query keys in `src/renderer/api/query-keys.ts` for cache invalidation.

See `src/renderer/features/sharing/mutations/share-item-mutation.ts` for a minimal mutation
example.

## 3. Subbox-specific services (not part of the controller abstraction)

These are separate HTTP backends the fork adds. They live alongside but **outside** the
music-server controller (they are not in `endpoints`):

| Service | Code | Purpose |
|---|---|---|
| **pymix** | `src/renderer/api/pymix/{pymix-api,pymix-controller}.ts`, `src/shared/api/pymix/pymix-types.ts` | DJ mix backend: login, import, track matching, rekordbox/Serato export jobs, sync plans, wishlist, storage checks. Schemas are Zod (`pymixType._parameters.*`). |
| **filebrowser** | `src/renderer/api/filebrowser/` | The user's file storage. Now used mainly for **auth + uploads**; produced zips/XML are downloaded back through pymix's `/sync/download/{filename}` instead, so they ride the pymix session. |

UI for these is under `src/renderer/features/{pymix,sync,sharing,wishlist}/`:

- `pymix/` — the auth modal and `authenticate-services.ts` (which servers a login wires up).
- `sync/` — rekordbox XML (parsing/upload driven from the main process,
  `src/main/features/core/sync/`, TUS to filebrowser), external drive, download, and
  watch-dir flows. These components call `PymixController` directly rather than through hooks.
- `wishlist/` — the fullest React Query example: one hook per endpoint in `hooks/use-*.ts`.

Auth for pymix is a **`session_id` cookie**; requests must be sent with credentials.
A 401 means the cookie lapsed and the interceptor should refresh and replay — don't
treat it as a logout.

When extending these: add the endpoint to `pymix-api.ts` (HTTP client) and
`pymix-controller.ts` (typed wrapper), define request/response Zod schemas in the shared
`pymix-types.ts`, then build the hook + UI. A pymix response-shape change is a runtime
break here even if it typechecks — see `../subbox-workspace/docs/integration.md`.

## 4. State management

- **Server-state / caching**: TanStack React Query. Hooks live in `features/*/api`,
  `features/*/hooks` and `features/*/mutations` — match whichever the feature you're in
  already uses. Cache keys are centralised in `src/renderer/api/query-keys.ts`.
- **Client-state**: Zustand stores in `src/renderer/store/`:
  - `auth.store.ts` — current server + credentials (drives `controller.ts` adapter selection).
  - `player.store.ts` — queue, current track, play state.
  - `settings.store.ts` — all user settings (env-overridable on web; see `env-settings-overrides.ts`
    and `docs/ENV_SETTINGS.md`).
  - `app.store.ts`, `full-screen-player.store.ts`, `scroll.store.ts`, `sleep-timer.store.ts`,
    `timestamp.store.ts`.

## 5. Routing

- All routes enumerated in `src/renderer/router/routes.ts` (`AppRoute` enum).
- Wired in `src/renderer/router/app-router.tsx` using `react-router` `HashRouter`, all route
  components **lazy-loaded** with `Suspense`.
- Layouts/outlets: `AuthenticationOutlet`, `ResponsiveLayout`, `AppOutlet`, `TitlebarOutlet`.
- To add a page: add an `AppRoute` entry, create `features/<x>/routes/<x>-route.tsx`, register a
  lazy `<Route>` in `app-router.tsx`.

## 6. UI components & styling

- Prefer the wrappers in `src/shared/components/<name>/` over importing `@mantine/core` directly —
  they encode Subbox defaults/theming. Most Mantine primitives are already wrapped.
- Styling: CSS modules (`*.module.css`) + Mantine + `postcss-preset-mantine`. Stylelint enforces
  `recess`/`standard` ordering (`pnpm lint-styles`).
- Themes: `src/shared/themes/<theme>/` (~30 built-in themes). Theme selection is a setting.

## 7. Build targets

One codebase, three outputs, selected by config:

| Target | Config | Command |
|---|---|---|
| Desktop (Electron) | `electron.vite.config.ts` | `pnpm dev`, `pnpm build`, `pnpm package:*` |
| Web | `web.vite.config.ts` | `pnpm dev:web`, `pnpm build:web` |
| Remote control | `remote.vite.config.ts` | `pnpm dev:remote`, `pnpm build:remote` |

`vite-plugin-conditional-import` swaps implementations per target (e.g. MPV vs web player). When
editing player/IPC-touching code, consider all three targets — web/remote have no main process.

Packaging is via `electron-builder` (`electron-builder*.yml` for stable/alpha/beta channels).

## 8. Player backends

- **MPV** (desktop default): `src/main/features/core/player/` drives `node-mpv` (pinned fork).
  Renderer controls it via `window.api.mpvPlayer` and listens via `mpvPlayerListener`.
- **Web**: HTML audio / `react-player` / `wavesurfer.js` in the renderer.
- OS integration: MPRIS (Linux, `src/main/features/linux/mpris.ts`), media keys
  (`src/main/features/core/player/media-keys.ts`), dock menu (darwin), discord-rpc.

## 9. Pre-flight before finishing a change

```bash
pnpm lint     # typecheck + eslint(--max-warnings=0) + stylelint — must pass
```

If you touched i18n strings, run `pnpm i18next` to update locale files. If you changed
player/native behavior, manually run `pnpm dev` and exercise the path — typecheck does not verify
runtime behavior.
