# Feature: Invite funnel (`features/invite/`) — landing + create-account entry points

**Verified 2026-08-17** by driving the built Electron app (development build,
pointing at the local stack) with `scripts/qa/invite-funnel-journey.mjs`.
Client-only change (a scoped mutation-retry fix); no pymix code change, no
container rebuild — pymix was restarted twice mid-cycle purely to reset its
in-process `/invite-request` rate-limit counter (in-memory, no persisted
state), not to pick up new code. `[subbox]`. Backend half already covered:
`../pymix-qa/docs/qa/features/invite-request.md`.

## Scope

Only the two entry points reachable **without a demo session** are driven
here: the landing page's own "Request an invite" link (`source: landing`) and
the "Request an invite" link inside the Create Account form (`source:
createAccount`, which has to render *above* the auth modal it's opened from).
`DemoBanner` (`source: demoBanner`) and `InviteLockedPanel` (`source:
blockedAction`, on Sync → Upload/Watch and Sync → Upload (Rekordbox)) both
gate on `useIsDemoSession` — there is no demo login on the local dev stack, so
those are out of scope here, same caveat the README's separate "Demo session
restrictions" row already carries.

## What was driven, and what happened

1. **Landing page → "Request an invite"** (footer link, `source: landing`).
   Modal opens with the landing intro copy. Submitted an email the backend
   rejects (`a@b` — passes the browser's native `<input type=email>` check
   but fails pydantic's `EmailStr`, since it has no dot) → a real 400 from
   pymix → correctly rendered as the inline field error ("That doesn't look
   like a valid email address"), not a generic toast. Then submitted a valid
   scratch address with `dj_software: other` + free text ("Traktor") →
   success screen, echoes the submitted address, `dj_software_other`
   persisted correctly (confirmed via direct `psql` against
   `invite_request_table`).
2. **Landing page → "Create account" → "Request an invite" inside that
   form** (`source: createAccount`). Confirmed **live, visually** (screenshot)
   that the invite modal renders on top of the still-open auth modal — both
   dialogs visible at once, invite modal legible, auth modal dimmed behind —
   matching the `zIndex={400}` stacking `request-invite-modal.tsx` documents
   in comments. Submitted a second scratch address (default `dj_software:
   rekordbox`) → success screen. Cancelled the create-account form afterward
   without creating a real account.
3. All scratch rows deleted from `invite_request_table` via `psql` after each
   run; table confirmed empty before and after.

## Bug found and fixed

**One click on the invalid-email case produced 4 real HTTP requests to
pymix, ~8s apart (exponential backoff), all 400s** — confirmed via
`docker logs pymix`. Root cause: `src/renderer/lib/react-query.ts`'s
`queryClient` sets a **global** mutation default,
`retry: process.env.NODE_ENV === 'production' ? 3 : false`, and
`useRequestInvite` didn't override it. This isn't a QA-build-only artifact —
grepping the built output of `electron-vite build --mode development` still
showed `mutations:{retry:3}` baked in, because a plain `vite build` always
defines `process.env.NODE_ENV` as `'production'` for the bundle regardless of
the `--mode` flag (which only selects which `.env.<mode>` file loads); real
production releases carry the same `retry:3`.

**Why it matters here specifically:** pymix's `POST /invite-request` caps at
5 requests/hour per IP, sized deliberately ("generous enough that a real user
correcting their answer a few times never hits it" — `routers/invite_request.py`).
Retrying a definite 4xx rejection burns through that budget for no benefit —
one mistyped address consumed 4 of the 5 allowed requests before the user
even got to submit their real one; a second typo would immediately trip the
limiter.

**Fix (shipped, commit `755ba5d9`, PR
[#106](https://github.com/laker-93/subbox-app/pull/106), issue
[#105](https://github.com/laker-93/subbox-app/issues/105)):** added
`retry: false` to `useRequestInvite`'s own `useMutation` options — same
pattern already used by `share-item-mutation.ts` for the same class of
concern (a non-idempotent-feeling, non-transient failure that retrying can't
fix). Re-verified live post-fix: a clean 3-request run (1 request per user
action: invalid email → 1×400, two valid submissions → 1×200 each) confirmed
via `docker logs pymix`.

**Not touched (flagged, not a bug on its own):** the broader global default
— every other mutation in the app that doesn't locally override `retry`
still retries 3× on *any* error in production, including non-transient 4xx
— is unchanged. That's a cross-cutting design question (does every mutation
want this?) outside this conservative single-call-site fix; noted in the
GitHub issue for awareness, not filed as its own bug.

## Driver gotchas (for whoever reuses this script)

- **The invite modal and the auth modal both contain overlapping text.**
  Naive `hasText` filters (e.g. `/invite token/i`) match both dialogs once
  they're stacked. Distinguish by a field unique to one side — `"Username"`
  only appears in the create-account form — and use `hasNotText` for the
  invite modal so the same locator survives its form → success-screen
  transition (the intro copy that would otherwise anchor a filter disappears
  once the success screen renders).
- **`<input type=email>` native validation intercepts obviously-malformed
  input before React ever sees a submit.** To exercise the app's own
  server-driven inline-error path, use an address that's syntactically valid
  per HTML5 but still rejected by pydantic's `EmailStr` (no TLD, e.g. `a@b`)
  — that reaches the backend and comes back a real 400.
- **The rate limit is real and shared across a whole QA session.** 5
  requests/hour per IP, in-memory on the pymix process. A few driver runs in
  one sitting can exhaust it; restarting the `pymix` container resets the
  counter (it's not persisted) without needing a rebuild — confirm the
  container is otherwise idle first, same as any other container touch.
