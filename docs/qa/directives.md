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

### From phone (Discord) — 2026-07-09
Added: 2026-07-09
Request: Use wishlist import skill to import new music and test the user flow of importing new music and then sorting it in to playlists and downloading and missing tracks to the subbox local music directory
Notes: submitted via Discord by lakerluke_55259; break into sub-steps as needed.

### yt-dlp cookie auth (split out from the SUBBOX_ID sync directive)
Added: 2026-07-09
Request: Validate the yt-dlp cookie-auth path bundled into pymix #21 (the
`ytdlp_support.py` change). Unrelated to sync matching; split out of the sync
directive so it can be validated on its own.
Notes: In local dev there's no cookies file mounted — confirmed it degrades
gracefully (startup warning logged, no crash), but the actual authenticated
download path needs prod-like conditions (a real cookies file) to exercise.
Likely needs the user to supply/point at a cookies file, or to be validated in
a prod-like environment rather than the local dev stack. Low priority relative
to the phone directive.



## IN PROGRESS

<!-- Move here once a cycle starts on it. Keep notes updated each cycle with
     what step it's on, so a fresh-context cycle can resume correctly. -->

_(none — the SUBBOX_ID sync directive below is DONE; yt-dlp was split into its
own PENDING entry above.)_

## DONE

<!-- Move here once fully verified end-to-end. Link to the features/*.md
     doc(s) and any bugs.md/ux-notes.md entries produced along the way. -->

### Validate SUBBOX_ID-based sync matching (subbox-app #14 + pymix #21)

**DONE 2026-07-09.** Full verified writeup: `features/sync.md`. Produced
[laker-93/pymix#22](https://github.com/laker-93/pymix/pull/22) (merged — logging
fix) and one OPEN follow-up in `../pymix-qa/docs/qa/bugs.md`
(`subbox_id_divergence` over-fires on plain not-yet-downloaded tracks — left
OPEN, needs a design call, not a conservative fix). The remaining yt-dlp
cookie-auth sub-step was unrelated to sync and is split into its own PENDING
directive above.

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
      — found a real issue (`subbox_id_match_summary` ERROR'd on almost every
      normal sync). **Fixed, live-retested twice, PR opened and merged**
      ([laker-93/pymix#22](https://github.com/laker-93/pymix/pull/22)). New
      precise signal (`subbox_id_divergence`) confirmed correctly scoped
      (`count=1`, correlating with the actual missing track, not
      library-wide noise). `pymix-qa`'s branch rebased cleanly onto the
      merged `main` — `sync.py` now byte-identical, zero conflict.
- [x] Also found (logged in `ux-notes.md`): the first "Preview Download"
      click after a fresh launch always gets one `400 Bad Request` from
      `sync/plan`, silently retried and succeeded. **Root-caused — not a
      bug.** `pymix-api.ts`'s `isPymixAuthError`/`reauthenticatePymix`
      explicitly treats this exact 400 as an expired pymix session and
      silently re-logs in by design. Moved to RESOLVED in `ux-notes.md`.

- [x] pymix#15 merged too (`getAppPath()` now isolates dev's local music
      folder under `subbox-dev/music`, not shared with staging/prod's
      `subbox/music`). Rebased both worktrees again — clean. **Live-verified
      end to end**: pre-fix, dev scans saw the real `subbox/music`'s 808
      files; post-fix (rebuilt), dev sees 0 (isolated `subbox-dev/music`,
      confirmed empty), and "Choose XML Folder" default path updated to
      match. This also made it *safe* to actually drive sub-step 4 for real
      (previously any real download risked writing into the shared/real
      folder).
- [x] Drove an actual `sync/playlists` download ("Download & Extract") for
      real, now that it's isolated — 9 requested, 8 tracks physically
      downloaded (163 MB) into `subbox-dev/music`, shared `subbox/music`
      confirmed untouched (still exactly 808 files). subboxId cache
      correctly primed for all 8 new files immediately after extraction. A
      second "Preview Download" afterward correctly recognized all 8 as
      already-present via the subbox_id fast path (sub-step 4 fully done).
      (Correction: an intermediate cache-count reading of "767" taken right
      after the download doesn't match the clean, fully-consistent 7/8-entry
      state confirmed by direct inspection afterward — likely a stale read
      on my part mid-investigation, not a real inconsistency. Trust the
      sub-step 5/6 findings below, which were re-verified by listing every
      cache entry directly.)
- [x] Cache invalidation (sub-step 5): touched one downloaded file's mtime,
      re-ran preview — result unchanged (still correct), and the cache
      entry's `mtimeMs` was confirmed refreshed to the new value (direct
      before/after inspection of the cache JSON), proving a real re-read
      happened rather than trusting a stale entry.
- [x] Cache pruning (sub-step 6): moved one downloaded file out of
      `subbox-dev/music`, re-ran preview — correctly dropped to 7
      already-present/2-to-download, and direct inspection of the full
      cache confirmed exactly 7 entries remained, all matching real files,
      zero stale/orphaned entries (the moved file's entry was gone).
- [x] **Bonus real-world validation of the pymix#22 fix**: the second
      preview's `subbox_id_divergence: count=1` correctly flagged a genuine
      case — the "Kodzo" playlist has *two* distinct server-side tracks with
      identical title/artist/album ("Damager (Hamdi Edit)"), each its own
      subbox_id; only one was ever downloaded, so the second is a real
      potential duplicate-download risk, not noise. True positive, not a bug
      to fix (duplicate playlist entries are a data/dedup question, out of
      this directive's scope — noted in `bugs.md` as informational, not
      urgent).

**Remaining sub-steps — resolved 2026-07-09:**

- [x] Repeat with local tracks that have **no** SUBBOX_ID tag in isolation
      (sub-step 3) — **verified 2026-07-09**. Copied the real Oleo file back
      into `subbox-dev/music` with its SUBBOX_ID stripped (`mutagen`); after
      placing it at the correct `artist/album/track` depth the scan sent it
      as untagged (`7/8 carry a subboxId`), pymix fuzzy-matched it at
      similarity 1.000 (`via=fuzzy`), and the plan moved Oleo from missing →
      already-present. Also corroborated the OPEN pymix `subbox_id_divergence`
      over-fire (count 2→1 once Oleo was present). Full writeup in
      `features/sync.md` → "Fuzzy fallback for untagged local tracks". Test
      file cleaned up; folder back to 7.
- [~] yt-dlp cookie auth (sub-step 8) — **split into its own PENDING
      directive** (unrelated to sync matching; needs prod-like conditions to
      exercise the actual auth path).
