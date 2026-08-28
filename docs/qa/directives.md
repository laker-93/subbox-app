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
progress rather than treating it as one atomic cycle. Move it to the archive
(below) only once the whole thing has actually been driven and verified
end-to-end, not when it looks plausible from reading code.

> **Keep this file small.** The loop reads it first every cycle, so only the
> live sections below (PENDING + IN PROGRESS) belong here. When a directive is
> fully verified end-to-end, compact it to a one-line + link entry in
> `directives-archive.md` and delete it from here — the full writeup lives in
> the relevant `features/*.md`, so nothing is lost.

## PENDING

<!-- One entry per directive, oldest first (process in order unless the user
     says otherwise). Format:
     ### <short title>
     Added: YYYY-MM-DD
     Request: <verbatim or lightly cleaned-up ask>
     Notes: <breakdown into sub-steps, if any>
-->

### Serato integration: keep the round trip green, then widen it

Added: 2026-08-27
Request: "I've just added serato upload and download integration into subbox app.
Set up the qa runner so it tests out this workflow — it should test using the dev
local env and the test user account test060826 and test from a clean library of
the account — upload initial library from serato then convert to rekordbox and
vice versa and then explore other integration tests."

Status: the core of this is **already built and passing** — driver
`scripts/qa/serato-roundtrip.mjs`, skill `/test-serato-roundtrip`, feature doc
`docs/qa/features/serato-roundtrip.md`. It resets `test060826` to an empty library,
imports a synthetic Serato library through the app, exports a Rekordbox XML,
re-imports that XML into an emptied account, and writes the playlists back out as
Serato crates. 15 of its 16 checks pass; the one failure is a real OPEN bug (see
below). Because it is a `test-*` skill the regression rotation picks it up on its
own — **do not rebuild it.**

What is left is the "explore other integration tests" half. Work these in order,
one per cycle, and add each as a phase or a sibling driver rather than a new
one-off script:

1. **Fix the parent-crate bug** — `bugs.md`, "Writing a crate that has both its own
   tracks and a sub-crate loses the parent's tracks". Root-caused with a 1-second
   repro; the fix is in `writeCrates` (merge the branches into one tree and save
   each root once, or re-save the track-owning crates after the stubs). File the
   `qa-bug` issue first, add the shape to `scripts/check-serato-crates.ts`, then
   re-run `QA_PHASES=serato-export` to verify before committing.
2. **Prove pymix carries cues back out.** Today's cue check only proves the cues
   were not destroyed — the client skips a local file that already has them.
   Generate a second fixture with `--no-cues`, upload it, and assert the exported
   crates' files come back *with* cues written by the export.
3. **The paths that are not the happy one**, each a phase flag on the driver:
   `--with-stale-track` (a crate entry whose file has moved off the machine — it
   should be listed on the completion screen, not fail the import); "Playlists only
   (no track uploads)"; a partial crate selection (tick two of three) rather than
   Select All.
4. **Re-import what subbox wrote.** Point phase `serato-upload` at the
   `.qa-serato/export/_Serato_` the last phase produced instead of the fixture —
   subbox reading its own crates back is the loop the user will actually live in,
   and it is the cheapest place for a path-form or naming regression to show up.
5. **A library on an external volume.** The import-side path bug (pymix#142 /
   subbox-app#115) is filed and unfixed: a crate on a mounted drive stores
   `Music/…`, both parsers prepend `/`, and every track resolves to a boot-volume
   path that is not there. `pnpm dev:serato-dmg` in subbox-app builds the disk
   image. Driving it is worth doing even while the fix is out of scope — it turns a
   written-down analysis into a reproducing test.

Notes: the driver is destructive by design (it empties `test060826` every run) —
that was the user's explicit choice, so do not add a guard asking about it. The
account's old ~759 MB Jamendo library was wiped setting this up; if a cycle needs a
realistic library again, re-seed with `scripts/qa/_jamendo100-upload.mjs` rather
than assuming the old playlists ("Downtempo", "Ambient", …) still exist — other
drivers that default to those names will need their `QA_PLAYLIST` updating.


## IN PROGRESS

<!-- Move here once a cycle starts on it. Keep notes updated each cycle with
     what step it's on, so a fresh-context cycle can resume correctly. -->

_(none)_

## DONE

Completed directives are compacted to one line + a link and moved to
`directives-archive.md` (the loop does not read that file). Don't accumulate
finished writeups here — this file stays lean so every cycle reads it cheaply.
