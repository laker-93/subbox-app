# Bug archive (subbox-app)

Inert history — full text of `FIXED` bugs, moved out of `bugs.md` so that hot
file (re-read on every turn of every cycle) stays small. **The loop never reads
this file.** `bugs.md` keeps a one-line index of everything archived here. Same
pattern as `directives-archive.md`.

<!-- Full FIXED entries, appended verbatim from bugs.md when closed. -->

### Delete track showed a success toast even when the delete failed

Found + fixed: 2026-07-14. Journey: song context menu → "Delete track" → confirm
(`scripts/qa/delete-track-journey.mjs`), account `test260526`.
Issue: https://github.com/laker-93/subbox-app/issues/18

**Bug.** pymix signals a failed delete **in the body, not the HTTP status**:
`DELETE /track` returns **200** with
`{"success": false, "results":[{"success": false, "reason": "…"}]}`. The client
threw that body away — `pymix-types.ts` declared the response schema as
`const deleteSong = z.null()` — and `PymixController.deleteSong` only checked
`res.status !== 200`. So the mutation resolved, and `delete-song-action.tsx`
fired the **success toast for a delete that never happened**. The user believes
the track is gone; it's still on disk and still in the library.

Reachable whenever pymix's beets state and the Navidrome library have drifted
apart (also confirmed directly against the API for any unknown/stale
`subbox_id`).

**Repro (live).** Import a scratch track via the watch dir, then create a
realistic desync by dropping its beets row only, leaving the file + Navidrome
entry: `docker exec beetstest260526 beet rm -f "subbox_id::<id>"`. Delete it in
the app. Before the fix: `DELETE /track` → 200 `success:false` (reason: a raw
`DockerException` — `beet rm -df … 'error: No matching items found.'`), UI showed
the **success** toast, file still at
`/private-music/test260526/QA Desync Probe/qa-desync-scratch/00 - ….mp3`.

**Fix.** `pymix-types.ts`: the `deleteSong` response schema now captures pymix's
`{success, results, reason}` instead of `z.null()`. `pymix-controller.ts`:
`deleteSong` throws when `success === false`, with the per-id reasons logged to
the console and a concise message for the toast. `delete-song-action.tsx` already
catches and shows an error toast, so nothing else changed.

**Re-verified live** (rebuilt `electron-vite build --mode development`, re-drove
the identical desync repro): the flow now shows **"Error / Failed to delete the
track"** and the track correctly stays listed. **Happy-path regression checked**
on a fresh scratch track: still exactly 1 request, success toast, and the file /
beets row / pymix rows all actually deleted. `pnpm typecheck` clean;
`pnpm lint-code` clean on the changed files (3 pre-existing errors remain in
older `scripts/qa/` drivers, untouched).

Noted, not a regression: a *failed* delete now fires 4 requests, because the
app's standing `mutations.retry: 3` policy (`renderer/lib/react-query.ts:24`)
only becomes reachable once the mutation actually rejects. Harmless (re-deleting
a gone id fails identically) and consistent with every other mutation.

Commit: see `claude/continuous-ux`. PR: https://github.com/laker-93/subbox-app/pull/19
Writeup: `features/delete-track.md`. Single-repo (subbox-app). The pymix half of
this story — a failed delete still commits pymix's DB-row deletion, orphaning the
file — is logged separately as pymix issue #30, and is **not** fixed.
