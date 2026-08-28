# Sync (Rekordbox ↔ Subbox), Download side

Verified 2026-07-09 against subbox-app `claude/continuous-ux` (rebased onto
`development` @ ec1bcf4c) driving Electron directly, and pymix rebuilt from
`claude/continuous-ux` (rebased onto `main` @ 99a7ffe, image
`laker93/pymix:qa-local`) in the local dev stack. Test account `test260526`
(774 real local tracks, most already SUBBOX_ID-tagged from prior real usage).

> **⚠️ THE OLDEST DOC IN THIS JOURNAL, AND THE SURFACE IT DESCRIBES WAS REBUILT.**
> Verified 2026-07-09; between 2026-08-04 and 08-13, while the runner was paused,
> **every file under `src/renderer/features/sync/` changed** and the app went from
> 1.10.16 to 1.10.23. The `test260526` account it was verified against no longer
> exists either (see `README.md`). Everything below is the 07-09 behaviour; the
> section that follows is a source-read of what moved. **2026-08-14: the desktop
> half is now driven and verified — see "Desktop tick-boxes, re-verified
> 2026-08-14" below. 2026-08-17: the web manifest view (`#102`/`#103`) and the
> sub-768px mobile breakpoint (`#81`) are now also driven and verified — see
> "Web manifest view" and "Mobile breakpoint" below.** All three sub-steps of
> the rebuild are now live-verified; nothing left source-read-only on this row.
>
> ### What changed (source-read 2026-08-13, needs driving)
>
> - **One download, tick-boxes choose its contents (#101).** The web client's
>   Download used to save `music.zip` and *silently lose* the Rekordbox XML —
>   nothing failed, pymix served it 200 and the browser discarded it, because
>   Chrome allows one download per user gesture and needs the per-origin
>   "Automatic downloads" permission for a second. There is now only ever one
>   download, with "Include tracks" / "Include Rekordbox XML" choosing what's in
>   it (paired with pymix #118 — a metadata-only export is XML-only, no zip).
> - **Web `user_root` now gets a `music` segment appended (#102).** The zip nests
>   tracks under `music/`, so the folder the user typed was one level too shallow
>   and every XML `Location` linked nothing. Desktop was never affected (it sends
>   `appPath/music` and unzips into `appPath`). The resolved path is now echoed
>   back to the user, because a wrapper folder added by their unzipper (Windows'
>   Extract All always adds one) is otherwise invisible until Rekordbox fails.
>   The XML is also routed out of the zip **by basename as well as full path**.
> - **Web and desktop previews now differ (#103).** The web build has no
>   filesystem access, so it sends `/sync/plan` an empty `localTracks` — which
>   pins the classification: `existing` always empty, `tracksAlreadyPresent`
>   always 0, `missing` always everything. Web therefore no longer renders a diff
>   at all; it shows a manifest (playlist/track counts + download size). **Desktop
>   keeps the full diff UI described below.** Also fixed a metadata-tab crash.
> - **Rekordbox import shows real phases (#79).** The progress screen derived
>   everything from a percentage that saturated the moment the last audio file
>   landed, while two more passes still ran — a 100-track prod import sat at
>   "95/95 (100%)" for ~13 more minutes, indistinguishable from a hang. It now
>   shows the phase name and that phase's own n/total (pymix #51). All three
>   fields are optional, so it degrades cleanly against an older pymix.
> - **Sync is reachable on mobile (#81).** Below the 768px breakpoint the entire
>   Upload/Download/Watch/External Drive surface was silently unreachable with no
>   URL escape hatch (`appMode` is zustand state, not a route). `ModeToggle` was
>   extracted to `features/sync/components/mode-toggle` and is rendered in
>   `MobileLayout`'s header; switching to Sync on mobile now shows
>   `MobileSyncPlaceholder` instead of the mode vanishing. **New coverage: drive
>   this at a viewport under 768px** — it has never been exercised.
> - **Watch poller re-entrancy guard (#88)** — see `features/watch-upload.md`.
> - **Hidden-staging-dir fix (#82).** A Rekordbox track whose album or artist
>   starts with a dot uploaded fine, reached beets staging, and was never
>   imported (beets ignores hidden paths), reporting 97-of-99 under a green tick
>   with no error. `sanitizePathSegment` now strips leading dots for staging path
>   components. A good edge case to re-probe.

## The sync-ui substrate drivers, driven live 2026-08-28

Every driver the substrate work touched, run against the local dev stack on the day
it was written — so the locator rewrite above is a verification, not just a
compile-clean edit.

**Setup.** Client under test is the *working tree* of `serato/sync-ui-substrate` in
`../feishin`, not this worktree: `pnpm exec electron-vite build --mode development`,
then `QA_APP_ENTRY=../feishin/out/main/index.js`. The two web drivers ran against
`pnpm dev:web` (port 4343) started from that same tree. pymix was left alone
(`laker93/pymix:phase2-local`) — these are client-only changes.

> **`.env.ui-snapshot.local` named an account that no longer exists.** It still said
> `test060826`, whose rows went when the dev DB was emptied; the only user now is
> `test280826` (`navidrometest280826` / `beetstest280826`). Every client driver
> would have failed at `performLogin` — including the nightly loop's. The local env
> file has been repointed. `README.md` and the workspace's `docs/qa.md` both still
> name `test060826` in prose.

| Driver | Surface | Outcome |
|---|---|---|
| `mobile-sync-breakpoint` | web @ 400px | **PASS** — placeholder shown, no real Sync tabs leak through |
| `web-sync-manifest` | web | **PASS** — Serato disabled *and* Rekordbox pinned both asserted true; XML-only → `subbox_rb_export.xml`, tracks+XML → `music.zip` (158.6 MB) |
| `sync-download-tickboxes` | Electron | **PASS** — Format and Include both present, Serato selectable on desktop, both download legs `done` |
| `rekordbox-preview-dedup-check` | Electron | **PASS** — 1 playlist / 14 tracks |
| `rekordbox-metadata-import` | Electron | **PASS** — "Everything is already up to date" |
| `rekordbox-metaonly-progress` | Electron | **PASS** — progress screen seen (not skipped straight to done), 3.7s |
| `rekordbox-full-upload` | Electron | **PASS** — 20 in XML, 20 uploaded, 20 imported |
| `rekordbox-import-phase-progress` | Electron | **green but under-exercised** — see below |
| `serato-roundtrip` | Electron, all 5 phases | **19 pass / 1 fail**, the failure being issue #117 |

`external-drive-rekordbox-xml` was not run: External Drive keeps its checkbox until
step 4 of the design, so nothing in it changed.

**The `serato-roundtrip` failure is #117, not a regression.** "The written crates
have the same tree as the fixture" got `["Subbox QA / Cues", "Subbox QA / Nested /
Deep"]` and wanted `"Subbox QA"` as well — the parent-crate clobber already recorded
in `bugs.md` and filed as subbox-app#117. Every other assertion passed, including
both directions of the conversion and all 32 cues. Notably the four phases that
reach Upload or Download all drove the new controls end to end.

**`rekordbox-import-phase-progress` proves less than it looks.** Its fixture is
generated by `make_test_rekordbox_xml.py`, which draws track names from a fixed pool,
so the second 20-track fixture collided with the first and only 5 tracks were new.
The import finished in 3.8s with a single progress sample, which is not enough to
observe the phase-by-phase reporting the driver exists to check. It passed its own
assertions; treat multi-phase progress as **still resting on the 2026-08-14 run**
until a fixture with genuinely distinct names is used.

**Incidental confirmation of the client change.** Every Electron driver's captured
screen text reads `Library Sync Upload Download Watch External Drive` — one Upload
tab, four sync tabs, which is design step 3 landing.

**One driver bug fixed while here.** `sync-download-tickboxes`'s summary block
reported `"includeDefault": {}` — `checkedSegment` returns the matched `RegExp`, and
`JSON.stringify` renders a RegExp as an empty object. The summary is what gets quoted
into this journal, so it is now `String(includeDefault)`.

## Desktop tick-boxes, re-verified 2026-08-14

> **Superseded by the sync-ui substrate work (`serato/sync-ui-substrate`, not yet
> merged).** The three tick-boxes below — "Include tracks", "Include Rekordbox
> XML", "Write Serato crates" — are now two segmented controls, **Format**
> (Rekordbox | Serato) and **Include** (Tracks + XML | XML only, relabelled
> Tracks + crates | Crates only under Serato). "Also write Serato crates" survives
> as a checkbox under the Rekordbox format, deliberately: it is the one way to
> feed both DJ apps in a single pass. What is recorded below still describes the
> behaviour under test, but the *controls* have moved; the findings about button
> labels, done-screen copy and files on disk all still stand.
>
> Two things changed that a driver has to know about:
> - **Format is persisted in the app store** (`libraryFormat.download`), not
>   component state, so it survives an app relaunch and leaks between driver runs.
>   Each phase must select it explicitly instead of trusting a default.
> - **Mantine's `SegmentedControl` radios are 0x0 / `opacity: 0`**, so
>   `getByRole('radio', …)` finds them and `isChecked()` reads them, but `check()`
>   times out. Drive them through `selectSegment()` in `ui-snapshot-shared.mjs`,
>   which clicks the associated `<label for=…>`. (Both verified against a repro of
>   Mantine's DOM, 2026-08-28.)
>
> `sync-download-tickboxes.mjs` (name kept so the journal's references resolve),
> `serato-roundtrip.mjs` and `web-sync-manifest.mjs` were updated for this on
> 2026-08-28, and **driven live the same day** — see "The sync-ui substrate
> drivers, driven live 2026-08-28" below for what each one actually did.
> `external-drive-rekordbox-xml.mjs` is untouched: External Drive keeps its
> checkbox until step 4 of the design.
>
> **The same branch also merged the two Upload tabs** (design step 3). "Upload
> (Rekordbox)" and "Upload (Serato)" are one **Upload** tab; the format is a
> `FormatSelect` on its first screen, persisted as `libraryFormat.upload`, and on a
> profile that has never chosen one *neither* option is preselected. Ten drivers
> located a tab by its old name and were updated on 2026-08-28 to click `Upload`
> and then select the format: `serato-roundtrip`, `rekordbox-full-upload`,
> `rekordbox-metadata-import`, `rekordbox-metaonly-progress`,
> `rekordbox-import-phase-progress`, `rekordbox-preview-dedup-check`,
> `mobile-sync-breakpoint` (locator only — it asserts the tab is *absent* at mobile
> width), plus three gitignored `_*.mjs` scratch drivers. **Also driven live**, same
> section below.
>
> One more thing moved while it was open: the Serato folder is now a single
> persisted `seratoFolder` in the app store, shared by the Serato upload flow and
> Download's crate writer. Download already remembered it (in electron
> `localSettings`, still written for backward compatibility); the upload flow never
> did. A driver that points one screen at a `_Serato_` folder now points both.

Driven live (Electron, `electron-vite build --mode development`) against
`test060826`'s "Downtempo" playlist (9 tracks — smallest real playlist on this
account; `test260526`'s fixtures no longer exist, see `README.md`). New driver
`scripts/qa/sync-download-tickboxes.mjs`. pymix **not** rebuilt/swapped — the
shared container was already serving normal `/sync/plan`/`/sync/playlists`
requests, no image change needed for a client-only regression.

- **Both tick-boxes render and default checked** ("Include tracks", "Include
  Rekordbox XML") on a fresh plan.
- **Desktop keeps the full diff** — "Missing (N)" / "Already Present (N)" /
  "Metadata Updates (N)" tabs all present (confirms #103's web/desktop split
  didn't regress desktop's own view).
- **Untick "Include tracks" → XML-only download**: button label correctly
  becomes "Download Rekordbox XML", the download completes, done-screen text
  reads "Rekordbox XML downloaded. No audio files, as requested.", and
  (confirmed on disk) no audio files land — only `subbox_rb_export.xml`.
- **Both ticked → full download**: 9 real mp3s landed in
  `subbox-dev/music/<artist>/<album>/...` (byte-identical count to the
  playlist), plus the Rekordbox XML; done screen shows both "Show Music" and
  "Show Rekordbox XML" buttons. `Promise.race`'d against the error toast per
  the driver-gotchas convention — no hang.
- **Real, verified behavior (not a bug): `includeTracks`/`includeRekordboxXml`
  are plain component state, not reset by "Start Over" (`handleBack` only
  resets `step`/`plan`/`error`/`downloadResult`).** So unticking "Include
  tracks", downloading, then clicking "Start Over" and picking a new plan
  **keeps it unticked** — confirmed live (the driver had to explicitly
  re-check the box to test the tracks+XML combo a second time; its first
  attempt at this, assuming a reset, got a `Download Rekordbox XML` button
  where it expected `Download & Extract`). Worth remembering for whoever next
  touches this screen: it's a "remember what I last asked for" behavior, which
  reads as reasonable, not broken — flagging here rather than in `bugs.md`
  since nothing was wrong, just undocumented.
- Scratch downloads (9 mp3s + XML) deleted after; `subbox-dev/music` directory
  tree left otherwise untouched.

## Web manifest view, verified 2026-08-17 (#101/#102/#103)

> **Superseded, as above.** On web the format control is additionally *pinned*:
> Serato writes crates onto a filesystem a browser cannot reach, so the option is
> rendered disabled with the reason attached, and the format is forced to
> Rekordbox regardless of what the store holds. The consequence is a real
> capability change — **"tracks with no XML" is no longer expressible on web**;
> every web download now carries the Rekordbox XML. `web-sync-manifest.mjs` now
> asserts the pin (Serato disabled, Rekordbox checked) rather than assuming it.

Driven live via `pnpm dev:web` (port 4343, the only origin in pymix's local CORS
allowlist) against `test060826`'s "Downtempo" playlist (9 tracks). New driver
`scripts/qa/web-sync-manifest.mjs` — supersedes the pre-rebuild
`web-sync-download-zip.mjs` (kept below for its still-relevant CORS/auth
context, but its own tick-box-less flow predates #101). pymix **not**
rebuilt/swapped — read-only `/sync/plan` + `/sync/playlists` calls against the
already-running shared container.

- **Manifest, not a diff**: "1 Playlist / 9 Tracks / 54.5 MB Download" badges,
  a flat "Tracks in this download" list, no Missing/Already Present/Metadata
  tabs — confirmed both by DOM query (`missing (N)` button absent) and by
  screenshot. Matches the source comment exactly (`existing` pinned empty,
  `tracksAlreadyPresent` pinned 0 on the web branch since `localTracks: []`).
- **Both tick-boxes present and default-checked**, same as desktop.
- **Web-only "folder you'll extract music.zip into" field** renders (only when
  "Include Rekordbox XML" is ticked), with the `music`-segment-preview text
  described in source once a path is typed.
- **XML-only download** (untick "Include tracks"): button label becomes
  "Download Rekordbox XML", a real Playwright `download` event fires for
  `subbox_rb_export.xml`.
- **Tracks + XML download** (re-tick, "Start Over", re-plan — needed the same
  re-select-after-remount retry loop as the desktop driver): button reads
  "Download Zip", a real `download` event fires for `music.zip`. (The zip's
  internal `music/`-nesting + XML routing was already verified server-side in
  `../pymix-qa`'s 2026-08-14 cycle; this confirms the client requests/consumes
  it correctly, not the zip bytes again.)
- **`includeTracks` persists un-ticked across "Start Over"** on web too, same
  documented (not-a-bug) behavior as desktop.
- Noted, not filed: every web run logs one console 404 for `GET /settings.js`
  — `index.html` unconditionally `<script src="settings.js">`s in the `web`
  build (real deploys generate it from `settings.js.template`; `pnpm dev:web`'s
  dev server has no such file). Cosmetic, dev-only, no functional impact
  observed (login/Sync worked identically both drivers) — not investigated
  further, same class as the already-dismissed cosmetic 502 noise elsewhere in
  this doc.

## Mobile breakpoint, verified 2026-08-17 (#81)

New driver `scripts/qa/mobile-sync-breakpoint.mjs`, Chromium at 400×800 (well
under the 768px `useIsMobile` media query) against `pnpm dev:web`. Never
exercised at any viewport width before this cycle.

- `#mobile-layout` mounts (not just a squished `DefaultLayout`).
- `ModeToggle` renders in the mobile header; switching to Sync shows
  `MobileSyncPlaceholder`'s "Sync needs a wider screen" copy + a working "Back
  to Library" button (round-tripped — clicking it correctly leaves the
  placeholder).
- Confirmed the real Sync UI (e.g. an "Upload (Rekordbox)" tab) does **not**
  leak through underneath the placeholder.

## UI path

Library/Sync segmented control (top of main content area, always rendered) →
"Sync" → tab bar: "Upload (Rekordbox)" (default tab), "Download", "Watch",
"External Drive". This doc covers **Download**.

Download tab: playlist checklist (`Select all` / `Select none` /
per-playlist checkbox rows showing name + track count) → "Preview Download"
(disabled until ≥1 playlist selected) → plan screen (counts: requested /
already present / missing / metadata updates / total download size, plus
expandable Missing / Already Present / Conflicts / Metadata Updates
sections) → "Download & Extract".

## What "Preview Download" actually does (client)

Confirmed live: clicking it triggers a **client-side local library scan**
first ("Generating sync plan..." state) — this is `scanLocalTracks()`
reading every local file, which for SUBBOX_ID purposes means opening each
file with TagLib **unless it's already in the on-disk subboxId cache**
(`electron-store`, keyed by path+mtime+size — see subbox-app #14). On a
cold cache (774 local files, first scan since this worktree/build was set
up) this took **under ~15s** end-to-end including the network round trip —
not instant, but not alarming either. A warm-cache re-run should be
noticeably faster; not yet verified (see Next steps).

Once the scan finishes, the client calls `POST /sync/plan` with the
selected playlist(s) and all 774 local tracks (each now carrying a
`subboxId` when the file had one).

## What pymix does with it (server)

Confirmed via pymix's own logs (`sync.py`), not just source reading:

- Of 774 local tracks sent, 759 carried a `subboxId` (the other 15 didn't —
  presumably never tagged). The 759 tagged ones are matched directly against
  the requested playlist's server tracks by `subbox_id` (O(1)); only the 15
  untagged ones go through the old fuzzy title/artist match.
- Result for playlist "Kodzo" (9 server tracks): 8 already present, 1
  missing, 1 metadata update — identical to what the **pre-PR fuzzy-only
  server** produced for the same request, confirming the fast path doesn't
  change the actual sync outcome, just how it gets there.
- **Logging bug found and fixed here**: pymix's `subbox_id_match_summary`
  used to log ERROR almost every time for a real library (denominator
  wasn't scoped to the requested playlist). Fixed and merged —
  [laker-93/pymix#22](https://github.com/laker-93/pymix/pull/22). Now logs
  `subbox_id_summary` (INFO, informational) and `subbox_id_divergence`
  (ERROR, only on the precise "tagged but genuinely still missing" signal).
  See `../pymix-qa/docs/qa/bugs.md` FIXED section for the full story.

## Verified safe (not a bug, checked while investigating something that looked worrying)

`unzipAndMerge()`'s cache-priming for newly-downloaded files
(`cacheSubboxIdsForNewFiles`, subbox-app #14) reads each file right after the
zip parser's `finish` event, which *could* race a per-entry write stream
that hasn't flushed yet. Traced through the code: this is self-healing even
if it does — the cache key is `(path, mtimeMs, size)`, so if a file is read
mid-write, the stat captured then won't match the file's final (fully
flushed) stat, causing a correct cache miss and re-read on the next scan.
Worst case is one wasted reopen per affected file, not incorrect data.
`readSubboxId()` also catches all errors and returns `null`, so a read of a
truly-incomplete file just means "no id yet, try again next scan," not a
crash or bad cache entry.

## Download side ("Download & Extract"), and dev/prod folder isolation

Verified live 2026-07-09 after subbox-app #15 merged (`getAppPath()` now
isolates dev's local music folder as `subbox-dev/music`, not the shared
`subbox/music` used by staging/prod on the same machine — this was itself a
real, confirmed bug, fixed separately from the SUBBOX_ID work).

- Before #15: a dev build's `scanLocalTracks()` saw the **real**
  `subbox/music` folder (808 files on this machine) regardless of
  `NODE_ENV`. After #15 + rebuild: dev correctly sees only
  `subbox-dev/music`, isolated and initially empty. "Choose XML Folder"'s
  default path updated to match.
- This made it safe to actually drive "Download & Extract" for real (before,
  doing so risked writing into the shared/real folder). Did so: "Kodzo"
  playlist, 9 requested → 8 tracks physically downloaded (163 MB) into
  `subbox-dev/music`. Confirmed the shared `subbox/music` stayed at exactly
  808 files throughout — genuine isolation, not just a config flag with no
  effect.
- subboxId cache priming for newly-downloaded files (`cacheSubboxIdsForNewFiles`)
  confirmed working: cache went from 759 → 767 entries (exactly +8), all
  under the new `subbox-dev/music` paths. A second "Preview Download"
  immediately after correctly recognized all 8 as already-present via the
  subbox_id fast path — no unnecessary re-download.
- Real-world bonus validation of pymix#22's new `subbox_id_divergence`
  signal: it correctly fired `count=1` on the second preview, for a genuine
  reason (see `bugs.md` — the playlist has a duplicate track server-side,
  each copy with its own subbox_id; only one was downloaded). Confirms the
  fix's precision isn't just theoretical.

## Cache invalidation and pruning (sub-steps 5 & 6 — both verified)

Using the 8 real files downloaded above:

- **Invalidation**: touched one file's mtime (`touch`, no content change).
  Re-ran "Preview Download" — result unchanged (still correctly
  already-present), and direct inspection of the cache JSON confirmed the
  entry's `mtimeMs` was refreshed to the new value. Proves a real re-read
  happens on mtime change rather than trusting a stale cache entry blindly.
- **Pruning**: moved one file out of `subbox-dev/music` entirely. Re-ran
  preview — correctly dropped to 7 already-present / 2 to-download, and
  direct inspection of the full cache confirmed exactly 7 entries remained
  (down from 8), all matching real files with zero stale/orphaned entries.
  The moved file's old cache entry was gone, not left dangling.

## Fuzzy fallback for untagged local tracks (sub-step 3 — verified)

Verified live 2026-07-09. Goal: confirm a local file with **no** SUBBOX_ID tag
still gets matched to its server track via the pre-existing fuzzy
(title/artist) fallback, rather than being wrongly reported missing.

Method: took the real "Oleo" (Pat Martino) file — a Kodzo-playlist track that
had been moved out of `subbox-dev/music` in the earlier pruning test — copied
it back in with its SUBBOX_ID **stripped** (`mutagen`, removed only the
`SUBBOX_ID` TXXX frame; title/artist/album left intact). Then re-ran "Preview
Download" on Kodzo.

- First attempt: the file was **silently skipped** — `scanLocalTracks` walks a
  strict `music/<artist>/<album>/<title>.<ext>` three-level layout (see
  `sync/index.ts:645`), and I'd dropped the file one level too shallow
  (`Pat Martino/oleo-untagged-qa.mp3`). `local_tracks` stayed 7. **Not a bug** —
  real downloads always land at the 3-level depth via `unzipAndMerge`; a
  manually-misplaced file being ignored is expected. Worth remembering when
  seeding scratch files by hand: put them at `artist/album/track`, not
  `artist/track`.
- After moving it to `Pat Martino/Live at Yoshi's/oleo-untagged-qa.mp3`: the
  scan picked it up — pymix logged `local_tracks=8`, `7/8 carry a subboxId`
  (the untagged one being the exception), and the untagged track went through
  the fuzzy path: `local_track_matched ... via=fuzzy ...
  Oleo/Pat Martino/"Live at Yoshi's" ... similarity=1.000`, correctly
  resolving the exact "Oleo" server track (subbox_id `f948441b`) "out of 2
  candidates". Plan result moved Oleo from missing → **already present** (9
  requested / 8 present / 1 missing).
- **Bonus corroboration of the pymix OPEN bug** (`subbox_id_divergence`
  over-fires — see `../pymix-qa/docs/qa/bugs.md`): with Oleo now present via
  fuzzy, the divergence ERROR count dropped from 2 → 1, leaving only the
  genuine "Damager (Hamdi Edit)" duplicate. This confirms directly that the
  earlier `count=2` was inflated by a **plain not-yet-downloaded** track
  (Oleo), which is normal, not "stale/duplicate" — exactly the misfire that
  bug describes.

Test file was removed afterward; `subbox-dev/music` restored to its documented
7-file state.

## Investigated, turned out to be a false lead (not a bug — don't re-chase this)

While checking the subboxId cache's on-disk location, initially suspected a
real bug: `sync/index.ts`'s module-level `subboxIdCacheStorePath` computation
runs (via `import './features'` in `main/index.ts`, hoisted before that
file's own body) *before* `main/index.ts`'s own `app.setPath('userData',
devUserDataPath)` dev-mode reassignment, so it looked like it could compute
its own "-dev" suffix against the wrong (pre-reassignment) base path.
Live-testing via the Playwright `_electron.launch` harness seemed to confirm
this: the cache landed in a generic `~/Library/Application
Support/Electron-dev/` folder rather than alongside the rest of the app's
own `subbox-dev` userData.

**Turned out to be a test-harness artifact, not a real bug.** `app.getName()`
returned the generic default `"Electron"` in that harness because
`out/main/index.js` has no adjacent `package.json` for Electron to resolve a
real app identity from (confirmed directly: `electronApp.evaluate(({app}) =>
app.getName())` → `"Electron"`, independent of `cwd` passed to
`electron.launch`). In **real** usage (`pnpm dev`, or a packaged build),
Electron resolves the app name from `package.json` (`productName: "subbox"`)
very early in its own native bootstrap, before any of the app's own JS
executes — independent of import order between `main/index.ts` and
`sync/index.ts`. So both computations converge on the same correct
`subbox-dev` path regardless of which one runs "first". Confirmed
circumstantially too: a real `~/Library/Application Support/subbox-dev`
directory already exists on this machine with genuine browser-session
artifacts (Cookies, IndexedDB) from an earlier real `pnpm dev` session.

A quick fix was drafted and even briefly verified changing nothing
observable (same result, same lack of an actual bug) — reverted rather than
shipped, since it wasn't fixing anything real. Kept
`scripts/qa/check-userdata.mjs` (prints `app.getName()`/`app.getPath('userData')`
for a bare Electron launch) as a reusable diagnostic, but note its own
limitation in its header comment so it doesn't mislead a future cycle the
same way.

## Download side, WEB build (non-Electron) — verified 2026-07-22, bug found + fixed

The web build has no filesystem access, so `handleDownload` takes a completely
separate branch in `sync-download.tsx` (`!isElectron()`): `getLocalTracks()`
always returns `[]` (every track is always "missing" — there's no local cache to
compare against), `syncPlan`/`syncPlaylists` are called with `localTracks: []`,
and the resulting zip has to be downloaded **inside the browser** rather than
via Node's filesystem.

**Environment note for testing this locally:** the docker `player` container
(`www.docker.localhost`) is a real image, but its origin is **not** in pymix's
CORS allowlist (`registration.py`) — logging in there fails on a CORS-blocked
`/user/login` before you can even reach Sync. `pnpm dev:web` (port 4343) **is**
allowlisted and is the only way to drive the web build against the local pymix
in this environment.

**Bug found (issue [#25](https://github.com/laker-93/subbox-app/issues/25)),
FIXED same cycle.** Clicking "Download Zip" (and the optional Rekordbox XML
download) always failed, for two stacked reasons:
1. filebrowser requires a custom `X-Auth` header (`filebrowser-api.ts`), which a
   plain `<a href>` click to a cross-origin URL can never carry — every request
   401'd, and since `download` is ignored cross-origin the click also navigated
   the whole SPA away to the (401) raw filebrowser URL.
2. `/sync/playlists`'s `zipPath` response field omits the `.zip` extension
   (confirmed live: real file on disk is `music.zip`, `zipPath` was
   `.../downloads/music`) — Electron's main-process path already knew to append
   `.zip` itself; the web branch didn't, so it would still 404 even with auth
   fixed.

**Fix.** Added `downloadFileFromFilebrowser()` in `sync-download.tsx`, using the
already-existing-but-previously-unused `FilebrowserController.download`
(`fbApiClient` with `X-Auth` + `responseType: 'blob'`), then triggers the save
from a same-origin `URL.createObjectURL` blob instead of a raw cross-origin
href. Both the zip and XML downloads route through it; the zip filename is
corrected to `${basename}.zip`.

**Verified live** via `scripts/qa/web-sync-download-zip.mjs` (Chromium
Playwright against `pnpm dev:web`, account `test260526`, playlist "Dance Mix" —
3 tracks, kept small on purpose): before the fix, `GET
.../api/raw/downloads/music -> 401`; after, `GET
.../api/raw/downloads/music.zip -> 200` and `.../subbox_rb_export.xml -> 200`,
a genuine Playwright `download` event fired (`music.zip`), and the app stayed
mounted (no stray top-level navigation to the filebrowser origin).

## Not yet verified (next steps for a future cycle)

- Warm-cache re-scan timing (does the second scan actually skip TagLib
  reads for unchanged files, and is it meaningfully faster).
- yt-dlp cookie auth (bundled in pymix #21, unrelated to sync) — not tested
  this cycle; local dev has no cookies file mounted, confirmed it degrades
  gracefully (`ytdlp_support.py` warning logged at startup, no crash) but
  the actual cookie-auth path itself needs prod-like conditions to test.
  Split out into its own directive (see `directives.md`) since it's
  unrelated to sync matching.

(Previously listed here but since resolved: `sync/playlists` "Download &
Extract" is now driven end-to-end — see the "Download side" section above; the
first-click 400 is root-caused as working-as-designed — see `ux-notes.md`
RESOLVED; fuzzy fallback for untagged locals is verified — see the sub-step 3
section above.)
