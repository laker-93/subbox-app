import * as path from 'node:path';

/**
 * Where a single entry from pymix's export zip should be written on disk.
 *
 * Split out from unzipAndMerge so it can be exercised without booting Electron
 * (see scripts/check-export-zip-extraction.ts) — the routing is the part that has
 * to survive pymix changing the zip's layout.
 *
 * The layout: every track sits under `music/`, and the Rekordbox XML now sits
 * under `music/` too, so the zip has exactly ONE top-level entry. It used to sit
 * at the zip root alongside `music/`, which made two — and macOS' Archive Utility
 * wraps a multi-entry archive in a folder named after it, so a web user who
 * extracted music.zip got `<extract>/music/music/<artist>/...` while the XML said
 * `<extract>/<artist>/...` and Rekordbox resolved nothing.
 *
 * `extractTo` re-routes named entries to an absolute destination of their own —
 * that's the XML, which belongs in the user's chosen XML folder rather than the
 * music tree. Keys match on full entry path *or* basename, so a desktop client
 * keeps routing the XML correctly against a pymix on either side of that move.
 */
export function resolveExtractDestination(
    entryPath: string,
    targetDirPath: string,
    extractTo: Record<string, string>,
): { path: string; redirected: boolean } {
    // Zip entries always use forward slashes, whatever the host OS.
    const redirectedPath = extractTo[entryPath] ?? extractTo[path.posix.basename(entryPath)];
    if (redirectedPath) return { path: redirectedPath, redirected: true };
    return { path: path.join(targetDirPath, entryPath), redirected: false };
}
