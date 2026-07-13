# UX friction log (subbox-app)

Things that aren't wrong, just rough for a real user — confusing empty
states, silent failures, inconsistent patterns vs. the rest of the app,
missing feedback on slow operations, etc. See `README.md` for the bar on
when friction is worth actually fixing vs. just logging.

## OPEN

<!-- One entry per observation: date, journey/route, what a real user would
     find confusing/awkward and why, evidence (screenshot path), and whether
     you think it's a safe small fix or needs a design call. -->

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

## RESOLVED (not a bug — keep this so it isn't re-investigated)

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

No fix needed. Left here (not deleted) so a future cycle doesn't
re-investigate the same "why does the console show a 400" observation from
scratch.

## IMPROVED

<!-- One entry per applied improvement: date, one-line description, commit
     SHA on this branch, how it was re-verified. -->

_(none yet)_
