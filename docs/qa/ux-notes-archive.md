# UX-notes archive (subbox-app)

Inert history — full text of `RESOLVED` (not-a-bug determinations) and `IMPROVED`
notes, moved out of `ux-notes.md` so that hot file (re-read on every turn of every
cycle) stays small. **The loop never reads this file.** `ux-notes.md` keeps a
one-line index of everything archived here. Same pattern as `directives-archive.md`.

## RESOLVED (not a bug — kept so it isn't re-investigated)

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

No fix needed. Also documented in `features/sync.md` so a future cycle doesn't
re-investigate the same "why does the console show a 400" observation from
scratch.
