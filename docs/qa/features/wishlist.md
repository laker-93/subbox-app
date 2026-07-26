# Wishlist (`/wishlist`) — client journey

Verified: 2026-07-14, driven end-to-end against the local dev stack with
`scripts/qa/wishlist-journey.mjs` (account `test260526`, dev-mode Electron build).
Sub-flows (bulk actions, parse-link, sheet-status badge) re-verified 2026-07-26,
`scripts/qa/wishlist-bulk-and-sheet.mjs`. Backend half:
`../pymix-qa/docs/qa/features/wishlist-api.md`.

Subbox-only surface — no upstream Feishin equivalent. The wishlist is "tracks I want but
don't have yet": add by hand or by link, `subbox-slskd` hunts them on Soulseek, and a
reconcile sweep flips an item to `available` once it lands in the library.

## What the driver verifies (all 6 steps passing)

1. **List renders and matches the server.** Row count == `GET /wishlist` item count (5),
   and every server item's label appears on screen.
2. **Create** via the header "+" modal → `POST /wishlist` 200 → the new row appears
   **without a manual refresh** (`useCreateWishlistItem` invalidates
   `queryKeys.wishlist.root`). An artist+title item correctly lands `status=wishlist`,
   `resolve_state=pending`.
3. **Expand detail** — clicking a non-`available` row reveals `WishlistItemDetail` inline.
4. **Status transition** — "Mark downloaded" → `PATCH /wishlist/{id}` → server status
   becomes `downloaded` and the row's badge updates.
5. **Edit details** — modal sets an album → `PATCH` → persisted server-side and reflected
   in the row.
6. **Delete** → confirm modal → `DELETE /wishlist/{id}` 200 → row gone from the list and
   from the server; total count returns to its starting value.

No correctness bug was found on the **client** side — the list, the mutations, and the
cache invalidation all behave correctly. The bug this journey surfaced is in the pymix
background resolver: [pymix #31](https://github.com/laker-93/pymix/issues/31), which
silently rewrites hand-typed items to unrelated MusicBrainz matches. It's invisible from
the client's perspective except that the row's text changes on its own.

## How the screen is built

- `routes/wishlist-route.tsx` = `WishlistHeader` + `WishlistContent`, wrapped in a
  `PageErrorBoundary`.
- `WishlistContent` is a **plain Mantine `<Table>`, not ag-grid** — so rows have real
  heights and `table tbody tr` locators just work. (Contrast the songs/genres grids, where
  data rows report height 0 and clicks must be offset ~18px — that quirk does *not* apply
  here.)
- Columns: checkbox, title, artist, album, status badge, trailing icon.
- Row click is **overloaded by status**: an `available` item with a `linked_subbox_id`
  **navigates into the library** (`useNavigateToWishlistTrack`) instead of expanding;
  everything else toggles the inline detail. An `available` item *without* a linked id
  falls back to expanding.
- An `inbox` row shows its `raw_note` in the title column and a blank artist; its detail
  pane offers only Edit + Delete.
- Selecting rows reveals `WishlistBulkActions`; the selection self-heals against a
  background refetch (items that vanish are dropped from the selection).
- `useWishlist` polls every 15s **only while some item is `resolve_state=pending`**, so the
  resolver's correction and the "resolving…" badge clear without a manual refresh.

## Detail pane actions by status

| status | actions offered |
|---|---|
| `wishlist` | Mark downloaded, Ignore, Delete (+ match/edit) |
| `downloaded` | Mark available, Mark wishlist, Delete (+ match/edit) |
| `ignored` | Mark wishlist, Delete |
| `inbox` | Edit details, Delete |
| `available` | row navigates to the library instead of expanding |

The match/edit block above the status buttons varies by source: a Bandcamp URL → "Open on
Bandcamp"; SoundCloud → an embedded player; YouTube → an embedded video + "Find another
match"; no URL at all → "Match preview" (`POST /wishlist/{id}/match-youtube`).

## Sub-flows re-verified 2026-07-26 (`wishlist-bulk-and-sheet.mjs`)

1. **Sheet sync status badge.** Read-only check: the header's error-colored badge
   icon appears whenever `GET /wishlist/sheet/status` reports `status: 'error'`,
   and its tooltip surfaces the server's `error` string verbatim. Confirmed live
   against this account's real broken sheet link (`404 Requested entity was not
   found` — the linked Google Sheet is deleted/unshared) — badge visible, tooltip
   text matched exactly.
2. **Bulk actions.** Selecting 2 rows (checkboxes) surfaces `WishlistBulkActions`;
   "Mark downloaded" fires one `PATCH` per selected row (not a single batched
   call) and both transition correctly; bulk delete fires one `DELETE` per row
   and both are gone client + server-side. Selection is cleared after each bulk
   action (re-select needed between steps — not a bug, matches the self-healing
   selection behavior already documented above).
3. **Parse-link single-track prefill.** Pasting a link and blurring the field
   resolves via `resolveLink` and fills Artist/Title. **Found + fixed a real bug
   here** (issue #44): `create-wishlist-modal.tsx`'s Link `TextInput` set
   `onBlur={handleLinkBlur}` *before* spreading `{...form.getInputProps('link')}`;
   the spread's own validation `onBlur` silently overwrote it, so the prefill
   never fired. Fixed by reordering so `handleLinkBlur` runs after the spread.
   Re-verified live: pasting a stable YouTube link and blurring now correctly
   fills `artist="Rick Astley" title="Never Gonna Give You Up"` (previously both
   stayed empty).

Still unchecked: collection-link create (a playlist/album URL that expands to
multiple items), inbox items, a full Google-Sheet sync round-trip (only the
status-badge half was driven — no sheet was actually linked/synced), and
match-youtube.

## Driver gotchas (cost real time — don't re-derive)

- **Fixed 2026-07-25:** the header "+" button now has `aria-label="add to
  wishlist"` (`wishlist-header.tsx`), so `getByRole('button', { name: 'add to
  wishlist' })` resolves it directly — re-verified live. `wishlist-journey.mjs`
  still anchors to the "Offline Wishlist" button's next sibling (not touched this
  cycle) but could be simplified to the role query if the driver is revisited.
  See `ux-notes-archive.md` (IMPROVED) for the full writeup.
- **Label is "Edit details", not "Edit entry"** (`action.editWishlistItem` = `'edit details'`).
  Likewise the create submit is "Create" and the edit submit is "Save".
- **pymix's resolve loop rewrites hand-typed scratch text within a cycle or two** (that's
  pymix #31). Track a scratch item by its `wishlist_id`, never by the text you typed — the
  driver does.
- Scratch items **must be cleaned up**: an aborted run leaks a row into the account's real
  wishlist. The driver deletes its own item at the end and asserts the total count returns
  to baseline; a crashed run needs a manual
  `DELETE /wishlist/{id}?username=test260526`.
- The dev account's 5 rows are the user's **real data** — the journey only reads/counts them.
