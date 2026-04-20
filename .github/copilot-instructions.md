# Subbox Copilot Instructions

## Architecture Overview

**Subbox** is an Electron desktop music player with support for multiple server backends (Subsonic, Navidrome, Jellyfin) and web deployment. The codebase follows a monorepo pattern with four distinct runtime environments:

- **`src/main`** - Electron main process (node runtime). Handles window management, IPC, auto-updates, media keys, platform-specific features.
- **`src/preload`** - Electron preload scripts. Exposes safe APIs to renderer via `contextBridge` (e.g., `window.api.ipc`, `window.api.mpvPlayer`).
- **`src/renderer`** - React SPA (Chrome 87+). Music player UI, built with Vite + React 19, Mantine UI, TanStack Router.
- **`src/remote`** - Separate web player for remote control. Simpler React app, deployed independently.

**Key Build Insight**: The project uses `electron-vite` which conditionally imports platform-specific code (darwin/linux/win32) defined at build time via `import.meta.env.IS_MACOS` etc.

## Data Flow & State Management

### Renderer Store Architecture
Uses **Zustand** with middleware (persist, immer, devtools, subscribeWithSelector):
- **`useAuthStore`** - Server connections, credentials, currentServer
- **`usePlayerStore`** - Queue, playback state, progress; persisted to IndexedDB
- **`useSettingsStore`** - App configuration; persisted, versioned migrations
- **`useAppStore`** - UI state (sidebar, modals, titlebar)
- **`useTimestampStoreBase`** - Player progress (separate for subscriptions)

Store exports typed selectors: `usePlayerStore.use.currentSong()`, `useSettingsStore((s) => s.general)`.

### API & Data Fetching
**TanStack React Query** (v5) with custom wrapper layer:
- `src/renderer/api/controller.ts` - Router that dispatches to server-specific controllers (Jellyfin/Navidrome/Subsonic)
- Query keys centralized in `src/renderer/api/query-keys.ts` with hierarchy: `[serverId, 'songs', 'list', filter, pagination]`
- Mutations with optimistic updates + event invalidation (see `favorite-optimistic-updates.ts`)
- Infinite queries with custom loader: `useItemListInfiniteLoader` manages virtual scrolling cache

**Critical pattern**: Queries dehydrate only lyrics to IndexedDB; other data uses QueryClient cache.

### IPC Communication (Main ↔ Renderer)
- **Preload layer** (`src/preload/ipc.ts`) wraps `ipcRenderer` with `invoke`, `send`, `on` methods
- **Main listeners** in `src/main/index.ts` respond to window control channels
- **Player updates** via events (e.g., `ipcMain.on('update-playback')` from dock menu)
- No direct Node.js imports in renderer; all access via preload API

## Critical Developer Workflows

### Development
```bash
pnpm dev              # Watch mode (main + renderer + preload)
pnpm dev:remote       # Remote web player only
```

### Building & Packaging
```bash
pnpm build            # Build main + web
pnpm package:mac      # macOS .dmg
pnpm package:linux    # AppImage
pnpm package:win      # Windows installer
```

**Build sequence**: `electron-vite build` → `vite build --config remote.vite.config.ts`

### Linting & Type Checking
```bash
pnpm lint            # Full lint (code + styles + typecheck)
pnpm typecheck       # Separate: typecheck:node + typecheck:web
pnpm lint:fix        # Apply all fixes
```

**TypeScript configs**: Three separate tsconfigs—`tsconfig.node.json` (main/preload), `tsconfig.web.json` (renderer/remote).

## Project Conventions

### Path Aliases
All source files use `/@/` aliases (configured in vite):
- `/@/main`, `/@/preload` - Main/preload source
- `/@/renderer`, `/@/remote` - Renderer/remote source
- `/@/shared` - Shared types, components, utilities (cross-process)
- `/@/i18n` - i18n configuration

### Component & Store Patterns
1. **Hooks with suffixes**: `usePlayer`, `useSidebar`, `useSettings` all follow store selector pattern
2. **Feature isolation**: `/src/renderer/features/{feature}/` contains domain logic (api, components, hooks, mutations)
3. **CSS Modules**: All styles use CSS modules with prefix `fs-[name]-[local]`

### Mutations & Optimistic Updates
Mutations follow a pattern:
1. Optimistic update applier function: `applyFavoriteOptimisticUpdates()`
2. Restore function on error: `restoreFavoriteQueryData()`
3. Query invalidation on success with `useQueryClient().invalidateQueries()`

### i18n
- Namespace: default English in `src/i18n/locales/en.json`
- Key format: `t('feature.action.status')` with `postProcess: 'sentenceCase'`
- Lazy translation initialization in components via `useTranslation()` hook

## Integration Points & External Dependencies

### Music Server APIs
Three controllers per server type implement same interface:
- `src/renderer/api/{jellyfin,navidrome,subsonic}/`
- Each has `Controller` class with methods: `getAlbumList`, `playSong`, `setRating`, etc.
- Uses **axios** for HTTP; retry/error handling at QueryClient level

### Electron APIs
- **Media keys**: `src/main/features/core/player/media-keys.ts` - platform-specific shortcuts
- **Notifications**: Uses native OS notifications via Electron
- **File system**: Preload exposes `localSettings` for persistence (not full fs access)
- **Auto-updates**: `electron-updater` with platform-specific channels (alpha/beta/stable)

### MPV Player
- Preload exposes `window.api.mpvPlayer` for controlling external MPV process
- Player state synced via `ipcRenderer.on('playback-update')`
- Web player uses fallback web audio backend

### Discord RPC
- Preload exposes `window.api.discordRpc` singleton
- Managed in main process; updates via `ipcRenderer.send('update-rich-presence')`

## When Modifying Key Systems

- **Adding a store**: Create in `src/renderer/store/`, export selectors, use `devtools()` middleware
- **Adding an API endpoint**: Extend controllers in all three server implementations, add query keys in centralized file
- **New feature UI**: Create in `/renderer/features/{feature}/`, follow store+hooks+mutations pattern
- **Cross-process communication**: Always route through preload layer, never direct Node imports in renderer
- **Settings migration**: Increment `version` in persist options, implement `migrate()` function

