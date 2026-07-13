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

_(none)_

## IN PROGRESS

<!-- Move here once a cycle starts on it. Keep notes updated each cycle with
     what step it's on, so a fresh-context cycle can resume correctly. -->

_(none)_

## DONE

Completed directives are compacted to one line + a link and moved to
`directives-archive.md` (the loop does not read that file). Don't accumulate
finished writeups here — this file stays lean so every cycle reads it cheaply.
