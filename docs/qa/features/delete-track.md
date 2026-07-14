# Delete a track (subbox-only)

The song context-menu delete: subbox-app resolves each selected song's
`subbox_id` from its Navidrome tags and calls `DELETE {pymix}/track`, which
removes pymix's DB rows, the beets row, and **the audio file on disk**.

Verified 2026-07-14 by driving it live against the local dev stack, test user
`test260526`, with purpose-made scratch tracks. Driver:
`scripts/qa/delete-track-journey.mjs`.

> **This is destructive.** `beet rm -df` deletes the real file. Only ever point
> the driver at a scratch track you imported yourself on the dev test user.

## The UI path

- Context menus: `song-context-menu.tsx` and `playlist-song-context-menu.tsx`
  both render `DeleteSongAction` — so it's available anywhere a song row is
  right-clickable (library lists, album detail, search results, playlist songs).
- **The menu item is labelled "Delete track"**, even though the i18n key is
  `action.deleteSong` and the code calls it `DeleteSongAction` / `deleteSong`
  throughout. Don't look for a "Delete song" item — it doesn't exist.
- Selecting it opens a `ConfirmModal` ("Are you sure?", title "Delete song"),
  confirm → the mutation fires.

## How the subbox_id is found (and why it works)

`delete-song-action.tsx` reads `song.tags?.subboxid?.[0] || song.tags?.subbox_id?.[0]`.
That only works because the **Navidrome** controller populates `tags`
(`navidrome-normalize.ts:303` → `tags: item.tags || null`) from Navidrome's
native `/api/song`, which returns the custom tag:

```
"tags": {"disctotal": ["0"], "subboxid": ["a1e02e00-..."], "tracktotal": ["0"]}
```

Note `subsonic-normalize.ts` sets `tags: null` — so this flow depends on the
Navidrome controller, which is what subbox always uses (root `CLAUDE.md`). Songs
with no `subboxid` tag (e.g. the one known corrupt file) are filtered out; if
none of the selection has one, the user gets an "No subboxid found for the
selected tracks" error toast and no request is made.

## Verified: the happy path

Driven end to end on a scratch track (`QA Happy Probe — Happy Path 20260714`,
`subbox_id=edfff8dd-…`), imported via the watch dir so it was genuinely new:

- Request: `DELETE https://pymix.docker.localhost/track`, body `{"ids":["edfff8dd-…"]}`
  (no `username` — pymix resolves it from the `session_id` cookie).
- Response: **200** `{"username":"test260526","success":true,"results":[{"subbox_id":"edfff8dd-…","reason":"","success":true}]}`
- User sees the success toast; exactly **1** request (no retries).
- Server-side, all of it actually went away:
  - file **and its now-empty artist/album dirs** deleted from `/private-music/test260526/…`
  - beets row gone (`beet list subbox_id::<id>` → empty)
  - pymix `subbox_beets_map_table` / `original_track_meta_map_table` rows gone
  - Navidrome dropped the song (and, since it was the album's only track, the
    album too) within ~10 s of its next scan.

**Deletion is precisely scoped.** Despite `beet rm -df subbox_id::<id>` using a
regex query, deleting one track of a two-track scratch album (`qa-pair-scratch`)
removed exactly that track — the sibling's file, beets row, pymix row and
Navidrome entry were all untouched.

## Verified: the failure path (was a silent failure — now fixed)

pymix reports a failed delete **in the body, with HTTP 200**:
`{"success": false, "results":[{"success": false, "reason": "..."}]}`. Reproduced
by creating a realistic beets/Navidrome desync (drop the beets row only, leaving
the file and Navidrome entry: `beet rm -f "subbox_id::<id>"`), then deleting via
the UI.

Before the fix the client discarded that body (`deleteSong = z.null()`) and only
checked the HTTP status, so the user got a **success toast for a delete that
never happened** — see `bugs.md` (issue #18, fixed this cycle). After the fix the
same flow shows an **"Error / Failed to delete the track"** toast, and the track
correctly stays listed.

Two things to know about the failure path:

- **A failed delete fires 4 requests, not 1.** Once the mutation actually
  rejects, the app's standing `mutations.retry: 3` policy
  (`renderer/lib/react-query.ts:24`) retries it. That's pre-existing app-wide
  config, not delete-specific, and it's harmless here (re-deleting an already
  gone id just fails the same way). Expect it when reading logs.
- **pymix still mutates state on a failed delete** — it commits its DB-row
  deletion *before* the file delete, so a failure orphans the file. That's a
  pymix-side design call, logged as pymix issue #30 (`../pymix-qa/docs/qa/bugs.md`).

## Known friction: the deleted row doesn't leave the list

A successful delete leaves the track visible in the list the user is looking at
until they navigate away and back. Measured: the row was still there **50 s**
after the delete, on a route whose query key the mutation *does* invalidate.
It's a race — the client invalidates immediately, Navidrome only reflects the
delete after its async rescan (~5–10 s), so the refetch returns the still-present
track and nothing refetches again. Details + evidence in `ux-notes.md`
(needs a design call; not fixed).

## Driver

`scripts/qa/delete-track-journey.mjs` — searches for a scratch track by title,
right-clicks the row, asserts the "Delete track" item, confirms the modal, then
records the `DELETE /track` request/response, the toast the user actually sees
(success vs error vs none), and how long the row takes to leave the list.

```
QA_DELETE_TITLE="Happy Path 20260714" \
QA_DELETE_ROUTE="/library/albums/<albumId>" \
node scripts/qa/delete-track-journey.mjs
```

`QA_DELETE_ROUTE` defaults to `/search/song?query=<title>`. Note the **search**
route's query key (`[serverId,'search',…]`) is not among the keys the mutation
invalidates (`songs`, `albums`, infinite-loader), so use an album-detail route
when testing list-refresh behavior.

**Making a scratch track** (the recipe used here — a real audio file with a
unique, obviously-scratch identity and **no** `SUBBOX_ID`, so pymix mints a fresh
one exactly as for new music):

```
docker cp "pymix:/private-music/test260526/<some>/<real>.mp3" ./src.mp3
ffmpeg -y -i src.mp3 -map_metadata -1 -c:a copy -t 20 \
  -metadata artist="QA Delete Probe" -metadata title="Delete Me <date>" \
  -metadata album="qa-delete-scratch" probe.mp3
docker cp probe.mp3 filebrowser:/data/users/test260526/watch/
```

Then wait for `watch import: finished` in `docker logs pymix` (15 s debounce) and
for Navidrome to scan it in (~10 s). Full pipeline:
`../pymix-qa/docs/qa/features/watch-dir-import.md`.
