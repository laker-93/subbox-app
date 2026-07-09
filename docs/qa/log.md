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
