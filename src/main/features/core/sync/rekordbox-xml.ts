import { DOMParser } from '@xmldom/xmldom';
import * as fs from 'fs';
import * as path from 'path';
import * as xpath from 'xpath';

import { isFolder, isTrack, isTrackReference, Track } from './rekordbox-xml-types';

export interface ParsedFolder {
    name: string;
    playlists: ParsedPlaylist[];
    subfolders: ParsedFolder[];
}

export interface ParsedPlaylist {
    name: string;
    trackCount: number;
    tracks: ParsedTrack[];
}

export interface ParsedTrack {
    album: null | string;
    artist: null | string;
    cleanName: null | string;
    fileExtension: string;
    location: string;
    name: null | string;
    totalTime: string;
}

export interface ParsedXmlResult {
    folders: ParsedFolder[];
    playlists: ParsedPlaylist[];
    tracks: ParsedTrack[];
}

export function extractPlaylists(filePath: string): ParsedXmlResult {
    const rbxml = fs.readFileSync(filePath, 'utf8');
    const doc = new DOMParser().parseFromString(rbxml);

    const tracks = Array.from(
        xpath.select('/DJ_PLAYLISTS/COLLECTION/TRACK', doc) as Node[],
    ) as Element[];

    const tracksCache: Record<string, Track> = tracks.reduce(
        (cache, track) => {
            if (!isTrack(track)) throw new Error('Invalid track');
            const trackId = track.getAttribute('TrackID');
            if (trackId) cache[trackId] = track;
            return cache;
        },
        {} as Record<string, Track>,
    );

    const rootNodes = xpath.select("/DJ_PLAYLISTS/PLAYLISTS/NODE[@Name='ROOT']", doc);
    const root = (rootNodes && rootNodes[0]) as Element | undefined;
    if (!root || !isFolder(root)) throw new Error('Invalid root node');

    function parsePlaylist(playlist: Element): ParsedPlaylist {
        // The raw XML name, not sanitizeName's: pymix matches the selected playlists
        // against the names in the uploaded XML, so a rewritten name matches nothing and
        // the playlist is silently never created (subbox-app#142).
        const playlistName = playlist.getAttribute('Name') || '';

        const trackIds = parseNodes(xpath.select('./TRACK', playlist) as Node[], (trackRef) => {
            if (!isTrackReference(trackRef)) throw new Error('Invalid trackReference');
            return (trackRef as Element).getAttribute('Key') || '';
        });

        const playlistTracks = trackIds
            .map((id) => tracksCache[id])
            .filter((track): track is Track => !!track)
            .map(parseTrack);

        return {
            name: playlistName,
            trackCount: playlistTracks.length,
            tracks: playlistTracks,
        };
    }

    function parseFolder(folder: Element): ParsedFolder {
        const folderName = folder.getAttribute('Name') || '';

        return {
            name: folderName,
            playlists: parseNodes(
                xpath.select("./NODE[@Type='1']", folder) as Node[],
                parsePlaylist,
            ),
            subfolders: parseNodes(
                xpath.select("./NODE[@Type='0']", folder) as Node[],
                parseFolder,
            ),
        };
    }

    return {
        folders: parseNodes(xpath.select("./NODE[@Type='0']", root) as Node[], parseFolder),
        playlists: parseNodes(xpath.select("./NODE[@Type='1']", root) as Node[], parsePlaylist),
        tracks: parseNodes(tracks, parseTrack),
    };
}

export function sanitizeName(name: null | string): string {
    return (name || '').replace(/[/\\?%*:|"<>]/g, '-');
}

/**
 * Sanitize one component of a staging *path*, as opposed to a playlist/folder name.
 *
 * Everything sanitizeName strips, plus any leading dots: beets ignores hidden paths by
 * default (`ignore: ['.*', ...]` with `ignore_hidden: yes`), so an artist or album named
 * e.g. ".geom" becomes a hidden staging directory whose tracks upload perfectly, are
 * copied into the staging dir, and are then silently never imported — no beet.log entry,
 * no error, just a completion screen whose imported count is quietly short.
 *
 * Neither function is applied to playlist or folder names: those are display values
 * passed on to pymix, which matches them against the raw names in the uploaded XML, so
 * they must reach it exactly as Rekordbox wrote them (subbox-app#142).
 *
 * '_' matches the `replace: '^\.': _` rule beets applies to its own output paths, so the
 * staging tree and the library tree agree on what a dot-prefixed name becomes.
 */
export function sanitizePathSegment(
    name: null | string,
    maxBytes: number = MAX_PATH_SEGMENT_BYTES,
): string {
    return truncateUtf8(sanitizeName(name).replace(/^\.+/, '_'), maxBytes);
}

/**
 * The longest a staging path component may be, in UTF-8 bytes. Linux allows 255
 * (NAME_MAX) and pymix and filebrowser run on Linux: a ~20-artist credit came to 256
 * and the server could not create the path at all (laker-93/subbox-app#309). A
 * 90-character CJK title is 270 bytes. The margin leaves room for a suffix added
 * later, such as the `-1a2b3c4d` that tells two colliding tracks apart.
 */
export const MAX_PATH_SEGMENT_BYTES = 240;

/** A staging file name: the sanitized title, shortened so the name *with* its
 *  extension fits in {@link MAX_PATH_SEGMENT_BYTES}. */
export function stagingFileName(title: null | string, ext: string): string {
    return `${sanitizePathSegment(title, MAX_PATH_SEGMENT_BYTES - Buffer.byteLength(ext, 'utf8'))}${ext}`;
}

/**
 * Cut `text` to at most `maxBytes` UTF-8 bytes, on a code point boundary, so no
 * character is split. Only the staging file name is shortened: the track's own
 * artist/album/title still go to the server in `originalTrackMetaData`.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
    let out = '';
    let bytes = 0;
    for (const char of text) {
        const n = Buffer.byteLength(char, 'utf8');
        if (bytes + n > maxBytes) break;
        out += char;
        bytes += n;
    }
    return out.trimEnd();
}

function parseNodes<T, R>(nodes: Node[], callback: (node: T) => R): R[] {
    return Array.from(nodes as T[]).map(callback);
}

function parseTrack(track: Track): ParsedTrack {
    let location = decodeURIComponent(track.getAttribute('Location') || '');
    location = location.replace(/^file:\/\/localhost/, '');

    // Rekordbox on Windows encodes paths as file://localhost/C:/... — the leading
    // slash before the drive letter isn't part of the real path. Left in place,
    // path.resolve() treats "C:" as a literal folder under root instead of a
    // drive letter, so the file never resolves and gets skipped as "not found".
    const windowsDriveMatch = location.match(/^\/([A-Za-z]:.*)$/);
    location = windowsDriveMatch
        ? path.win32.resolve(windowsDriveMatch[1])
        : path.resolve(location);

    return {
        album: track.getAttribute('Album') || null,
        artist: track.getAttribute('Artist') || null,
        cleanName: null,
        fileExtension: path.extname(location),
        location,
        name: track.getAttribute('Name') || null,
        totalTime: track.getAttribute('TotalTime') || '',
    };
}
