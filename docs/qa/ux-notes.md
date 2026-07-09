# UX friction log (subbox-app)

Things that aren't wrong, just rough for a real user — confusing empty
states, silent failures, inconsistent patterns vs. the rest of the app,
missing feedback on slow operations, etc. See `README.md` for the bar on
when friction is worth actually fixing vs. just logging.

## OPEN

<!-- One entry per observation: date, journey/route, what a real user would
     find confusing/awkward and why, evidence (screenshot path), and whether
     you think it's a safe small fix or needs a design call. -->

_(none open — see RESOLVED below)_

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
