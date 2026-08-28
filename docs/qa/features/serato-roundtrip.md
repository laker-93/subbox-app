# Serato ↔ Rekordbox round trip (from an empty library)

Verified 2026-08-27 against the local dev stack, account `test060826`, driving
this worktree's Electron build. Driver: `scripts/qa/serato-roundtrip.mjs`, wrapped
as the `/test-serato-roundtrip` skill. Supporting helpers: `scripts/qa/reset-library.mjs`
(wipe the account) and `scripts/qa/dev-http.mjs` (reach the stack from Node).

This is the regression for the Serato import/export shipped in subbox-app #113
(import) and #114 (crate writing), pymix #136/#138 — the two directions plus the
two conversions between them, driven as one journey because that is the only way
a format that silently drops something is caught.

## What it drives

Five phases, each fed by the last:

| Phase | Surface | What it asserts |
|---|---|---|
| `reset` | — | the account is empty, the local download mirror is gone, a fresh synthetic Serato library exists |
| `serato-upload` | Sync → Upload (Serato) | the crate tree came back as playlists with the right names, and every fixture track is in beets |
| `rekordbox-export` | Sync → Download + "Include Rekordbox XML" | the XML carries every playlist, and every `Location` resolves to a file that is on disk |
| `rekordbox-import` | Sync → Upload (Rekordbox) | the same library rebuilds from the XML the previous phase wrote, into a freshly emptied account |
| `serato-export` | Sync → Download + "Write Serato crates" | the crates written read back with the fixture's tree, every entry points at a real file, and the cues are still there |

`QA_PHASES=serato-export node scripts/qa/serato-roundtrip.mjs` runs a subset; each
later phase falls back to the fixture snapshot and the XML already on disk.

## Why it is one driver

The XML that `rekordbox-export` writes is what `rekordbox-import` reads, and the
crates `serato-export` writes are compared against the fixture `reset` generated.
Every screen in this journey can say "complete" while the artefact is wrong — the
crate write does exactly that today (see the parent-crate bug in `bugs.md`). The
assertions are therefore against Navidrome, beets, and the files themselves, never
against the done screen. The one thing read off the screen is the badge counts on
the preview, because that *is* the thing under test there.

## Fixture

`subbox-workspace/scripts/serato/make_test_serato_library.py` (the
`/make-test-serato-library` skill), seeded at 4242, 8 tracks, 30s each, written
into `.qa-serato/source/_Serato_` — **not** `~/Music/_Serato_`, so a nightly run
can never touch the library the user opens in Serato. The tree is deliberately the
awkward shape:

```
Subbox QA                  all 8 tracks   ← a crate that has tracks AND children
Subbox QA / Cues           first 4
Subbox QA / Nested         (no tracks — a folder, never a playlist)
Subbox QA / Nested / Deep  last 4
```

Every track carries `SUBBOX_ID`, a ⭐ rating in `COMPOSER`, and three hot cues plus
one saved loop in its `Serato Markers2` frame. `serato_snapshot.py capture` reads
the fixture and the written crates with pyserato — the same implementation pymix
parses crates with — so both ends of the round trip are measured the same way.

## Verified behaviour (2026-08-27)

- **Serato import works end to end.** 8 tracks uploaded, 3 playlists created,
  `Subbox QA / Cues` and `Subbox QA / Nested / Deep` named by their full ancestry.
  A crate with no tracks of its own (`Nested`) correctly becomes no playlist.
- **The preview counts tracks once**, not once per crate they appear in: 3 crates,
  8 tracks, against 16 crate entries.
- **The Rekordbox XML resolves.** All 8 `Location`s point at files that exist, and
  the playlist folder tree matches (`A / B` in Navidrome is node `B` under folder
  `A` in the XML).
- **The XML re-imports into an empty account** and rebuilds the same 8 tracks and
  3 playlists — the Serato → Rekordbox → subbox path is lossless for structure.
- **The crate write drops the parent crate's tracks.** `bugs.md`, OPEN. The done
  screen reports 3 crates / 16 tracks; `Subbox QA.crate` lands empty.

## What the cue check does and does not prove

`crate entries still carry their cues` compares the cue count on the files the
written crates point at (32: 8 tracks × 3 cues + 1 loop) against the fixture. It
proves the round trip did not *destroy* the cues, which is the damage a user
cannot undo (tserato#9). It does **not** prove pymix carried the cues back out:
the client deliberately leaves a file that already has cues untouched — the done
screen says "8 tracks already had cues in Serato and were left untouched" — and on
this path every downloaded file still has the fixture's frames. Proving the server
round trip needs a track whose local copy has no `Markers2` frame; the fixture
generator's `--no-cues` flag is the obvious way in, and that is an open gap.

## Known-issue notes (printed, not failed)

`pymix#139` — the download counts a track once per playlist it appears in, so the
done screen says "16 tracks exported" for 8 unique tracks. Already filed, so the
driver records it as a `NOTE` rather than a failing check; promote it to a `check()`
when the fix lands.

## Boundaries

Local dev only, and **destructive**: `reset` empties the account it runs against.
`devRequest` refuses any host that is not `*.docker.localhost`, so it cannot be
pointed at staging or prod. It does not open Serato — nothing can; Serato DJ Pro
ships no automation surface, so "does Serato itself accept this" stays a by-eye
check against `~/Music/_Serato_`, documented in
`subbox-workspace/scripts/serato/README.md`.
