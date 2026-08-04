# Feature: Internet Radio (`/radio`) — list → create → play → edit/delete permissions

**Verified 2026-08-04** by driving the built Electron app (development build,
pointing at the local stack) with `scripts/qa/radio-journey.mjs`. Client-only
journey; no backend change. Account `test260526`. `[upstream]` — this is
Subsonic/Navidrome's native internet-radio-station feature (`createInternetRadioStation`
et al.), unrelated to subbox's own "play artist/track/album radio" context-menu
actions (those use Navidrome's `getSimilarSongs`-style seed-play, a different
code path entirely — not covered by this row).

## What was driven, and what happened

1. **List** (`/radio`, `radioQueries.list` → `getInternetRadioStations`). Renders
   correctly; empty-state hint text present when no stations exist. The header's
   **"Create radio station"** button is unconditionally visible
   (`permissions.radio.create` is hardcoded `true` in `usePermissions()` — every
   user, not just admins, can add a station).
2. **Create** (`openCreateRadioStationModal` → `CreateRadioStationForm` →
   `POST` via `createInternetRadioStation`). Modal has Name/Stream URL (required)
   + Homepage URL (optional) fields. Submitted a real station pointing at a
   public Icecast test stream (SomaFM "Groove Salad",
   `https://ice1.somafm.com/groovesalad-128-mp3`) — created cleanly, modal
   closed, new row appeared in the list immediately (query invalidation works).
3. **Play** (click a list row → `useRadioControls().play(streamUrl, name)` →
   `RadioWebPlayer`). Confirmed **real audio playback**: a live `<audio>` element
   with `currentSrc` matching the stream URL, `paused=false`, `currentTime`
   advancing across polls. Player-bar metadata correctly shows the station name
   (as a link back to `/radio`, per `radio-metadata-display.tsx`) while a track
   title/artist row shows "—" placeholders until ICY stream metadata arrives
   (`useRadioMetadata`'s `IcecastMetadataStats` listener) — expected behavior,
   not a bug.
4. **Stop** (click the same row again → `stop()`). Correctly pauses/tears down
   playback (`audio.paused` flips back to `true`).
5. **Edit/delete permissions** (`permissions.radio.edit`/`delete`, both gated on
   `isAdmin`). For this account (a genuine Navidrome admin — confirmed via
   direct `/auth/login` returning `isAdmin: true` and the per-user DB's
   `user.is_admin=1`), both the edit (pencil) and delete (trash) `ActionIcon`s
   render on each row (3 buttons per row: play + edit + delete). Delete →
   confirm modal → row removed from the list and gone from the server
   (`radio` table empty after), confirmed via direct sqlite query against
   `navidrometest260526`.

**No bug found.** Full create → play → stop → delete lifecycle works correctly,
and the edit/delete admin-gate correctly reflects each account's real Navidrome
admin status.

## Driver gotchas (for whoever reuses this script)

- **Must force a fresh login.** A persisted session from an older cycle can
  carry a stale `isAdmin: false` in `store_authentication` (localStorage) even
  though the account is genuinely a Navidrome admin — this cost a full extra
  cycle-round-trip the first time (looked like a real permissions bug: created
  2 scratch stations with no delete button available, both later cleaned up by
  hand). A `forceFreshLogin()` + `performLogin()` at driver start avoids this;
  don't reuse `isLoggedOut(page)` gating alone for anything that reads
  `isAdmin`.
- **Edit/delete `ActionIcon`s have no `aria-label`/`title`.** `action-icon.tsx`
  wraps them in a Mantine `Tooltip` (portal-only, hover-triggered) rather than
  setting an accessible name on the button itself, so `getByRole('button',
  {name: /delete/i})` and `[aria-label*="Delete"]` both silently match nothing.
  Scope to the station's row container (`[class*="radio-item"
  i]:not([class*="button" i])`, filtered by station-name text) and take
  `.locator('button')` in DOM order (play, edit, delete) instead.
- **The player-bar station-name link duplicates the list-row text.** Once
  playing, `radio-metadata-display.tsx` renders the station name as a link back
  to `/radio` in the player bar — an unscoped `page.getByText(stationName)`
  matches both that link and the list row (Playwright strict-mode violation).
  Use `getByRole('button', {name: ...})` scoped to the list row instead.
