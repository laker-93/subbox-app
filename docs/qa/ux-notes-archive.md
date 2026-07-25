# UX-notes archive (subbox-app)

Inert history — full text of `RESOLVED` (not-a-bug determinations) and `IMPROVED`
notes, moved out of `ux-notes.md` so that hot file (re-read on every turn of every
cycle) stays small. **The loop never reads this file.** `ux-notes.md` keeps a
one-line index of everything archived here. Same pattern as `directives-archive.md`.

## IMPROVED (fixed conservatively)

### The wishlist header's "+" (add item) button has no accessible name

Added: 2026-07-14. Fixed: 2026-07-25. Route `/wishlist`
(`features/wishlist/components/wishlist-header.tsx`). Found while writing
`scripts/qa/wishlist-journey.mjs`. See `features/wishlist.md`.

**What was rough.** The only way to add a wishlist item was an icon-only
`ActionIcon` (`icon="add"`) that carried a `tooltip` but no `aria-label`. Confirmed
by DOM probe: the button exposed `aria-label: null` and no text content, so it had
no accessible name at all. A screen-reader user heard an unlabelled button; a
keyboard user got no hint (the tooltip is hover/focus-delayed, `openDelay: 300`).
The sibling control right next to it ("Offline Wishlist") is a plain labelled
`Button`, so the primary action on the page was the *less* discoverable of the two.

The `WishlistContent` checkboxes right below it do set `aria-label`
(`page.wishlist.selectAll` / `selectRow`), so this was inconsistent within the
same feature, not a house style.

**Fix.** Added `aria-label={t('action.addToWishlist', { postProcess: 'sentenceCase' })}`
to the `ActionIcon` in `wishlist-header.tsx` — reused the existing
`action.addToWishlist` = "add to wishlist" string (already used as the modal
title), no new copy needed. Scoped to just this one button, not the app-wide
icon-only-header pattern (same shape noted for the genres/albums header Play
control in `features/genres-browse.md`) — that stays a separate design call.

**Verified live.** Built with `electron-vite build --mode development`, launched
via Playwright, navigated to `/wishlist`: `getByRole('button', { name: 'add to
wishlist' })` now resolves to exactly 1 element (previously 0). `pnpm lint-code`
and `pnpm typecheck` clean.

**Knock-on for QA.** `wishlist-journey.mjs` still anchors to the "Offline
Wishlist" button and takes its next sibling rather than querying by role/name —
not changed this cycle (out of scope for this fix), but the driver could now use
a direct role query if touched again.

## RESOLVED (not a bug — kept so it isn't re-investigated)

### First "Preview Download" click after launch always 400s once, then silently retries and succeeds

Added: 2026-07-09. Root-caused: 2026-07-09.

**Verdict: working as designed, not a bug.** `src/renderer/api/pymix/pymix-api.ts`
(`isPymixAuthError` / the `axiosClient.interceptors.response` handler, lines
~294-378) explicitly treats a `400` with detail `"...session id to identify
user..."` as pymix's way of saying "your session cookie lapsed" (documented
in a comment right above `reauthenticatePymix`: pymix returns 400/404 instead
of 401 for this case). On such an error it silently re-logs in
(`POST /user/login`) and replays the original request once — by design, so
the user never sees an error for what is themselves a normal "session
expired, refresh it" case. On a fresh Electron launch the persisted
`session_id` cookie is often already stale (pymix sessions are short-lived —
see the `bugs.md`/architecture notes elsewhere), so the *first* pymix call
after launch commonly hits this path. This matches the 400's exact detail
string (`"Must have a username or session ID to identify user"`, raised in
`pymix/routers/sync.py`'s `sync_plan()`) and reproduced identically
regardless of the pymix image under test, consistent with pre-existing,
unrelated-to-#21 behavior.

No fix needed. Also documented in `features/sync.md` so a future cycle doesn't
re-investigate the same "why does the console show a 400" observation from
scratch.
