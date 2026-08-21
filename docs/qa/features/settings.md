# Settings (`/settings`)

**Verified:** 2026-08-21 (About/Legal/Analytics section; Electron desktop app,
live driver `scripts/qa/about-legal-analytics-journey.mjs`, account
`test060826`). Earlier General/Playback/Hotkeys/Window/Advanced section
verified 2026-07-25 against `scripts/qa/settings-journey.mjs`
(account `test260526`, since deleted — not re-driven this cycle, no reason to
think it regressed).
**Tag:** `[mixed]` — most panes are inherited upstream Feishin; the
Export/Import settings backup control (Advanced tab) and the whole About tab
(Legal/Licence/Music credits) are subbox-authored.

## What it is

Six tabs (General, Playback, Hotkeys, Window, Advanced, About), each a
`SettingsSection` list of controls backed by the persisted `store_settings`
zustand store. The subbox-specific controls are **Import/export** on the
Advanced tab (`export-import-settings.tsx`: "Export" downloads the current
settings as `subbox-settings.json`; "Import" opens a modal, lets the user pick
a previously-exported file, shows a diff, and applies it on confirm) and the
whole **About** tab (see below).

## Reaching Settings while in Sync mode

`MainContentBody` (`layouts/default-layout/main-content.tsx`) renders the
routed `<Outlet />` — which is where `/settings` lives — only when
`appMode === 'library'`; in Sync mode the whole area is replaced by
`SyncModePlaceholder` regardless of the current route. A raw hash-navigation
to `/settings` while a *persisted* `appMode: 'sync'` is sitting in
`localStorage['store_app']` (e.g. left over from an earlier Sync-heavy QA
cycle) will silently show the Sync screen instead — confirmed live, not a
driver mistake. **Not a real bug**: no click path reaches `/settings` this
way. A real user's two actual routes to Settings are (1) the sidebar's
Settings entry (Library mode only, and clicking it can't leave you in Sync
mode since the sidebar itself only renders in Library mode), and (2) the
`AppMenu` "Settings" item (visible via the hamburger icon in Sync mode too)
which calls `openSettingsModal()` — a `SettingsContextModal` mounting the same
`SettingsContent`/tabs as an overlay, independent of `appMode`/route entirely.
A driver navigating by raw hash needs to click the "Library" toggle first if
it wants the routed page rather than the modal.

## Verified behavior

**All five non-About tabs render real content**, no blank/crashed panels:
General (6158 chars, theme/accent/artist-page/etc.), Playback (1265 chars,
audio device/player), Hotkeys (1114 chars), Window (2154 chars), Advanced
(740 chars — update/export-import/logger/cache; **no analytics toggle**, see
below, this doc's own older text was stale on that point). No error-like text
in any panel.

**Import Settings** (verified working, unaffected by the export bug below):
flip a setting → Import → file picker → diff screen renders the incoming JSON
→ confirm → setting reverts to the imported value.

**Export Settings — still broken, OPEN by design (issue #39).** On the
Electron desktop build, clicking "Export" produces no file in `~/Downloads`
until the whole app quits — the `Blob`+`URL.createObjectURL`+anchor-click
pattern (correct for the web build) never completes under Electron. A fix was
written and verified (branch `onExportSettings` on `isElectron()`, route the
Electron path through `webContents.downloadURL` + a `will-download` handler),
but the user closed its PR #40 **unmerged** as low-priority — see `bugs.md`'s
OPEN entry. **Do not re-implement**; the known-good approach is preserved on
git ref `qa-backup-20260813` in this worktree if it's ever wanted.

## About tab (`#93`/`#96`/`#89`) + Legal pages (`#98`) + Analytics beacon removed (`#99`)

Three small pause-era rows, driven together since they all live under
Settings/landing: `scripts/qa/about-legal-analytics-journey.mjs`, live against
`test060826` (read-only — no state mutated).

**About tab.** Three sections, `Legal` / `Licence` / `Music credits`
(`about-tab.tsx` composing `legal-settings.tsx` / `licence-settings.tsx` /
`music-credits-settings.tsx`), all render real content: 23 links total (3
Legal + 4 Licence + 16 from the 8 initially-shown credit rows, 2 links each).
Licence section correctly states the running build version (`Subbox 1.10.24`,
`packageJson.version`). Music credits' "Show all (N more)" control correctly
expands from 8 to all 50 tracks (`music-credits.json`) and "show less"
correctly collapses back to 8 — verified both directions live.

**Legal pages.** `useLegalLinks()` is the single shared source for all three
surfaces that link out to the static `/legal/*.html` pages (landing page,
About tab, auth modal) — confirmed the landing page's own footer row (queried
directly, not via `LegalFooterLinks` which only the About/auth-modal contexts
actually mount) renders the exact same 3 hrefs as the About tab's Legal
section, so there's no risk of the lists drifting apart. In this dev build
they resolve to `http://localhost:4343/legal/*.html` (`.env.development`'s
`VITE_LEGAL_URL`) — real, correct construction; whether that origin is
actually serving them depends on `pnpm dev:web` also being up, not tested
here (not a bug — see the `pnpm dev:web` `/settings.js` 404 note in
`docs/qa/log.md` 2026-08-17, same class of dev-server-only gap).

**Analytics beacon removed.** Confirmed as a true negative: `window.umami` is
`undefined` for the whole run (boot, login, Settings navigation) and **zero**
network requests matched `/umami|analytics/i` throughout. Root cause
confirmed by reading `index.html`: the upstream `<script>` tag that would
define `window.umami` is simply never emitted for a subbox build (removed,
not env-gated — the comment there explains why: loading it would disclose
every user's IP/UA to a third party subbox has no processor agreement with).
The upstream tracker hooks (`useAppTracker` et al.) are left in place for
merge cleanliness but all guard on `window.umami` and no-op. `advanced-tab.tsx`
correspondingly has no analytics section at all — upstream's opt-out toggle
would control nothing, so it isn't rendered.

## Driver notes (General/Playback/Hotkeys/Window/Advanced)

`scripts/qa/settings-journey.mjs` drives all 5 tabs, then the Advanced tab's
export button (polls the real `~/Downloads` dir rather than a Playwright
`download` event, since Electron's `downloadURL` path doesn't surface one to
the renderer), then attempts a flip-a-setting → import → confirm round trip.
The round-trip half of the driver has a pre-existing locator flakiness
unrelated to this fix: the "flip a toggle" step's fallback locator
(`page.getByRole('switch').first()`) can resolve to a switch on a
currently-hidden tab panel (e.g. "Send usage-based analytics" on Advanced
instead of "Use system theme" on General) and time out clicking it — the
Import Settings flow itself is already verified correct by hand (see above);
this is a driver-targeting issue, not a product bug. Not fixed this cycle
(pre-existing driver limitation, out of scope for the export bug).
