# Sharing (context-menu "Share item")

**Verified:** 2026-07-21 (API + code trace; not UI-driven — see method note).
**Tag:** `[subbox]` in the README, but the code path is **upstream Feishin's
Navidrome-native share** feature, not a subbox-custom surface.

## What it is

Right-clicking a song/album/album-artist/artist/playlist/folder exposes a
**"Share item"** action (`share-action.tsx`, rendered in all 8 context menus:
`song-`, `album-`, `artist-`, `album-artist-`, `folder-`, `playlist-song-`,
`queue-context-menu.tsx`). It opens `ShareItemContextModal` (expiration,
description, "allow downloading"), and on submit calls
`api.controller.shareItem` → `ndApiClient(...).shareItem` — a **POST to
Navidrome's native `/api/share`** (`navidrome-api.ts:196`, `path: 'share'`). On
success it builds `${serverUrl}/share/${id}`, copies it to the clipboard, and
shows a success toast.

## Verified behavior (the finding)

**The Share action is offered on every item but always fails**, because the
per-user Navidrome in the subbox stack has **sharing disabled** (Navidrome's
default — the container sets no `ND_ENABLESHARING`, and `navidrome.toml` has no
sharing key). When sharing is disabled Navidrome does **not register the
`/api/share` routes at all**, so the client's POST hits a 404.

Empirical proof against the live `navidrometest260526` container (0.60.3), using
a valid native JWT (`POST /auth/login`):

| Request | Result |
|---|---|
| `GET  /api/song?_start=0&_end=1` (auth sanity) | **200** |
| `GET  /api/playlist` (auth sanity) | **200** |
| `GET  /api/share` | **404** page not found |
| `POST /api/share` (song id) | **404** page not found |

Same JWT → other native routes 200, share routes 404 ⇒ the 404 is route-specific
(sharing off), not an auth failure.

**User-facing consequence (code-traced):** `navidrome-controller.ts:1137` treats
`res.status !== 200` as failure and `throw`s; the modal's `onError`
(`share-item-context-modal.tsx:62`) fires `toast.error(form.shareItem.createFailed)`.
So a real user who tries to share anything gets a generic **"Failed to create
share"** error toast with no explanation, on every item type, every time.

Also note: `ShareAction` is rendered **unconditionally** — there is **no feature
gate** on it (contrast: upstream Feishin's `SHARING_ALBUM_SONG` server-feature is
detected purely by version, `navidrome-controller.ts:37` — `0.49.3+` — i.e. by
*version*, not by whether sharing is *enabled*, so even a version gate wouldn't
hide it here). The action is always in the menu.

## Method note (why not UI-driven)

The failure chain is deterministic and fully code-traced, with the root cause
(unregistered `/api/share` route) empirically nailed at the API level, so a full
Electron build + Playwright drive would only re-confirm the toast text already
readable in source. Logged as a design-call item (see `ux-notes.md`), not fixed
this cycle — a UI drive is the natural next step if someone wants to screenshot
the exact toast before deciding the fix.

## The open question (design call — see ux-notes.md)

Either subbox **intends** sharing (then enable `ND_ENABLESHARING=true` in the
per-user Navidrome orchestration — a pymix/traefik deployment change) or it does
**not** (then the client should hide the Share action). Both are out of the
conservative single-repo fix bar; logged for a deliberate decision.
