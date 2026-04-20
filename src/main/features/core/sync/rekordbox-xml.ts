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

function parseNodes<T, R>(nodes: Node[], callback: (node: T) => R): R[] {
    return Array.from(nodes as T[]).map(callback);
}

function parseTrack(track: Track): ParsedTrack {
    let location = decodeURIComponent(track.getAttribute('Location') || '');
    location = location.replace(/^file:\/\/localhost/, '');
    location = path.resolve(location);

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

function sanitizeName(name: null | string): string {
    return (name || '').replace(/[/\\?%*:|"<>]/g, '-');
}
