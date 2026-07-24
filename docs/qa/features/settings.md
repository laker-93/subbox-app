# Settings (`/settings`)

**Verified:** 2026-07-25 (Electron desktop app, live driver
`scripts/qa/settings-journey.mjs`, account `test260526`).
**Tag:** `[mixed]` — most panes are inherited upstream Feishin; the
Export/Import settings backup control (Advanced tab) is subbox-authored.

## What it is

Five tabs (General, Playback, Hotkeys, Window, Advanced), each a
`SettingsSection` list of controls backed by the persisted `store_settings`
zustand store. The only subbox-specific control is **Import/export** on the
Advanced tab (`export-import-settings.tsx`): "Export" downloads the current
settings as `subbox-settings.json`; "Import" opens a modal, lets the user pick
a previously-exported file, shows a diff, and applies it on confirm.

## Verified behavior

**All five tabs render real content**, no blank/crashed panels: General
(6158 chars, theme/accent/artist-page/etc.), Playback (1265 chars, audio
device/player), Hotkeys (1114 chars), Window (2154 chars), Advanced (740 chars,
update/analytics/import-export). No error-like text in any panel.

**Import Settings** (verified working, unaffected by the export bug below):
flip a setting → Import → file picker → diff screen renders the incoming JSON
→ confirm → setting reverts to the imported value.

**Export Settings — bug found and fixed (issue #39).** See `bugs-archive.md`
for the full writeup. Summary: on the Electron desktop build, clicking
"Export" produced no file in `~/Downloads` while the app kept running — the
`Blob`+`URL.createObjectURL`+anchor-click pattern (correct for the web build)
never completed under Electron; the export only landed the instant the whole
app quit. Fixed by branching `onExportSettings` on `isElectron()`: the
Electron path now base64-encodes the JSON into a `data:application/json` URL
and sends it through the same already-proven main-process download pipeline
the song-download feature uses (`window.api.utils.download` → `download-url`
IPC → `webContents.downloadURL`), with a new `will-download` handler on the
window's session that names the file (a `data:` URL carries no filename of
its own, unlike a real HTTP response). The web build is untouched — still the
original blob/anchor pattern.

**Re-verified live post-fix**: export button click → real file
`~/Downloads/subbox-settings.json` appears in ~300ms while the app keeps
running (previously: absent even after 60s of polling, only appeared on app
quit) → valid JSON, correct size (~53KB), correct top-level keys.

## Driver notes

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
