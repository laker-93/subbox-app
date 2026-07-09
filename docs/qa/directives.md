# User directives

This is how you steer the loop. Every cycle checks this file **first**,
before falling back to its own rotation/coverage logic — a PENDING entry here
always wins over the loop picking its own next thing to explore.

You can add an entry two ways:
1. Just tell the running loop session directly (it's an interactive Claude
   Code session pacing itself between cycles — typing to it works like
   talking to any other session, and it'll act on it at the next
   opportunity rather than waiting for a scheduled check-in).
2. Edit this file directly (e.g. from another session, or by hand) — the
   next cycle will pick up anything sitting in PENDING.

A directive can be a big multi-step journey (e.g. "add 500 tracks, verify
they uploaded correctly, partition into playlists, confirm efficient
download"). The loop should break a large directive into sub-steps and work
through them across multiple cycles, updating the entry's notes with
progress rather than treating it as one atomic cycle. Move it to DONE only
once the whole thing has actually been driven and verified end-to-end, not
when it looks plausible from reading code.

## PENDING

<!-- One entry per directive, oldest first (process in order unless the user
     says otherwise). Format:
     ### <short title>
     Added: YYYY-MM-DD
     Request: <verbatim or lightly cleaned-up ask>
     Notes: <breakdown into sub-steps, if any>
-->

### Validate SUBBOX_ID-based sync matching (subbox-app #14 + pymix #21)

Added: 2026-07-09

Request: two PRs just merged together — validate the change end to end
before it's trusted. subbox-app `development` @ ec1bcf4c ("Send local
SUBBOX_ID to pymix for exact sync matching, with a scan cache", #14), pymix
`main` @ 99a7ffe ("Fast subbox_id matching for sync/plan & sync/playlists;
yt-dlp cookie auth", #21). Both are already pulled into
`claude/continuous-ux` in this worktree and in `../pymix-qa`.

What changed (from the commit messages/diffs — treat as a starting map, not
ground truth; confirm by reading the actual diff and driving the app):

- Client: `scanLocalTracks()` now reads each local file's `SUBBOX_ID` tag
  (via TagLib) and sends it to pymix as `subboxId` on every local track for
  sync. Reading the tag is real per-file I/O, so results are cached on disk
  (electron-store, keyed by path + mtime + size) so unchanged files aren't
  reopened on every preview/download. Newly-downloaded files get their
  subbox_id primed into the cache right after extraction (pymix already
  tagged them before zipping). Cache also prunes entries for files no longer
  present in a scan, so it doesn't grow unbounded. Touches
  `src/main/features/core/sync/index.ts`,
  `src/renderer/features/sync/components/sync-download.tsx`,
  `src/shared/api/pymix/pymix-types.ts`.
- pymix: `POST /sync/plan` (preview) and `POST /sync/playlists` (download)
  now match a local track against a server track by `subbox_id` in O(1) when
  the client sent one, instead of always doing difflib fuzzy title/artist
  matching. Tracks with no `subboxId` still fall back to fuzzy matching.
  Per-track subbox_id/is_file() reads in `_parse_tracks` moved off the event
  loop onto worker threads (`anyio.to_thread.run_sync`), parsed
  concurrently per playlist. A fully-matched-by-subbox_id sync logs at info;
  a sync that had to fall back to fuzzy matching for some tracks now logs at
  error (intentional — surfacing unexpected fuzzy fallbacks on tagged
  libraries). Also bundles yt-dlp cookie auth changes
  (`pymix/services/ytdlp_support.py`,
  `pymix/services/link_parse_service.py`,
  `pymix/services/youtube_match_service.py`) — check whether this is
  actually related to sync or a separate concern bundled in the same PR;
  validate it separately if so.

Notes / suggested sub-steps (break across cycles, update this section with
progress — don't try to do all of this in one cycle):

1. Read the full diffs in both repos (`git show ec1bcf4c` in `feishin-qa`,
   `git show 99a7ffe` in `pymix-qa`) to get the real detail, not just this
   summary.
2. Drive a sync preview (`sync/plan`) end to end in the Electron app against
   a library that has SUBBOX_ID-tagged local tracks matching server tracks —
   confirm the diff comes back correct and confirm (via pymix logs, or
   temporary instrumentation if needed) that it actually took the subbox_id
   fast path, not silently falling back to fuzzy matching for everything.
3. Repeat with local tracks that do **not** have a SUBBOX_ID tag (e.g. a file
   from outside subbox) — confirm fuzzy fallback still works and the sync
   plan is still correct.
4. Drive an actual `sync/playlists` download and confirm: downloaded files
   get correctly matched/deduped against what's already local, and newly
   downloaded files' subbox_ids get primed into the client cache (verify by
   triggering a second sync/plan immediately after and confirming it doesn't
   re-read those files' tags — e.g. via timing, or logging/instrumenting the
   cache hit path temporarily).
5. Test the cache invalidation path: modify a previously-scanned file (touch
   its mtime, or edit a tag) and confirm the next scan re-reads it instead of
   trusting a stale cache entry.
6. Test cache pruning: remove/move a previously-cached local file, rescan,
   confirm its entry is dropped rather than accumulating forever.
7. Sanity-check the "fuzzy fallback = error log" behavior isn't going to
   spam errors for a normal/expected case (e.g. brand-new files not yet
   tagged) — flag as UX/logging friction in `ux-notes.md` if so, don't just
   silently accept it.
8. Only then, separately, sanity-check the yt-dlp cookie auth change if it's
   unrelated to sync (may need its own follow-up directive rather than being
   folded into this one — split it out into a new PENDING entry if it turns
   out to be a distinct, unrelated concern).
9. Write up verified behavior in `features/sync.md` (new file) once steps
   2-6 are actually confirmed, and log any bugs/friction found along the way
   in `bugs.md` / `ux-notes.md` (cross-referencing `../pymix-qa` where the
   root cause is on the backend).

## IN PROGRESS

<!-- Move here once a cycle starts on it. Keep notes updated each cycle with
     what step it's on, so a fresh-context cycle can resume correctly. -->

_(none yet)_

## DONE

<!-- Move here once fully verified end-to-end. Link to the features/*.md
     doc(s) and any bugs.md/ux-notes.md entries produced along the way. -->

_(none yet)_
