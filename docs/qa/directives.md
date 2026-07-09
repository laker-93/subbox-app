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

_(none — see IN PROGRESS)_

## IN PROGRESS

<!-- Move here once a cycle starts on it. Keep notes updated each cycle with
     what step it's on, so a fresh-context cycle can resume correctly. -->

### Validate SUBBOX_ID-based sync matching (subbox-app #14 + pymix #21)

Added: 2026-07-09. Started: 2026-07-09.

Request: two PRs just merged together — validate the change end to end
before it's trusted. subbox-app `development` @ ec1bcf4c ("Send local
SUBBOX_ID to pymix for exact sync matching, with a scan cache", #14), pymix
`main` @ 99a7ffe ("Fast subbox_id matching for sync/plan & sync/playlists;
yt-dlp cookie auth", #21). Both pulled into `claude/continuous-ux` in this
worktree and in `../pymix-qa`.

**Progress so far** — see `features/sync.md` for the full verified writeup:

- [x] Read both full diffs (not just commit messages).
- [x] Built Electron from this worktree (had to use
      `electron-vite build --mode development`, not plain
      `pnpm run build:electron` — that defaults to Vite's production mode
      and bakes in the real prod pymix URL, a trap worth remembering).
- [x] Rebuilt pymix from `../pymix-qa` (`laker93/pymix:qa-local`, `--load`)
      and pointed `../traefik/docker-compose.yml` at it — **the shared local
      `pymix` container is now running this branch's code**, not the
      previous `v1.1.331-dev` tag. Confirmed idle (only periodic
      wishlist-reconcile/sheet-sync background jobs) before restarting it.
- [x] Drove "Preview Download" (`sync/plan`) end to end against real test
      data (account `test260526`, 774 real local tracks, 1 playlist) —
      confirmed the subbox_id fast path activates (759/774 tracks tagged,
      matched via subbox_id) and the result is identical to pre-PR fuzzy-only
      behavior.
- [x] Sanity-checked the "fuzzy fallback = error log" behavior (sub-step 7)
      — **found a real issue**, logged as OPEN in
      `../pymix-qa/docs/qa/bugs.md` (`subbox_id_match_summary` logs ERROR on
      almost every normal sync, not just genuine divergence). Not fixed —
      needs a design call on correct semantics, per the conservative policy.
- [x] Also found (logged in `ux-notes.md`): the first "Preview Download"
      click after a fresh launch always gets one `400 Bad Request` from
      `sync/plan`, silently retried and succeeded — reproduced identically
      pre- and post-pymix-rebuild, so unrelated to this PR pair. Not yet
      root-caused.

**Not yet done** (pick up here next cycle):

- [ ] Repeat with local tracks that have **no** SUBBOX_ID tag in isolation
      (sub-step 3) — this cycle's test account happened to have 15 untagged
      locals mixed in already and fuzzy fallback worked for whatever needed
      it, but hasn't been isolated/verified deliberately.
- [ ] Drive an actual `sync/playlists` download ("Download & Extract") and
      verify newly-downloaded files' subbox_ids get primed into the client
      cache (sub-step 4).
- [ ] Cache invalidation test — touch/edit a previously-scanned file, confirm
      re-read (sub-step 5).
- [ ] Cache pruning test — remove/move a cached file, confirm entry dropped
      (sub-step 6).
- [ ] yt-dlp cookie auth (sub-step 8) — confirmed it degrades gracefully with
      no cookies file locally (expected in dev), but the actual auth path
      needs prod-like conditions; consider splitting into its own directive
      since it's unrelated to sync.
- [ ] Root-cause the first-click 400 (see `ux-notes.md`).

## DONE

<!-- Move here once fully verified end-to-end. Link to the features/*.md
     doc(s) and any bugs.md/ux-notes.md entries produced along the way. -->

_(none yet)_
