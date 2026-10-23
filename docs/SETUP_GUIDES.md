# The setup guides

Four step-by-step guides for new users: install the desktop app, sign in, and upload a Rekordbox or Serato library. One per combination of Mac/Windows × Rekordbox/Serato, plus a page that picks between them.

| URL | File |
| --- | --- |
| `https://www.sub-box.net/setup.html` | `src/renderer/public/setup.html` (the chooser) |
| `https://www.sub-box.net/setup/mac-rekordbox.html` (and the other three) | `src/renderer/public/setup/*.html` |
| screenshots | `src/renderer/public/setup/img/*.png` |

They are served exactly like the legal pages (`docs/LEGAL_PAGES.md`): Vite's `publicDir` copies them into `out/web/`, the `Dockerfile` bakes them into the nginx image, and `ng.conf.template`'s `try_files $uri` serves them before the SPA fallback. The PWA service worker is scoped to `/assets/`, so it never intercepts them. Link the explicit filename; a bare `/setup/` falls through to the app.

## Rules

- **Self-contained.** Inline CSS, no web fonts, no CDN. A font or script host would see every visitor's IP, and the privacy notice doesn't name one.
- **Download buttons point at `releases/latest/download/<name>`.** That only works because release assets carry no version in their names (#276). If `artifactName` in `electron-builder.yml` changes, these links break.
- **The install steps describe an unsigned app** (macOS Open Anyway, Windows SmartScreen Run anyway). Rewrite Part 1 of each guide if signing is set up.

## Editing them

These files are generated; don't hand-edit them. The tools are in `scripts/setup-guides/`:

1. `make_guide_fixture.py <dir>` (run with pymix's venv) builds a small Rekordbox XML and Serato crate library from the CC demo library, with three hot cues per track.
2. `guide-shots.mjs rekordbox|serato` drives a dev-mode build against the local dev stack as the `guide231026` user, and writes the cropped screenshots with their numbered click outlines. Reset that user's library before each run (`feishin-qa/scripts/qa/reset-library.mjs`). It needs `APP`, `FIXTURE` and `OUT`.
3. `python3 build_guides.py <dir>` (expects the screenshots in `<dir>/img/`) writes the pages. Copy `<dir>/app/` over `src/renderer/public/`.

Retake the screenshots when the Sync → Upload screens change.

As with the legal pages, a content change ships with a client release.
