# Subbox Client (React/Electron) - Wishlist Feature Implementation Guide

## Goal

Add a new top-level Wishlist section that allows users to manage tracks they want to acquire in the future.

Wishlist items are NOT Navidrome tracks.

Wishlist items are managed through Pymix APIs.

---

## New Domain Model

Create:

```text
src/shared/types/wishlist-types.ts
```

```ts
export type WishlistStatus =
    | 'wishlist'
    | 'downloaded'
    | 'imported'
    | 'available'
    | 'ignored';

export type WishlistItem = {
    id: string;

    artist: string;
    title: string;
    album?: string;

    status: WishlistStatus;

    youtubeVideoId?: string;
    youtubeUrl?: string;

    linkedTrackId?: string;

    createdAt: string;
    updatedAt: string;
};
```

---

## API Layer

Modify:

```text
src/renderer/api/pymix/pymix-api.ts
src/renderer/api/pymix/pymix-controller.ts
```

Add:

```ts
getWishlist()
createWishlistItem()
updateWishlistItem()
deleteWishlistItem()
matchWishlistYoutube()
```

---

## Query Keys

Modify:

```text
src/renderer/api/query-keys.ts
```

Add:

```ts
wishlist: {
    list: (serverId: string) =>
        [serverId, 'wishlist'] as const,
}
```

---

## Feature Structure

Create:

```text
src/renderer/features/wishlist/

wishlist/
├── components/
│   ├── wishlist-content.tsx
│   ├── wishlist-card.tsx
│   ├── wishlist-header.tsx
│   ├── wishlist-status-badge.tsx
│   └── create-wishlist-modal.tsx
│
├── hooks/
│   ├── use-wishlist.ts
│   ├── use-create-wishlist-item.ts
│   ├── use-update-wishlist-item.ts
│   └── use-delete-wishlist-item.ts
│
└── routes/
    └── wishlist-route.tsx
```

Follow the Favorites feature structure.

---

## React Query

Wishlist data should use TanStack Query only.

Do NOT store wishlist items in Zustand.

Use Zustand only for:

* filters
* sort order
* modal state
* selected item

---

## Routing

Modify:

```text
src/renderer/router/routes.ts
```

Add:

```ts
WISHLIST = '/wishlist'
```

Modify:

```text
src/renderer/router/app-router.tsx
```

Register Wishlist route using the same lazy-loading pattern as Favorites and Playlists.

---

## Sidebar

Modify sidebar configuration.

Add:

```text
Wishlist
```

Suggested placement:

```text
Library
Artists
Albums
Playlists
Favorites
Wishlist
```

Suggested icon:

```text
bookmark
heart-plus
shopping-bag
```

---

## Wishlist Page

Page layout:

```text
Wishlist

[ Add Track ]

--------------------------------
Boards of Canada
Dayvan Cowboy

Status: Wishlist

Preview

Mark Downloaded
Ignore
Delete
--------------------------------
```

---

## Create Wishlist Modal

Fields:

```text
Artist *
Title *
Album
```

Required:

```text
Artist
Title
```

---

## Status Actions

Allow status transitions:

```text
wishlist -> downloaded
wishlist -> ignored

downloaded -> wishlist
downloaded -> imported

imported -> available

ignored -> wishlist
```

Frontend should support all statuses even if backend automation arrives later.

---

## YouTube Preview

Display embedded YouTube preview when:

```text
youtubeUrl
```

exists.

If missing:

```text
Match Preview
```

button.

Call:

```http
POST /wishlist/{id}/match-youtube
```

---

## Offline Wishlist (Google Sheets)

Lets a user capture wishlist items **offline** in a Google Sheet. Pymix polls the
sheet and imports new rows into the same wishlist the in-app CRUD writes to. The
backend half (service account, poll loop, `PATCH /wishlist/sheet`) is documented in
`../pymix/wishlist.md`.

### Access model (V1): service-account share-back

The user owns their copy of the template sheet; pymix reads/writes it as a shared
**service account**. So the user must **share their copy with the service-account
email as Editor**. The whole flow is one modal — open it from a button on the
Wishlist page header (next to `Add Track`).

### The modal

```text
src/renderer/features/wishlist/components/offline-wishlist-modal.tsx
  -> openOfflineWishlistModal()
```

Flow inside the modal:

```text
1. [ Create offline wishlist ]  button
   -> window.open(WISHLIST_SHEET_TEMPLATE_COPY_URL)  (Google "Make a copy" page,
      new tab) -> Google creates a user-owned copy in their Drive.
2. Instructions: share the copy with the service-account email
   (WISHLIST_SHEET_SERVICE_ACCOUNT_EMAIL, shown with a copy-to-clipboard button)
   as Editor.
3. Paste-the-URL TextInput  ->  user MUST paste their copy's URL and Save;
   nothing syncs until they do.
4. Save -> parse sheet id with /\/d\/([a-zA-Z0-9-_]+)/ -> useSetWishlistSheet
   -> PymixController.wishlistSetSheet -> PATCH /wishlist/sheet { sheet_id }.
   Invalid URL -> toast error; success -> toast + closeAllModals().
```

Supporting files (all already present):

```text
src/renderer/features/wishlist/constants.ts
    WISHLIST_SHEET_TEMPLATE_COPY_URL          (template's /copy URL)
    WISHLIST_SHEET_SERVICE_ACCOUNT_EMAIL      (email the user shares with)
src/renderer/features/wishlist/hooks/use-set-wishlist-sheet.ts
src/renderer/api/pymix/pymix-controller.ts    wishlistSetSheet()
src/renderer/api/pymix/pymix-api.ts           wishlistSetSheet()
i18n keys: page.wishlist.offlineWishlist.*, action.createOfflineWishlist,
           action.saveWishlistSheet
```

### Graceful degradation (don't over-promise in the UI)

If the user shares Viewer-only, or skips sharing, pymix can't write the `Status`
column back — by design it just doesn't, and never breaks. **But** the client should
not imply that imported rows will be marked in the sheet unless Editor access is
granted. Keep the "share as Editor" step prominent; treat the sheet's `Status`/`Added`
columns as best-effort confirmation, not a guarantee.

### Future: one-click via OAuth (`drive.file`) — not V1

The copy → share-with-a-robot-email → paste-URL dance is the main wart. A future V2
can collapse it to a single "Connect Google" consent: Subbox copies the template into
the user's Drive via the Drive API and keeps write access because it created the file
— no manual share, no URL paste. That is a backend-led change (OAuth client + per-user
token storage, see `../pymix/wishlist.md`); on the client it mainly replaces this
modal's manual steps with an OAuth redirect. Defer until adoption justifies it.

---

## Future Features (Not V1)

* Add to Wishlist from search page
* Add to Wishlist from missing-track results
* Open linked Navidrome track
* Wishlist dashboard statistics
* Recently fulfilled wishlist items
* Release monitoring
* Bandcamp links

---

## Acceptance Criteria

* Wishlist appears in sidebar
* User can create wishlist item
* User can edit wishlist item
* User can delete wishlist item
* User can update status
* User can preview YouTube video
* Wishlist uses React Query
* Existing library features unchanged
