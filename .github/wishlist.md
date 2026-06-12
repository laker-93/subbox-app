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
