# Directives archive (DONE)

Completed directives, newest first. **The loop does not read this file** — it's
inert history, kept only so a person can see what's already been verified. Each
entry is one line + a link to the `features/*.md` doc that holds the full
verified writeup (that doc, not this list, is the ground truth). When a directive
in `directives.md` is fully verified end-to-end, compact it to one line here and
delete it from `directives.md`.

- **yt-dlp cookie auth** (pymix #21 `ytdlp_support.py`). Added 2026-07-09, done
  2026-07-10. Verified to the limit of local dev — a present cookies file reaches
  yt-dlp `opts["cookiefile"]` in both consuming services; absent → anonymous path
  unchanged. No bug, no code change. The authenticated-download *outcome* is
  prod-only (real cookies + datacenter IP) and was handed to the user. Writeup:
  `../pymix-qa/docs/qa/features/ytdlp-cookie-auth.md`.

- **Soulseek acquisition of a wishlist row** (`download_wishlist.py`). Added +
  done 2026-07-10. Verified end to end — slskd pulled `Aphex Twin - Xtal.flac`
  from a real peer, row flipped `wishlist → downloaded`; bridged into the watch
  dir, pymix beet-imported it + physically stamped a `SUBBOX_ID`, Navidrome
  scanned it, reconcile flipped the row `downloaded → available` with a matching
  `linked_subbox_id`. No bug, no code change. Writeup:
  `../pymix-qa/docs/qa/features/wishlist-download-acquisition.md`.

- **From phone (Discord) — wishlist import → playlist → download journey.** Added
  2026-07-09, done 2026-07-10. The user's full Discord request verified end to
  end: import a new track (watch-dir import → tag → Navidrome scan) → add to a
  playlist (server- + client-side) → download the missing track to the local
  music dir (byte-exact, `SUBBOX_ID` preserved, shared `subbox/music` untouched).
  No bug, no code change. Writeups:
  `features/playlist-add-and-download.md`,
  `../pymix-qa/docs/qa/features/watch-dir-import.md`.

- **Validate SUBBOX_ID-based sync matching** (subbox-app #14 + pymix #21). Added +
  done 2026-07-09. Drove `sync/plan` preview and a real `sync/playlists` download
  end to end against real test data; subbox_id fast path confirmed, fuzzy fallback
  for untagged local tracks confirmed, cache invalidation + pruning confirmed.
  Produced [laker-93/pymix#22](https://github.com/laker-93/pymix/pull/22) (merged
  — a logging fix: `subbox_id_match_summary` ERROR'd on normal syncs, replaced with
  a precise `subbox_id_divergence` signal) and one OPEN follow-up in
  `../pymix-qa/docs/qa/bugs.md` (`subbox_id_divergence` over-fires on plain
  not-yet-downloaded tracks — needs a design call). Writeup: `features/sync.md`.
