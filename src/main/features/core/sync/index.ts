import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import axios from 'axios';
import { ipcMain, session } from 'electron';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function getCookiesForUrl(url: string): Promise<string> {
    const cookies = await session.defaultSession.cookies.get({ url });
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
import {
    extractPlaylists,
    ParsedPlaylist,
    ParsedTrack,
} from '/@/main/features/core/sync/rekordbox-xml';
import { extractTrackName } from '/@/main/features/core/sync/extract-track-name';

/** Lightweight playlist info sent to renderer for preview (no file paths). */
export interface PlaylistPreview {
    name: string;
    path: string[];
    trackCount: number;
}

export interface UploadProgress {
    currentTrack: string;
    phase: 'matching' | 'uploading' | 'mapping-metadata' | 'done' | 'error';
    total: number;
    uploaded: number;
}

export interface UploadResult {
    skipped: number;
    uploaded: number;
}

// ── Parse XML → return playlist previews ───────────────────────────────────

ipcMain.handle(
    'sync:parse-rekordbox-xml',
    async (_event, xmlPath: string): Promise<PlaylistPreview[]> => {
        const result = extractPlaylists(xmlPath);
        const previews: PlaylistPreview[] = [];

        // Collect top-level playlists
        for (const pl of result.playlists) {
            previews.push({ name: pl.name, path: [], trackCount: pl.trackCount });
        }

        // Recursively collect from folders
        function collectFromFolder(folder: { name: string; playlists: ParsedPlaylist[]; subfolders: any[] }, parentPath: string[]) {
            const currentPath = [...parentPath, folder.name];
            for (const pl of folder.playlists) {
                previews.push({ name: pl.name, path: currentPath, trackCount: pl.trackCount });
            }
            for (const sub of folder.subfolders) {
                collectFromFolder(sub, currentPath);
            }
        }

        for (const folder of result.folders) {
            collectFromFolder(folder, []);
        }

        return previews;
    },
);

// ── Upload selected playlists ──────────────────────────────────────────────

function collectPlaylistsByName(
    result: ReturnType<typeof extractPlaylists>,
    selectedNames: Set<string>,
): ParsedPlaylist[] {
    const matched: ParsedPlaylist[] = [];

    for (const pl of result.playlists) {
        if (selectedNames.has(pl.name)) matched.push(pl);
    }

    function walkFolders(folders: any[]) {
        for (const folder of folders) {
            for (const pl of folder.playlists) {
                if (selectedNames.has(pl.name)) matched.push(pl);
            }
            walkFolders(folder.subfolders);
        }
    }

    walkFolders(result.folders);
    return matched;
}

ipcMain.handle(
    'sync:upload-from-xml',
    async (
        event,
        args: {
            filebrowserToken: string;
            filebrowserUrl: string;
            playlistNames: string[];
            pymixUrl: string;
            username: string;
            xmlPath: string;
        },
    ): Promise<UploadResult> => {
        const { filebrowserToken, filebrowserUrl, playlistNames, pymixUrl, username, xmlPath } = args;
        const pymixCookies = await getCookiesForUrl(pymixUrl);
        const result = extractPlaylists(xmlPath);
        const selectedNames = new Set(playlistNames);
        const selectedPlaylists = collectPlaylistsByName(result, selectedNames);

        // Deduplicate tracks across selected playlists
        const trackMap = new Map<string, ParsedTrack>();
        for (const pl of selectedPlaylists) {
            for (const track of pl.tracks) {
                if (!track.name || !track.artist) continue;
                const cleanName = extractTrackName(track.name, track.artist, track.album ?? undefined);
                track.cleanName = cleanName;
                const key = `${track.artist} - ${cleanName}`;
                if (!trackMap.has(key)) {
                    trackMap.set(key, track);
                }
            }
        }

        const allTracks = Array.from(trackMap.values());
        const totalTracks = allTracks.length;

        const sendProgress = (progress: UploadProgress) => {
            event.sender.send('sync:upload-progress', progress);
        };

        // Step 1: Upload XML file to filebrowser
        const xmlFileName = path.basename(xmlPath);
        const xmlResourcePath = `${filebrowserUrl}/api/resources/uploads/${xmlFileName}?override=true`;
        const xmlContents = fs.readFileSync(xmlPath);

        await axios.post(xmlResourcePath, xmlContents, {
            headers: {
                'Content-Type': 'application/xml',
                'X-Auth': filebrowserToken,
            },
            httpsAgent,
        });

        // Step 2: Match tracks with pymix
        sendProgress({ currentTrack: '', phase: 'matching', total: totalTracks, uploaded: 0 });

        const clientTracks = allTracks.map((t) => ({
            album: t.album,
            artist: t.artist,
            fileExtension: t.fileExtension,
            title: t.cleanName,
        }));

        const matchResponse = await axios.post(
            `${pymixUrl}/sync/match_tracks`,
            { tracks: clientTracks },
            { headers: { Cookie: pymixCookies }, httpsAgent, params: { username } },
        );

        const missingTracks: Array<{ artist: string; title: string }> = [];
        for (const track of matchResponse.data.tracks) {
            if (track.matched === false) {
                missingTracks.push(track);
            }
        }

        // Build lookup from key → ParsedTrack
        const trackKeyToTrack: Record<string, ParsedTrack> = {};
        for (const track of allTracks) {
            const key = `${track.artist} - ${track.cleanName}`;
            trackKeyToTrack[key] = track;
        }

        // Step 3: Upload missing tracks
        sendProgress({ currentTrack: '', phase: 'uploading', total: missingTracks.length, uploaded: 0 });

        let uploadedCount = 0;
        let skippedCount = 0;
        const originalTrackMetaData: Array<{
            originalAlbum: string | null;
            originalArtist: string | null;
            originalName: string | null;
            stagingLocation: string;
            userLocation: string;
        }> = [];

        for (const missingTrack of missingTracks) {
            const trackName = `${missingTrack.artist} - ${missingTrack.title}`;
            const track = trackKeyToTrack[trackName];

            if (!track?.location) {
                console.warn(`Track metadata missing for "${trackName}", skipping`);
                skippedCount++;
                continue;
            }

            if (!fs.existsSync(track.location)) {
                console.warn(`Track file does not exist at ${track.location}, skipping "${trackName}"`);
                skippedCount++;
                continue;
            }

            const stagingPath = `${track.artist}/${track.album}/${track.cleanName}${track.fileExtension}`;
            const resourcePath = `${filebrowserUrl}/api/resources/uploads/${stagingPath}?override=false`;
            const fileContents = fs.readFileSync(track.location);

            sendProgress({
                currentTrack: trackName,
                phase: 'uploading',
                total: missingTracks.length,
                uploaded: uploadedCount,
            });

            let fileAlreadyExists = false;
            try {
                const resp = await axios.post(resourcePath, fileContents, {
                    headers: {
                        'Content-Type': 'audio/mpeg',
                        'X-Auth': filebrowserToken,
                    },
                    httpsAgent,
                });

                if (resp.status !== 200) {
                    throw new Error(`Failed to upload track: ${resp.status} ${resp.statusText}`);
                }

                uploadedCount++;
            } catch (err) {
                if (axios.isAxiosError(err) && err.response?.status === 409) {
                    fileAlreadyExists = true;
                } else {
                    throw err;
                }
            }

            if (!fileAlreadyExists) {
                sendProgress({
                    currentTrack: trackName,
                    phase: 'uploading',
                    total: missingTracks.length,
                    uploaded: uploadedCount,
                });
            }

            originalTrackMetaData.push({
                originalAlbum: track.album,
                originalArtist: track.artist,
                originalName: track.name,
                stagingLocation: stagingPath,
                userLocation: track.location,
            });
        }

        // Step 4: Map metadata
        sendProgress({ currentTrack: '', phase: 'mapping-metadata', total: missingTracks.length, uploaded: uploadedCount });

        await axios.post(
            `${pymixUrl}/sync/map_meta`,
            { tracks: originalTrackMetaData },
            { headers: { Cookie: pymixCookies }, httpsAgent, params: { username } },
        );

        sendProgress({ currentTrack: '', phase: 'done', total: missingTracks.length, uploaded: uploadedCount });

        return { skipped: skippedCount, uploaded: uploadedCount };
    },
);
