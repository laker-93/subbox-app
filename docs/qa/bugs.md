# Bug log (subbox-app)

Correctness bugs only — things that are outright wrong. For rough-but-working
UX friction, use `ux-notes.md` instead. See `README.md` for the conservative
fix policy before touching either an OPEN entry or committing a FIXED one.

## OPEN

<!-- One entry per bug. Include: date found, journey/route it showed up on,
     repro steps, evidence (screenshot path / console error), and your
     hypothesis for root cause + which repo owns it. Remove an entry (move to
     FIXED) once actually fixed and verified, don't just mark it done. -->

### (informational, not urgent) Playlist "Kodzo" has a duplicate track server-side

Added: 2026-07-09. Found while validating pymix#22's new
`subbox_id_divergence` signal for real (see `directives.md`).

Test account `test260526`'s "Kodzo" playlist has two distinct server tracks
with identical title/artist/album ("Damager (Hamdi Edit)" — Sammy Virji &
Interplanetary Criminal — DUBSTEP DELUXE (LDS 246)), each with its own
`subbox_id`. Downloading the playlist fetches one; the second then shows as
"missing" on the next preview forever (correctly — its distinct subbox_id
genuinely has no local match), and would be re-downloaded as an apparent
duplicate if the user did.

Not filing as a bug to fix — this is a data question (is the duplicate
intentional, a re-import artifact, two different masters of the same
track?), not a code defect, and out of scope for the sync-matching
directive. Flagging here so it isn't mistaken for a `subbox_id_divergence`
false positive if seen again — it's a real, correctly-flagged case.

## FIXED

<!-- One entry per fix: date, one-line description, commit SHA on this
     branch, and a note on how it was re-verified. -->

_(none yet)_
