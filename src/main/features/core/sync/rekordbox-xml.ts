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
        const playlistName = sanitizeName(playlist.getAttribute('Name'));

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
        const folderName = sanitizeName(folder.getAttribute('Name'));

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
 * Kept separate from sanitizeName rather than folded into it: sanitizeName also names
 * playlists and folders, which are display values passed on to pymix and not paths, and
 * those must not be silently renamed just because they start with a dot.
 *
 * '_' matches the `replace: '^\.': _` rule beets applies to its own output paths, so the
 * staging tree and the library tree agree on what a dot-prefixed name becomes.
 */
export function sanitizePathSegment(name: null | string): string {
    return sanitizeName(name).replace(/^\.+/, '_');
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
