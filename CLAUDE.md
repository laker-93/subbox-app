# CLAUDE.md — subbox-app (client)

Electron + React 19 desktop/web music player, forked from
[Feishin](https://github.com/jeffvli/feishin). It adds subbox's DJ-workflow features
(pymix backend integration, library sync, sharing, filebrowser) on top. Cross-repo
context lives in `../subbox-workspace/`.

**Read `docs/ARCHITECTURE.md` before making changes** — the process model, the
music-server `ControllerEndpoint` abstraction, the subbox-specific services
(pymix/filebrowser), state, routing, styling, build targets, and the add-a-feature
walkthroughs all live there. Env-driven settings (web/Docker) are in `docs/ENV_SETTINGS.md`.

`docs/qa/` holds the continuous-UX loop's journals — `features/*.md` records behaviour
that was **actually driven and verified**, so it's the best answer to "what is this flow
supposed to do?"; `bugs.md` / `ux-notes.md` say what's known-broken. Check them before
re-investigating a flow. The loop itself is documented in `../subbox-workspace/docs/qa.md`.

## Invariants (get these wrong and the build or a future merge breaks)

- **pnpm only** — never npm/yarn (there is a `pnpm-lock.yaml`).
- **Run `pnpm lint` before finishing** any change — CI enforces `--max-warnings=0`
  (typecheck + eslint + stylelint). If you touched i18n strings, run `pnpm i18next`.
- **Renderer never imports `electron`** — it reaches the main process only through
  `window.api.*` (defined in `src/preload/`). See ARCHITECTURE.md §1.
- **`/@/…` maps to `src/…`** — use it for all intra-repo imports.
- **This is a fork.** When touching shared/upstream code, match Feishin patterns so
  merges stay clean. Subbox-only code (pymix, sync, sharing, filebrowser) has no upstream.
- **Navidrome/Subsonic only.** The Jellyfin controller is inherited dead code — never
  let its capabilities or limits shape a design.

## Gotchas

- Two `react-window` versions coexist (`react-window` v1 + `react-window-v2`) — check
  which a component uses before editing virtualized lists.
- One codebase → three build targets (desktop/web/remote); web & remote have no main
  process, so `window.api` calls must degrade gracefully. See ARCHITECTURE.md §7.
