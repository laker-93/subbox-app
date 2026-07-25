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

### Landing page advertises Serato sync, but the client has no Serato UI at all

Added: 2026-07-23. Route: pre-login landing page (`features/home/components/landing-page.tsx:37-40`).
Found while closing out the `[subbox]` "Rekordbox/Serato import-export UI" coverage
row (`features/rekordbox-import.md`).

**What a user sees.** Before logging in, the feature list reads "Sync and convert
libraries between **Serato**, Rekordbox, and more." Once inside the app, the Sync
screen has exactly four tabs — Upload (Rekordbox), Download, Watch, External Drive
(`sync-mode-placeholder.tsx:14`) — no Serato tab, toggle, or menu item anywhere. A
user drawn in by the Serato promise has no path to act on it client-side.

**Not purely a client gap** — pymix's backend genuinely supports Serato
(`POST /serato/export` produces real, valid `.crate` files; verified live in
`../pymix-qa/docs/qa/features/serato-export.md`) and the client even has the
plumbing (`PymixController.seratoDownload`/`seratoImport`), just no UI wired to
either. So the claim isn't entirely false — it's a real, working backend feature
with zero way to reach it from the app today.

**Why not fixed.** Ambiguous, not a clean copy bug like the External Drive case
(issue #27/PR #29, which corrected a claim about *where files land* that was
simply wrong): here the honest fix depends on intent — is Serato UI actually on
the roadmap (leave the copy, it's accurate-but-early) or abandoned (reword to drop
Serato until/unless a UI ships)? That's a product decision, not something to
infer from code. Logged, not fixed; no `qa-bug` issue (copy/scope judgment call,
not a correctness bug).

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
- 2026-07-25 | Wishlist header "+" button had no accessible name | IMPROVED — added `aria-label` using existing `action.addToWishlist` string; re-verified live (role query now resolves)
