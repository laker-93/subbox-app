# CLAUDE.md — Subbox

Guidance for AI agents working in this repo. Read this first, then `docs/ARCHITECTURE.md` for deeper detail.

## What this is

Subbox is an **Electron desktop music player** (also builds to web/Docker), forked from
[Feishin](https://github.com/jeffvli/feishin) (itself a rewrite of Sonixd). It plays music from
self-hosted servers: **Jellyfin, Navidrome, Subsonic/OpenSubsonic**. The Subbox fork adds
DJ-workflow features on top: **pymix** integration, **filebrowser** access, library **sync**
(rekordbox/Serato, external drive, watch dir), and item **sharing**.

- React 19 + TypeScript, built with `electron-vite` / `vite`.
- UI: Mantine v8 (`@mantine/*`), wrapped in `src/shared/components/*`.
- Data: TanStack React Query + Zustand stores.
- Player backends: **MPV** (native, desktop) and **web** (HTML audio / react-player).
- Package manager: **pnpm** (do not use npm/yarn — there is a `pnpm-lock.yaml`).

## Three runtime contexts (Electron)

Code is split by which process it runs in. Keep this boundary in mind for every change:

| Dir | Process | Notes |
|---|---|---|
| `src/main/` | Electron **main** (Node) | App lifecycle, windows, MPV, MPRIS, media keys, lyrics fetch, IPC handlers. Entry: `src/main/index.ts`. |
| `src/preload/` | **preload** bridge | Exposes a typed `window.api` to the renderer via `contextBridge`. Entry: `src/preload/index.ts`, types in `index.d.ts`. |
| `src/renderer/` | **renderer** (browser) | The React app — features, routing, stores, API controllers. |
| `src/shared/` | shared | Types, Mantine component wrappers, themes, API type defs. Imported by all contexts. |
| `src/remote/` | remote control | Separate small React app (`remote.vite.config.ts`) for the remote-control web UI. |

The renderer talks to main **only** through `window.api.*` (defined in preload). Never import
`electron` directly in renderer code.

## Common commands

```bash
pnpm install              # install (runs electron-builder install-app-deps postinstall)
pnpm dev                  # run desktop app in dev (electron-vite dev)
pnpm dev:web              # run web build in dev
pnpm lint                 # typecheck + eslint + stylelint — run before finishing any change
pnpm typecheck            # tsc for node + web configs only
pnpm lint-code:fix        # eslint --fix
pnpm build                # build electron + remote
pnpm package:linux:pr     # package without publishing (CI dry run)
```

Always run `pnpm lint` before considering a change done — CI enforces `--max-warnings=0`.

## Path alias

`/@/...` maps to `src/...` (configured in the vite configs + tsconfigs). Use it for all
intra-repo imports, e.g. `import { api } from '/@/renderer/api';`.

## Where things live

- **Features** (UI + logic by domain): `src/renderer/features/<feature>/` — typically
  `routes/`, `components/`, `queries/`, `mutations/`, `utils/`.
- **Routes**: enum in `src/renderer/router/routes.ts`, wired in `router/app-router.tsx`
  (lazy-loaded). Add a route by extending both.
- **Server API adapters**: `src/renderer/api/{jellyfin,navidrome,subsonic}/` each export a
  `*-controller.ts` implementing the `ControllerEndpoint` contract.
- **Subbox-specific APIs**: `src/renderer/api/{pymix,filebrowser}/` (separate HTTP services, not
  part of the music-server controller abstraction).
- **API contract types**: `src/shared/types/domain-types.ts` (`ControllerEndpoint`).
- **Stores** (Zustand): `src/renderer/store/` (`auth`, `player`, `settings`, `app`, ...).
- **Shared UI components**: `src/shared/components/*` — prefer these over importing `@mantine/core`
  directly.
- **i18n**: `src/i18n/locales/*.json`; extract with `pnpm i18next`.
- **Env-driven settings** (web/Docker first-run): see `docs/ENV_SETTINGS.md`.

## How to add a feature (cheat sheet)

See `docs/ARCHITECTURE.md` for full walkthroughs. In short:

1. **New music-server capability** (works across Jellyfin/Navidrome/Subsonic): add the method to
   `ControllerEndpoint` in `domain-types.ts`, implement it in each `*-controller.ts`, then add a
   React Query hook under the relevant `features/<x>/queries|mutations/` and call
   `api.controller.<method>`.
2. **New page**: add to `AppRoute` enum + `app-router.tsx`, create
   `features/<x>/routes/<x>-route.tsx`.
3. **New native/OS behavior**: add an `ipcMain.handle(...)` in `src/main/`, expose it in
   `src/preload/`, add the type to `src/preload/index.d.ts`, then call `window.api.*` from renderer.
4. **New Subbox backend call** (pymix/filebrowser): extend the relevant
   `*-api.ts` + `*-controller.ts` under `src/renderer/api/<svc>/`.

## Conventions

- Imports are auto-sorted by `eslint-plugin-perfectionist` — let `lint-code:fix` order them.
- Styles are CSS modules (`*.module.css`) + Mantine; stylelint enforces ordering.
- Keep renderer code free of Node/Electron imports; route through preload.
- This is a **fork** — when touching shared/feature code, prefer matching upstream Feishin patterns
  so future merges stay clean. Subbox-only code (pymix, sync, sharing, filebrowser) has no upstream.

## Gotchas

- Two `react-window` versions coexist (`react-window` v1 and `react-window-v2`) — check which a
  component uses before editing virtualized lists.
- `node-mpv` is a pinned GitHub fork; MPV behavior lives in `src/main/features/core/player/`.
- Three build targets share one codebase via vite config + `vite-plugin-conditional-import`
  (`electron.vite.config.ts`, `web.vite.config.ts`, `remote.vite.config.ts`). A change can affect
  all three.
