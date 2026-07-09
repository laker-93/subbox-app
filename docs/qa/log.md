# Cycle log (subbox-app)

Append one line per loop cycle, newest at the bottom. Keep it terse — detail
belongs in `bugs.md` / `ux-notes.md` / `features/*.md`, not here.

Format: `YYYY-MM-DD HH:MM | <journey/area explored> | <outcome>`

Outcome is one of: `verified` (matched docs, no issues), `documented` (new
feature doc written), `bug-fixed` (commit made, see bugs.md), `ux-improved`
(commit made, see ux-notes.md), `logged` (issue found, not fixed), `blocked`
(couldn't proceed — e.g. dev stack down; say why).

<!-- entries start below -->
2026-07-09 10:20 | SUBBOX_ID sync directive: read diffs, drove sync/plan preview live (Electron + rebuilt pymix) | logged (1 pymix bug, 1 client ux-note; directive left IN PROGRESS, several sub-steps remain)
2026-07-09 12:05 | root-caused first-click 400 (user-directed follow-up, not autonomous) | verified — not a bug, working as designed (silent pymix session reauth-and-retry); moved ux-notes.md entry from OPEN to RESOLVED
2026-07-09 13:35 | investigated subboxId cache location (continuing SUBBOX_ID directive) | false lead — apparent cache-mislocation bug was a Playwright test-harness artifact (app.getName()="Electron" when launching bare out/main/index.js), not reproducible in real pnpm dev usage; drafted fix, verified it changed nothing observable, reverted; documented in features/sync.md so it isn't re-chased
2026-07-09 14:00 | pymix#15 (dev/prod music folder isolation) merged: rebased, drove real Download & Extract, cache invalidation + pruning (sub-steps 4/5/6) | verified — all working correctly; isolation confirmed live (shared subbox/music untouched at 808 files); bonus real-world confirmation of pymix#22's subbox_id_divergence signal (genuine duplicate playlist track, logged informationally in bugs.md)
2026-07-09 20:23 | SUBBOX_ID sync directive sub-step 3 (untagged-local fuzzy fallback): stripped SUBBOX_ID off real Oleo file, drove Kodzo Preview Download | verified — untagged local fuzzy-matched at similarity 1.000 (via=fuzzy), moved missing→already-present; corroborated OPEN pymix subbox_id_divergence over-fire (count 2→1). Directive now DONE (yt-dlp sub-step split into own PENDING directive). No code fix — verification cycle.
