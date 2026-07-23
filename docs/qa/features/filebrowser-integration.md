# Filebrowser integration

Not a standalone screen — `FilebrowserController`
(`src/renderer/api/filebrowser/filebrowser-controller.ts`) is a thin client
wrapping the per-user `filebrowser` container's API (`authenticate`,
`tusUpload`, `upload`, `download`, `listUploads`), consumed internally by every
sync flow. There is no dedicated "Filebrowser" page/route in the app for a
user to browse — checked `src/renderer/features/sync/components/`: the only
sync modes are Download / External Drive / Rekordbox / Watch, none of them a
generic file-browser UI.

## Coverage, by controller method — all already verified live via other flows

- **`authenticate` (+ 401 retry-on-expiry)** — exercised (and a real bug fixed)
  in the web Sync→Download path (issue #25/PR #26, `sync.md`) and the
  Rekordbox metadata-only import path (issue #30/PR #31, `rekordbox-import.md`).
- **`tusUpload`** — exercised by both the watch-dir uploader (`watch-upload.md`)
  and the Rekordbox full track-upload path (`rekordbox-import.md`, "Full
  track-upload path" section).
- **`download`** — exercised by Sync→Download (zip, `sync.md`) and the
  External Drive tab's Rekordbox-XML reveal (`external-drive-sync.md`).
- **`upload`** (plain, non-TUS — used for the Rekordbox XML itself) —
  exercised by `sync:upload-xml` in both the metadata-only and full-upload
  Rekordbox paths (`rekordbox-import.md`).
- **`listUploads`** — used only as an auth-check ping in
  `use-fb-server-authenticated.ts`, implicitly exercised every time any of the
  above flows authenticates (i.e. every sync/watch/rekordbox journey already
  driven this far).

## Verdict

No dedicated journey to drive beyond what's already covered — checking off
this README row on the strength of the cross-references above rather than
re-deriving a new driver for infrastructure that's already exercised
end-to-end (including its one real bug class, filebrowser 401 handling, fixed
twice: #25, #30). Revisit if a standalone file-browsing UI is ever added.
