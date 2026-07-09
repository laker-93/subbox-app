# UX friction log (subbox-app)

Things that aren't wrong, just rough for a real user — confusing empty
states, silent failures, inconsistent patterns vs. the rest of the app,
missing feedback on slow operations, etc. See `README.md` for the bar on
when friction is worth actually fixing vs. just logging.

## OPEN

<!-- One entry per observation: date, journey/route, what a real user would
     find confusing/awkward and why, evidence (screenshot path), and whether
     you think it's a safe small fix or needs a design call. -->

### First "Preview Download" click after launch always 400s once, then silently retries and succeeds

Added: 2026-07-09. Found validating the SUBBOX_ID sync directive (see
`directives.md`) — reproduced identically twice (once against the pre-#21
pymix image, once against the rebuilt one with the fast-path change, so it's
unrelated to that PR).

**Repro**: fresh Electron launch → Sync mode → Download tab → select a
playlist with tracks → click "Preview Download". Client-visible console
shows `Failed to load resource: the server responded with a status of 400`,
but the UI ends up showing a correct plan a few seconds later (no visible
error to the user) — pymix's access log confirms: same client connection
(same source port) makes a `POST /sync/plan` that gets `400 Bad Request`,
immediately followed by another `POST /sync/plan` from the same connection
that succeeds (`200 OK`).

**Why this is here and not in `bugs.md`**: the end result is correct and the
user never sees an error — this is UX/robustness friction (a silent
retry-after-failure masking something), not a confirmed correctness bug.
FastAPI 400s from Pydantic validation happen before our app-level logger
runs, so the pymix access log alone doesn't say what was malformed about the
first request.

**Not yet root-caused** — hypothesis for a future cycle: possibly the first
`scanLocalTracks()`-driven request fires before the local track list/some
field is fully populated (e.g. a race between the UI enabling "Preview
Download" and the underlying data being ready), and something retries on
failure. Next step: temporarily log the outgoing request body client-side
(or capture it with a network inspector) for the first vs. second attempt to
diff them, then check `sync.py`'s Pydantic `Track`/request model for what
would reject the first one specifically.

## IMPROVED

<!-- One entry per applied improvement: date, one-line description, commit
     SHA on this branch, how it was re-verified. -->

_(none yet)_
