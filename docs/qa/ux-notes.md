# UX friction log (subbox-app)

Things that aren't wrong, just rough for a real user — confusing empty
states, silent failures, inconsistent patterns vs. the rest of the app,
missing feedback on slow operations, etc. See `README.md` for the bar on
when friction is worth actually fixing vs. just logging.

**Archiving (do this when you close a note):** this file is re-read on every turn
of every cycle, so keep it to `OPEN` entries plus the compact **Closed** index at
the bottom. When a note becomes `RESOLVED` (not-a-bug) or `IMPROVED`, put its
**full text verbatim** in `ux-notes-archive.md` (which the loop never reads) and
add **one line** to the Closed index here. The one-liner is enough to stop a
future cycle re-investigating; the archive has the detail if ever needed.

## OPEN

<!-- One entry per observation: date, journey/route, what a real user would
     find confusing/awkward and why, evidence (screenshot path), and whether
     you think it's a safe small fix or needs a design call. -->

### "Share item" context action is offered everywhere but always fails (Navidrome sharing disabled)

Added: 2026-07-21. Route: any list/detail with a context menu (song, album,
artist, album-artist, playlist, folder, queue). Verified API + code trace,
account `test260526`. See `features/sharing.md`.

**What a user sees.** Right-click almost anything → **"Share item"** → fill in the
modal (expiration / description / allow-downloading) → **Share** → a generic
**"Failed to create share"** error toast. Every item type, every time, no
explanation. The action looks like a first-class feature (it's in all 8 context
menus, unconditionally) but can never succeed in the subbox deployment.

**Root cause (empirically confirmed).** The client POSTs to Navidrome's native
`/api/share` (`navidrome-controller.ts:1124`), but the per-user Navidrome has
**sharing disabled** — the container sets no `ND_ENABLESHARING` and
`navidrome.toml` has no sharing key, so Navidrome (default off) never registers
the `/api/share` routes. Proven live against `navidrometest260526` (0.60.3) with
a valid native JWT: `/api/song` and `/api/playlist` → 200, but `GET`/`POST
/api/share` → **404 page not found**. The controller throws on non-200 → the
modal's `onError` → the error toast.

Also: `ShareAction` (`share-action.tsx`) is rendered with **no feature gate** at
all, so nothing hides it when the server can't share. (Upstream Feishin's
`SHARING_ALBUM_SONG` is version-detected, `0.49.3+`, not enablement-detected —
so even a version gate wouldn't have hidden it here.)

**Why not fixed (needs a design call).** Two clean resolutions, both a
deliberate decision, both outside the conservative single-repo fix bar:
1. **Subbox intends sharing** → enable `ND_ENABLESHARING=true` in the per-user
   Navidrome orchestration (a pymix/traefik deployment change, and enabling a
   whole feature — not a bug fix), or
2. **Subbox does not** → hide/disable the Share action client-side (touches
   shared upstream-Feishin context-menu code app-wide; wants to be done as one
   coherent gate, not a one-off).
Inherited-upstream surface that doesn't fit subbox's deployment reality — same
shape as the "role-only artists → empty detail" note above. Logged, not fixed;
no `qa-bug` issue (friction/design call, per the ux-notes policy).

### The wishlist header's "+" (add item) button has no accessible name

Added: 2026-07-14. Route `/wishlist` (`features/wishlist/components/wishlist-header.tsx`).
Found while writing `scripts/qa/wishlist-journey.mjs`. See `features/wishlist.md`.

**What's rough.** The only way to add a wishlist item is an icon-only `ActionIcon`
(`icon="add"`) that carries a `tooltip` but **no `aria-label`**. Confirmed by DOM probe:
the button exposes `aria-label: null` and no text content, so it has no accessible name at
all. A screen-reader user hears an unlabelled button; a keyboard user gets no hint (the
tooltip is hover/focus-delayed, `openDelay: 300`). The sibling control right next to it
("Offline Wishlist") is a plain labelled `Button`, so the primary action on the page is the
*less* discoverable of the two.

The `WishlistContent` checkboxes right below it *do* set `aria-label`
(`page.wishlist.selectAll` / `selectRow`), so this is inconsistent within the same feature,
not a house style.

**Likely a safe small fix** — add an `aria-label` (an `action.addToWishlist` = "add to
wishlist" string already exists and is used as the modal title, so no new copy is needed).
Not done this cycle: it's an a11y improvement rather than a bug, the icon-only-header
pattern recurs app-wide (the same shape was noted for the genres/albums header Play
control in `features/genres-browse.md`), and a considered fix probably wants to cover the
pattern rather than this one button. Worth a design call on scope.

**Knock-on for QA.** Drivers can't reach this button by role/name; `wishlist-journey.mjs`
has to anchor to the "Offline Wishlist" button and take its next sibling.

### A deleted track stays visible in the list until you navigate away and back

Added: 2026-07-14. Journey: song context menu → "Delete track" → confirm. Driver
`scripts/qa/delete-track-journey.mjs`, account `test260526`.
See `features/delete-track.md`.

**What a user sees.** They delete a track, get the "Song deleted" success toast —
and the track is **still sitting in the list**. Measured: the row was still there
**50 s** after a fully successful delete (polled every 2 s), on
`/library/albums/:id`, a route whose query key the mutation *does* invalidate. It
only disappears once they navigate away and back. Playing it in the meantime
would hit a file that no longer exists.

**Root cause (a race, not a missing invalidation).** `delete-song-mutation.ts`
invalidates `songs` / `albums` / infinite-loader keys in `onSuccess` — i.e.
**immediately**. But the delete only reaches the client's data source
asynchronously: pymix deletes the file synchronously, then **Navidrome** picks it
up on its next scan (~5–10 s later, measured). So the invalidation's refetch
fires while Navidrome still lists the track, returns it, and nothing ever
refetches again. Verified both halves: Navidrome returned 0 rows for the title
~10 s after the delete, and re-navigating (a fresh fetch) showed the row gone.

Also worth noting for whoever picks this up: on the **search** route the list
isn't invalidated at all — `queryKeys.search` (`[serverId,'search',…]`) isn't
among the keys `delete-song-mutation.ts` invalidates. Same symptom, second cause.

**Why not fixed.** Needs a design call rather than a conservative patch: "refetch
later" needs a *how* — poll until the track disappears, retry the invalidation on
a delay, or optimistically remove the row from the cache (fast and correct-looking,
but lies if the delete actually failed — cf. the false-success bug in `bugs.md`).
Picking one is a deliberate decision about how the client models Navidrome's
async scan, which affects other post-mutation flows too. Logged, not fixed.

### Artists list shows role-only artists whose detail page is empty (0 albums / 0 tracks)

Added: 2026-07-10. **Restored + re-confirmed live 2026-07-13** (the original
entry was lost in a rebase; `features/artists-browse.md` cross-references it, so
it's restored here to repair the dangling reference). Route `/library/artists` →
`/library/album-artists/:id`. Driver `scripts/qa/artists-journey.mjs` +
direct Navidrome native/Subsonic API calls. Account `test260526`.

**What a user sees.** The "Artists" nav list is served by Navidrome's **native**
`/api/artist`, which counts **every** credited role (album-artist, artist,
**composer**, …). So it includes artists credited *only* via a non-album-artist
role. Clicking such an artist card routes to the **album-artist** detail page
(`getArtist` in Subsonic terms), which is album-artist-centric and therefore
shows **"0 albums • 0 tracks"** — an empty page with a Play button that queues
nothing. A real user can't tell this apart from a broken/blank detail page.

**Live evidence (re-confirmed 2026-07-13).** Composer **"Marco Masis"**:
- native `/api/artist` row → `albumCount: 1, songCount: 1` (shows in the grid
  with a count, looks like a normal artist),
- Subsonic `getArtist` (id `08pZgYqxcev4joduux7dpf`, the detail-page source) →
  `albumCount: 0, albums: 0` (empty detail).

The two lists diverge by exactly the role-only artists: album-artist index
(`getArtists`) = 228, native artist list (`/api/artist`) ≥ 400 at last check
(library has grown since the July numbers via upload testing; the qualitative
split is unchanged).

**Why not fixed.** Needs a design call, not a conservative patch: the "correct"
behavior is ambiguous (hide role-only artists from the list? show a role-scoped
detail? surface an empty-state message?) and any change touches how the two
Navidrome artist lists map to the shared album-artist detail — cross-cutting and
inherited from the upstream Feishin routing (`getItemNavigationPath` maps
`ARTIST` → `LIBRARY_ALBUM_ARTISTS_DETAIL`). Logged, not fixed.

### Full-page Search shows no "no results" empty state on a zero-match query

Added: 2026-07-13. Route `/search/song` (also albums/artists tabs). Driver
`scripts/qa/search-journey.mjs`, account `test260526`.

**What a user sees.** Searching a term with no matches (drove
`?query=zzqqxnomatchzz`) leaves the results area as bare column headers and a
blank grid — no "No results found" / "Nothing matched" message. A real user
can't tell "there are genuinely no results" apart from "still loading" or
"something silently failed". Evidence:
`.ui-snapshots/qa-search-no-match-empty-*.png` (Tracks tab, headers only, 0
data rows, no message; `crashed=false` so it's not an error, just empty).

**Why not fixed this cycle.** Subjective and likely inherited from upstream
Feishin's shared `SongListView`/`AlbumListView` empty rendering (the same list
components back the library pages), so any change is cross-cutting and better
made as a deliberate design call on the shared list empty-state rather than a
search-only patch. Needs a design call; logged, not fixed.

### Full-page Search box text goes stale vs. the actual results when the query changes via navigation

Added: 2026-07-13. Route `/search/:itemType`. Driver
`scripts/qa/search-journey.mjs`.

**Symptom.** The header `SearchInput` is uncontrolled
(`defaultValue={searchParams.get('query')}` in `search-header.tsx`), read only
at mount. When the active query changes without the input remounting — e.g.
navigating `/search/song?query=Hamdi` → `/search/song?query=zzqqxnomatchzz`, or
arriving via a "Go to Search" command — the results update to the new query but
the **box keeps showing the previous text**. Evidence:
`.ui-snapshots/qa-search-no-match-empty-*.png` shows the box reading "Hamdi"
while the (correctly empty) results are for `zzqqxnomatchzz`. Initial deep-link
load *does* populate correctly (`qa-search-albums-match-*.png`: box "Hamdi",
Hamdi albums) — the staleness is only on a subsequent query change.

**Why not fixed this cycle.** Low severity — the primary path (user typing)
never triggers it, since typing drives the box directly. A fix means making the
input controlled by `searchParams`, which risks the 200ms debounce UX and
touches an upstream Feishin pattern. Needs a design call; logged, not fixed.

## Closed (full detail in `ux-notes-archive.md`)

<!-- One line per RESOLVED/IMPROVED note: date | title | verdict. Full text lives
     in ux-notes-archive.md, which the loop never reads. -->

- 2026-07-09 | First "Preview Download" click after launch 400s once then silently retries | RESOLVED (working as designed — pymix session-lapse reauth-and-retry; also in features/sync.md)
