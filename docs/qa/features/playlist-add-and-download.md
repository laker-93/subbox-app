# Journey: add a track to a playlist → download the playlist to the local music dir

Verified end to end 2026-07-10 (client Electron build + shared local pymix on
`laker93/pymix:qa-local`), driving the tail of the phone/Discord wishlist-import
directive (sub-steps 4 & 5). This is the "sort into a playlist, then download
missing tracks to my local folder" half of a real user's flow, exercised against
test account `test260526`.

## Setup / fixtures

- Scratch track imported earlier via the watch-dir import (see
  `../../../../pymix-qa/docs/qa/features/watch-dir-import.md`):
  - Subsonic song id `tOJShpEmjhKArc2yCEafOz`, album `qa-scratch`
    (`6cqmCIDIfFhcZMpwnoKYVp`), artist `QA UX Loop`, title
    `Import Probe 2026-07-09`.
  - `subbox_id = 1e5002e2-9050-4067-8192-b317278d1cf0`, beet id 665.
  - Server path `/music/test260526/QA UX Loop/qa-scratch/00 - QA UX Loop -
    Import Probe 2026-07-09.mp3`, 3806839 bytes, ~230 s real audio.
- Client's isolated local music dir (dev app name, per pymix#15):
  `~/Library/Application Support/subbox-dev/music`. Shared prod/staging folder
  `~/Library/Application Support/subbox/music` must stay untouched.

## Add to playlist (sub-step 4)

Driver: `scripts/qa/add-to-playlist-smoke.mjs` (album detail → right-click track
→ "Add to playlist" context modal → type a new name → "create playlist" →
"Add"). A new playlist **"QA Import Playlist 0709"** (`TLmCrimKHRNhAfS6FJYUnB`)
was created holding exactly the scratch track.

Verified:
- **Server-side** — Subsonic `getPlaylist.view?id=…` returns the playlist with a
  single `entry`, the scratch song. Persists across sessions (created
  2026-07-09T20:57Z, still present next day).
- **Client-side** — the Sync → Download plan for this playlist reads it as its
  one member (see below), so the add is visible to the client, not just the DB.

## Download to local music dir (sub-step 5)

Driver: `scripts/qa/sync-smoke.mjs` with
`QA_PLAYLIST="QA Import Playlist 0709"` (add `QA_DOWNLOAD=1` to actually pull).
Flow: Sync mode → Download tab → select playlist → **Preview Download** →
**Download & Extract**.

Verified behavior:

| Stage | Observed |
|---|---|
| Preview (before) | `1 TRACKS REQUESTED / 0 ALREADY PRESENT / 1 TO DOWNLOAD / 3.6 MB`; track under **Missing (1)**. Correct — its audio wasn't in `subbox-dev/music` yet. |
| Download & Extract | "Download Complete — 1 track exported." |
| Local folder | `subbox-dev/music` went 7 → 8 audio files; new file at `QA UX Loop/qa-scratch/00 - QA UX Loop - Import Probe 2026-07-09.mp3`. |
| Integrity | Downloaded file is **byte-exact** to the server copy (3806839 B) and preserves `SUBBOX_ID = 1e5002e2-9050-4067-8192-b317278d1cf0`. |
| Isolation | Shared `subbox/music` unchanged at exactly **808 files** — dev/prod folder isolation (pymix#15) holds; no leak into the real library. |
| Preview (after) | Re-run flipped the track missing → **already-present** (`0 TO DOWNLOAD`, `Missing (0)`), confirming the subboxId fast path recognizes the just-downloaded file. |

## Notes / gotchas

- The first pymix call after a fresh Electron launch logs one `400` that's
  silently re-authed and retried — working as designed (see `ux-notes.md`
  RESOLVED), not a failure of this flow.
- A `502` on a resource load appears in the console during the sync screens; it
  did **not** block plan generation or the download (both succeeded). Cosmetic /
  unclear source — worth a glance if a future cycle sees the download itself
  fail, but not reproduced as a functional problem here.
- Preview also reports "1 METADATA UPDATES" for a freshly-imported track; the
  download still completed as one track exported. Not investigated further — the
  file landed correct and byte-exact.

## Deleting a track (supported in-app — do NOT hand-roll `beet remove`)

Deleting a track **is a first-class app action** — you do not need to reach into
beets/the server to remove one. The client exposes it through the song
context menu and it drives pymix's delete endpoint, which handles the
server-side removal correctly.

Flow (verify against `src/renderer/features/context-menu/actions/delete-song-action.tsx`
if it drifts):

1. Right-click a song (anywhere a song row appears — album detail, playlist
   detail, `/library/songs`, etc.; the item comes from `song-context-menu.tsx`).
2. Choose **"Delete song"** (the `remove` icon) — multi-select is supported, the
   action deletes every selected row.
3. Confirm the **"Are you sure?"** modal.

What happens under the hood:

- Each selected song's **`subboxid`** (`song.tags.subboxid[0]` /
  `song.tags.subbox_id[0]`) is collected — deletion is keyed by `subbox_id`, not
  the Subsonic song id. A track with **no `subboxid` tag cannot be deleted this
  way**: the action aborts with a "No subboxid found" toast (so an un-tagged
  import is the one case where you'd still fall back to a server-side removal).
- The client calls **`DELETE {pymix}/track`** with body `{ ids: [<subbox_id>, …] }`
  (`PymixController.deleteSong` → pymix `deleteSong` route). A non-200 surfaces as
  an error toast; 200 shows the `form.deleteSong.success` toast.
- On success the songs/albums query caches are invalidated so the row disappears
  from the UI. (Playlist membership follows from the track being gone.)

> Not yet driven end-to-end in a cycle — see the checklist row in `README.md`.
> When first verifying, confirm the file is gone from the server + Navidrome and
> that the local `subbox-dev/music` copy (if downloaded) is handled as expected.

## Cleanup (when the phone directive fixtures are no longer needed)

Scratch track + playlist are shared fixtures for the (now DONE) phone journey.
Preferred removal is the **in-app "Delete song" flow above** (it drives
`DELETE /track` by `subbox_id` and lets Navidrome purge) plus deleting the
"QA Import Playlist 0709" playlist from the UI. Only fall back to a server-side
`beet remove` in `beetstest260526` if the track is missing its `subboxid` tag
(app delete can't key it). Also delete the local copy under
`subbox-dev/music/QA UX Loop/` if it was downloaded. Left in place for now in
case a follow-up cycle wants the fixture.
