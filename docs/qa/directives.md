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

_(none)_

## DONE

### Soulseek acquisition of a wishlist row (split out from the phone/Discord directive)  [DONE 2026-07-10]
Added: 2026-07-10. Started + completed 2026-07-10 (single cycle — Soulseek was
logged in and cooperative, so all three sub-steps landed in one pass).
Request: Exercise the *acquisition* half the phone/Discord journey never
verified — `download_wishlist.py` actually pulling a seeded wishlist row down
via Soulseek into the watch dir, then the wishlist row flipping
`resolved`→`downloaded`/`available`.

**Verified end to end** — full writeup:
`../pymix-qa/docs/qa/features/wishlist-download-acquisition.md`.

1. [DONE] **Preflight + wiring.** /etc/hosts vhost resolves; slskd up **and
   logged into the Soulseek network** (`server` state `Connected, LoggedIn` —
   the flaky bit). Dry-run `--max-downloads 3` (the cap slices `missing[:N]`
   *before* searching, so 3 is the minimum to reach the Aphex row at index 2):
   Text Chunk + Blood of Aza → no Soulseek match; **Aphex Twin – Xtal → 82
   candidate sources**.
2. [DONE] **Real capped run.** Dropped `--dry-run`; script queued + pulled
   `Aphex Twin - Xtal.flac` from peer **Slapper** (real transfer, slskd
   `Completed, Succeeded`), then `PATCH`ed the row `wishlist → downloaded`
   (linked still None). Acquisition half — the piece that had never been driven
   — is now proven.
3. [DONE] **Round trip to `available`.** Bridged the file into the watch dir
   (`docker cp … filebrowser:/data/users/test260526/watch/`, a local-dev-only
   step — host slskd can't write the `user-updownloads` volume). pymix watcher
   debounced → beet-imported to
   `/music/Aphex Twin/Selected Ambient Works 85–92/01 - Aphex Twin - Xtal.flac`
   (beet_id 666) → physically wrote `SUBBOX_ID=09d4a6f0-…` (confirmed with
   metaflac). Navidrome scan 77→78, track searchable. Reconcile then flipped the
   row `downloaded → available` with `linked_subbox_id=09d4a6f0-…` — identical to
   the stamped id.

**No bug found — flow works as designed; no code change.** Gotcha for future
cycles (documented in the feature doc): reconcile can fire in the gap between
import and Navidrome's scan, log a benign `failed to find match on <title>`, and
not promote — that's not a failure, the next reconcile (post-scan) promotes.
Left-behind state: the test library now owns a genuine Aphex Twin – Xtal track
(not qa-scratch; realistic terminal state, left in place); the seeded wishlist
row is `available`/linked (correct end state, nothing to clean up).

**With this done, the entire phone/Discord journey — wishlist import →
acquisition → tag → playlist → download-to-local — is fully verified.**

<!-- Move here once fully verified end-to-end. Link to the features/*.md
     doc(s) and any bugs.md/ux-notes.md entries produced along the way. -->

### From phone (Discord) — wishlist import → playlist → download journey  [DONE 2026-07-10]
Added: 2026-07-09. Started: 2026-07-09 (21:30 cycle).
Request: Use wishlist import skill to import new music and test the user flow
of importing new music and then sorting it in to playlists and downloading and
missing tracks to the subbox local music directory
Origin: submitted via Discord by lakerluke_55259.

**Sub-step breakdown** (each cycle = one sub-step; keep this updated):

1. [DONE 21:30] **Seed + resolve.** Seeded `Aphex Twin - Xtal`
   (album `qa-scratch`, `wishlist_id=91ce2e1072bd4122b1c2b887e902a01b`) via
   `POST /wishlist`. Landed `pending`, resolve loop flipped it to `resolved`
   within one poll; `linked_subbox_id=None` (correctly not-yet-owned). slskd
   confirmed up (200 on :5030). **Leave this row in place** — sub-steps 2-5
   depend on it; a later cycle should clean it up (it's marked qa-scratch)
   only once the journey is done or abandoned.
2. [UNBLOCKED 2026-07-09 — /etc/hosts fix applied (see blocker note below),
   ready to retry] **Download via Soulseek.** Run
   `download_wishlist.py` dry-run first,
   then a real capped run (`--max-downloads 1`). Watch slskd pull the file
   into the watch dir (local-dev caveat: may need the filebrowser/`docker cp`
   bridge into the `user-updownloads` volume — see skill Step 3).
3. [DONE 20:38 cycle] **Verify import.** Done via the sanctioned import-half
   shortcut (no Soulseek): dropped a genuinely-new real audio file straight
   into `test260526`'s watch dir and verified pymix's watcher ingested it,
   assigned + physically wrote a fresh `SUBBOX_ID`, and Navidrome scanned it
   in. Full verified writeup: `../pymix-qa/docs/qa/features/watch-dir-import.md`.
   (The wishlist-row `downloaded`/`available` flip is NOT covered by this
   shortcut — that transition belongs to the Soulseek/`download_wishlist.py`
   half, still blocked below. The seeded Aphex Twin - Xtal wishlist row is
   untouched and still `resolved`; the imported track is a separate scratch
   track, see below.)
4. [DONE 2026-07-10] **Sort into a playlist.** Scratch track
   (`tOJShpEmjhKArc2yCEafOz`) was added to a new playlist **"QA Import
   Playlist 0709"** (`TLmCrimKHRNhAfS6FJYUnB`, created 2026-07-09T20:57Z) — by
   a prior unlogged cycle via `scripts/qa/add-to-playlist-smoke.mjs`.
   Verified this cycle: (a) server-side via Subsonic `getPlaylist` — playlist
   holds exactly that one track; (b) client-side — the Sync→Download plan for
   this playlist reads it as its single member. Persisted correctly.
5. [DONE 2026-07-10] **Download missing tracks to local music dir.** Drove the
   client Sync → "Preview Download" → "Download & Extract" for "QA Import
   Playlist 0709". Preview correctly flagged the track as Missing (1) / 1 to
   download / 3.6 MB. Download & Extract → "Download Complete, 1 track
   exported": the file landed at `subbox-dev/music/QA UX Loop/qa-scratch/00 -
   QA UX Loop - Import Probe 2026-07-09.mp3` (dev folder 7→8 audio files),
   byte-exact (3806839 B), SUBBOX_ID preserved
   (`1e5002e2-9050-4067-8192-b317278d1cf0`). Isolation held: shared
   `subbox/music` untouched at exactly 808 files. A follow-up preview flipped
   the track missing→already-present (0 to download), confirming the round
   trip. Writeup: `features/playlist-add-and-download.md`.

**Scratch track imported in sub-step 3 (needed for 4 & 5 — leave in place):**
- Library path: `/music/test260526/QA UX Loop/qa-scratch/00 - QA UX Loop -
  Import Probe 2026-07-09.mp3`
- `subbox_id = 1e5002e2-9050-4067-8192-b317278d1cf0`, beet id `665`
- Identity: artist `QA UX Loop`, album `qa-scratch`, title
  `Import Probe 2026-07-09`. Real 231 s audio.
- Cleanup when 4 & 5 done/abandoned: delete the file, its beets entry
  (`beet remove` in `beetstest260526`), and let Navidrome purge it
  (`Scanner.PurgeMissing = "always"`). Scratch source at `/tmp/qa-import-scratch/`.

**Progress notes:**
- Cycle 2026-07-10 (this cycle) — completed sub-steps 4 & 5 end to end (see
  their DONE notes above + `features/playlist-add-and-download.md`). The
  user's actual Discord request — import new music → sort into playlist →
  download missing tracks to the local music dir — is now **fully verified**
  (import = sub-step 3, playlist = sub-step 4, download = sub-step 5). No bugs
  found; the flow works as designed, so no code change. **Directive moved to
  DONE.** The only remaining item, sub-step 2 (Soulseek *acquisition* of a
  wishlist row via `download_wishlist.py`), was the loop's own add-on rather
  than part of the verbatim request; it's been split into its own PENDING
  directive below so this journey can close cleanly. The seeded Aphex Twin -
  Xtal wishlist row is left in place for that split directive.
- Cycle 21:30 — preflight done: stack up, pymix idle (only periodic
  wishlist-reconcile/sheet-sync jobs), slskd reachable (200 on :5030).
  Wishlist had 2 pre-existing resolved rows ("Text Chunk - High Time",
  "Blood of Aza，SISSY MISFIT - BREAK THAT"), both status=wishlist.
  Sub-step 1 completed (see above).
- Cycle 20:38 (2026-07-09) — Soulseek blocker (sub-step 2) re-confirmed still
  present (`navidrometest260526.docker.localhost` still unresolvable by Python
  `getaddrinfo`; `/etc/hosts` still lacks the per-user vhost; needs sudo).
  Rather than re-log the blocker in a hot loop, **pivoted to the sanctioned
  import-half shortcut** and completed sub-step 3 end to end (see above +
  `features/watch-dir-import.md`). Also logged one pre-existing OPEN pymix
  observation found along the way (`orphaned-downloads-beets-entries` in
  `../pymix-qa/docs/qa/bugs.md`). No code changes / no fix committed this
  cycle — the import path worked correctly as-is. Next cycle: sub-step 4.
- 2026-07-09 (manual, from interactive session) — sub-step 2 blocker RESOLVED
  via fix (a): added `127.0.0.1  navidrometest260526.docker.localhost` to
  `/etc/hosts`; Python `getaddrinfo` now resolves the vhost. **Next cycle:
  retry sub-step 2** — `download_wishlist.py` dry-run, then a real
  `--max-downloads 1` run; watch slskd pull the seeded Aphex Twin - Xtal into
  the watch dir, then continue the journey. Sub-steps 4 & 5 remain ready via
  the already-imported scratch track if Soulseek still misbehaves.

**BLOCKER on sub-step 2 (download_wishlist.py) — RESOLVED 2026-07-09 via fix
(a): user added `127.0.0.1  navidrometest260526.docker.localhost` to
`/etc/hosts`. Python `getaddrinfo` now resolves the per-user Navidrome vhost,
so `download_wishlist.py`'s owned-check can reach Navidrome. Retry sub-step 2
(dry-run, then a real `--max-downloads 1` run). Original root-cause analysis
retained below for context; a durable code/doc fix (b)/(c) is still worth
doing so the next fresh machine doesn't hit this.**

The `wishlist-import-dev` skill's documented downloader run failed immediately:

```
error: could not reach Navidrome at https://navidrometest260526.docker.localhost:
GET .../rest/ping.view -> connection error ... [Errno 8] nodename nor servname
provided, or not known
```

Root cause (verified): `/etc/hosts` maps `pymix.docker.localhost` and
`browser.docker.localhost` to 127.0.0.1, but **not** the per-user
`navidrome<user>.docker.localhost`. `curl` resolves any `*.localhost` to
loopback (RFC 6761) so the pymix calls and manual `curl` checks all work —
which masks the gap — but `download_wishlist.py` uses Python `urllib`, and
Python's `getaddrinfo` on this macOS does **not** map `*.localhost`.
`python3 -c 'socket.gethostbyname("navidrometest260526.docker.localhost")'`
raises `gaierror`, while `pymix.docker.localhost` resolves (it's in
/etc/hosts). The script connects to the Navidrome URL host directly (no
Host-header override — `download_wishlist.py:1119` `Navidrome(navidrome_url,…)`
→ `urlopen`), so the name must actually resolve, and the owned-check aborts
the whole run when it can't.

Adding the /etc/hosts line needs sudo, which is not available non-interactively
in a background cycle, so this loop cannot self-unblock. **This is not a
subbox-app or pymix product bug** — the fix lies outside the QA worktrees:
  (a) **user/host:** add `127.0.0.1  navidrometest260526.docker.localhost`
      (and any other per-user vhosts you test) to `/etc/hosts`; **or**
  (b) **durable code fix in `../subbox-slskd`** (out of this loop's
      auto-commit scope): the script already rewrites a `localhost` slskd URL
      to `127.0.0.1` in `_ipv4_localhost()` (download_wishlist.py:1067) for
      exactly this class of Python-vs-loopback problem — extend the same
      rewrite to map any `*.docker.localhost` host in the pymix/navidrome URLs
      to `127.0.0.1` when `--insecure`/local-dev is in play; **or**
  (c) **doc fix:** note the /etc/hosts prerequisite in the skill SKILL.md.

**Resume plan:** once (a)/(b) is in place, re-run the dry-run then a real
`--max-downloads 1` run and continue at sub-step 2. Alternatively a future
cycle can pivot to the skill's sanctioned **import-half** shortcut (drop a
real, no-SUBBOX_ID audio file into `test260526/watch/` via filebrowser or
`docker cp` into the `user-updownloads` volume) to exercise sub-steps 3-5
(import → tag → Navidrome → playlist → sync-download) without the Soulseek
acquisition — but that needs a genuinely new real audio file (the skill says
use real files for the import flow, not fabricated silence). NB: there's a
pile of prior real Soulseek downloads in `~/Downloads/test-watch`, but those
are the user's own files and none is the seeded Aphex Twin - Xtal.

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
