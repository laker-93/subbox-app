# The setup guides

Six step-by-step guides for new users: install the desktop app, sign in, and upload music. One per combination of Mac/Windows × starting point, plus a page that picks between them and an overview of Sub-box's main features. The starting points are a **quick start**, dragging a few tracks onto the Sync → Watch dropzone (no DJ software needed; it also covers watching a folder, as an optional extra), **Rekordbox** and **Serato**. The chooser puts the quick-start guides first, so nobody has to have a DJ library to hand before they can try Sub-box.

| URL | File |
| --- | --- |
| `https://www.sub-box.net/setup.html` | `src/renderer/public/setup.html` (the chooser) |
| `https://www.sub-box.net/overview.html` | `src/renderer/public/overview.html` (what Sub-box does, for invite emails to link to) |
| `https://www.sub-box.net/setup/mac-quick-start.html` (and the other five) | `src/renderer/public/setup/*.html` |
| screenshots | `src/renderer/public/setup/img/*.png` |

They are served exactly like the legal pages (`docs/LEGAL_PAGES.md`): Vite's `publicDir` copies them into `out/web/`, the `Dockerfile` bakes them into the nginx image, and `ng.conf.template`'s `try_files $uri` serves them before the SPA fallback. The PWA service worker is scoped to `/assets/`, so it never intercepts them. Link the explicit filename; a bare `/setup/` falls through to the app.

## Rules

- **Self-contained.** Inline CSS, no web fonts, no CDN. A font or script host would see every visitor's IP, and the privacy notice doesn't name one.
- **Download buttons point at `releases/latest/download/<name>`.** That only works because release assets carry no version in their names (#276). If `artifactName` in `electron-builder.yml` changes, these links break.
- **The install steps describe an unsigned app** (macOS Open Anyway, Windows SmartScreen Run anyway). Rewrite Part 1 of each guide if signing is set up.

## Editing them

These files are generated; don't hand-edit them. The tools are in `scripts/setup-guides/`:

1. `make_guide_fixture.py <dir>` (run with pymix's venv) builds a small Rekordbox XML and Serato crate library from the CC demo library, with three hot cues per track, plus a plain folder of eight other tracks for the quick-start guides (four are dropped, the folder is shown ready to watch). Rebuild it before every run: an upload writes a SUBBOX_ID tag into the files.
2. `guide-shots.mjs rekordbox|serato|quick-start` drives a dev-mode build against the local dev stack as the `guide231026` user, and writes the cropped screenshots with their numbered click outlines. Reset that user's library before each run (`feishin-qa/scripts/qa/reset-library.mjs`). It needs `APP`, `FIXTURE` and `OUT`.
3. `python3 build_guides.py <dir>` (expects the screenshots in `<dir>/img/`) writes the pages. Copy `<dir>/app/` over `src/renderer/public/`.

Retake the screenshots when the Sync → Upload or Sync → Watch screens (dropzone included) change. `rb-export.png` is the one exception: it is Rekordbox's own File menu, taken by hand, and the script doesn't make it.

Edit `build_guides.py`, not the HTML. A hand edit to the pages is lost at the next rebuild.

As with the legal pages, a content change ships with a client release.
