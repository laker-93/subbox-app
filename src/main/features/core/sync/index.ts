import axios from 'axios';
import { app, ipcMain, session } from 'electron';
import * as tus from 'tus-js-client';
import * as fs from 'fs';
import * as https from 'https';
import { parseFile } from 'music-metadata';
import * as os from 'os';
import * as path from 'path';
import * as unzipper from 'unzipper';
import { ZipArchive } from "archiver";
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/** Lightweight playlist info sent to renderer for preview (no file paths). */
export interface PlaylistPreview {
    name: string;
    path: string[];
    trackCount: number;
}
import { extractTrackName } from '/@/main/features/core/sync/extract-track-name';
import {
    extractPlaylists,
    ParsedPlaylist,
    ParsedTrack,
} from '/@/main/features/core/sync/rekordbox-xml';

export interface UploadProgress {
    currentTrack: string;
    phase: 'done' | 'error' | 'mapping-metadata' | 'matching' | 'uploading';
    total: number;
    uploaded: number;
}

export interface UploadResult {
    skipped: number;
    uploaded: number;
}

async function getCookiesForUrl(url: string): Promise<string> {
    const cookies = await session.defaultSession.cookies.get({ url });
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
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
        function collectFromFolder(
            folder: { name: string; playlists: ParsedPlaylist[]; subfolders: any[] },
            parentPath: string[],
        ) {
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

        // Add a synthetic entry for tracks not in any playlist
        const orphanTracks = collectTracksNotInAnyPlaylist(result);
        if (orphanTracks.length > 0) {
            previews.push({ name: NOPLAYLIST_NAME, path: [], trackCount: orphanTracks.length });
        }

        return previews;
    },
);

// ── Upload selected playlists ──────────────────────────────────────────────

const NOPLAYLIST_NAME = 'NOPLAYLIST';

/**
 * Returns all tracks from the parsed XML that are not referenced by any playlist.
 */
function collectTracksNotInAnyPlaylist(
    result: ReturnType<typeof extractPlaylists>,
): ParsedTrack[] {
    const inPlaylist = new Set<string>();

    function markPlaylist(pl: ParsedPlaylist) {
        for (const t of pl.tracks) inPlaylist.add(t.location);
    }

    for (const pl of result.playlists) markPlaylist(pl);

    function walkFolders(folders: any[]) {
        for (const folder of folders) {
            for (const pl of folder.playlists) markPlaylist(pl);
            walkFolders(folder.subfolders);
        }
    }
    walkFolders(result.folders);

    return result.tracks.filter((t) => !inPlaylist.has(t.location));
}

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

    if (selectedNames.has(NOPLAYLIST_NAME)) {
        const orphanTracks = collectTracksNotInAnyPlaylist(result);
        if (orphanTracks.length > 0) {
            matched.push({ name: NOPLAYLIST_NAME, trackCount: orphanTracks.length, tracks: orphanTracks });
        }
    }

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
        const { filebrowserToken, filebrowserUrl, playlistNames, pymixUrl, username, xmlPath } =
            args;
        const pymixCookies = await getCookiesForUrl(pymixUrl);
        const result = extractPlaylists(xmlPath);
        const selectedNames = new Set(playlistNames);
        const selectedPlaylists = collectPlaylistsByName(result, selectedNames);

        // Deduplicate tracks across selected playlists
        const trackMap = new Map<string, ParsedTrack>();
        for (const pl of selectedPlaylists) {
            for (const track of pl.tracks) {
                if (!track.name || !track.artist) continue;
                const cleanName = extractTrackName(
                    track.name,
                    track.artist,
                    track.album ?? undefined,
                );
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
            fromTag: true,
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

        // Step 2.5: Check storage quota before uploading
        let totalUploadBytes = 0;
        for (const missingTrack of missingTracks) {
            const trackName = `${missingTrack.artist} - ${missingTrack.title}`;
            const track = trackKeyToTrack[trackName];
            if (track?.location && fs.existsSync(track.location)) {
                totalUploadBytes += fs.statSync(track.location).size;
            }
        }

        if (totalUploadBytes > 0) {
            const storageRes = await axios.get(`${pymixUrl}/user/storage_check`, {
                headers: { Cookie: pymixCookies },
                httpsAgent,
                params: { uploadSizeBytes: totalUploadBytes },
            });

            if (storageRes.data?.allowed === false) {
                console.log(storageRes.data)
                const maxBytes = storageRes.data?.maxStorageBytes ?? 0;
                const currentBytes = storageRes.data?.currentUsageBytes ?? 0;
                const maxMB = Math.round(maxBytes / (1024 * 1024));
                const currentMB = Math.round(currentBytes / (1024 * 1024));
                const uploadMB = Math.round(totalUploadBytes / (1024 * 1024));
                throw new Error(
                    `STORAGE_LIMIT_EXCEEDED:Your upload of ${uploadMB} MB would exceed your storage limit. ` +
                        `You are currently using ${currentMB} MB of your ${maxMB} MB allowance.`,
                );
            }
        }

        // Step 3: Zip and upload missing tracks
        sendProgress({
            currentTrack: 'Building zip...',
            phase: 'uploading',
            total: 0,
            uploaded: 0,
        });

        let uploadedCount = 0;
        let skippedCount = 0;
        const originalTrackMetaData: Array<{
            originalAlbum: null | string;
            originalArtist: null | string;
            originalName: null | string;
            stagingLocation: string;
            userLocation: string;
        }> = [];

        // Build list of tracks that can actually be uploaded
        const uploadableTracks: Array<{ stagingPath: string; track: ParsedTrack; trackName: string }> = [];
        for (const missingTrack of missingTracks) {
            const trackName = `${missingTrack.artist} - ${missingTrack.title}`;
            const track = trackKeyToTrack[trackName];

            if (!track?.location) {
                console.warn(`Track metadata missing for "${trackName}", skipping`);
                skippedCount++;
                continue;
            }

            if (!fs.existsSync(track.location)) {
                console.warn(
                    `Track file does not exist at ${track.location}, skipping "${trackName}"`,
                );
                skippedCount++;
                continue;
            }

            const stagingPath = `${track.artist}/${track.album}/${track.cleanName}${track.fileExtension}`;
            uploadableTracks.push({ stagingPath, track, trackName });

            originalTrackMetaData.push({
                originalAlbum: track.album,
                originalArtist: track.artist,
                originalName: track.name,
                stagingLocation: stagingPath,
                userLocation: track.location,
            });
        }

        if (uploadableTracks.length > 0) {
            const zipFileName = `subbox-upload-${Date.now()}.zip`;
            const zipFilePath = path.join(os.tmpdir(), zipFileName);

            await new Promise<void>((resolve, reject) => {
                const output = fs.createWriteStream(zipFilePath);
                const myArchive = new ZipArchive({ zlib: { level: 0 } });

                output.on('close', resolve);
                myArchive.on('error', reject);
                myArchive.pipe(output);

                for (const { stagingPath, track } of uploadableTracks) {
                    myArchive.file(track.location, { name: stagingPath });
                    uploadedCount++;
                }

                myArchive.finalize();
            });

            const zipResourcePath = `${filebrowserUrl}/api/tus/uploads/${zipFileName}?override=true`;
            const zipFileSize = fs.statSync(zipFilePath).size;

            // Create the TUS upload slot
            const createResp = await axios.post(zipResourcePath, null, {
                headers: {
                    'X-Auth': filebrowserToken,
                    'upload-length': zipFileSize,
                },
                httpsAgent,
            });
            if (createResp.status !== 201) {
                throw new Error(`Failed to create TUS upload: ${createResp.status}`);
            }

            try {
                await new Promise<void>((resolve, reject) => {
                    const zipStream = fs.createReadStream(zipFilePath);
                    const uploader = new tus.Upload(zipStream as unknown as Buffer, {
                        chunkSize: 20 * 1024 * 1024,
                        headers: { 'X-Auth': filebrowserToken },
                        onError: reject,
                        onProgress: (bytesUploaded, bytesTotal) => {
                            const pct = ((bytesUploaded / bytesTotal) * 100).toFixed(1);
                            sendProgress({
                                currentTrack: `${zipFileName} (${pct}%)`,
                                phase: 'uploading',
                                total: uploadableTracks.length,
                                uploaded: uploadedCount,
                            });
                        },
                        onSuccess: () => resolve(),
                        uploadSize: zipFileSize,
                        uploadUrl: zipResourcePath,
                    });
                    uploader.start();
                });
            } finally {
                try { fs.unlinkSync(zipFilePath); } catch { /* ignore */ }
            }
        }

        // Step 4: Map metadata
        sendProgress({
            currentTrack: '',
            phase: 'mapping-metadata',
            total: missingTracks.length,
            uploaded: uploadedCount,
        });

        await axios.post(
            `${pymixUrl}/sync/map_meta`,
            { tracks: originalTrackMetaData },
            { headers: { Cookie: pymixCookies }, httpsAgent, params: { username } },
        );

        sendProgress({
            currentTrack: '',
            phase: 'done',
            total: missingTracks.length,
            uploaded: uploadedCount,
        });

        return { skipped: skippedCount, uploaded: uploadedCount };
    },
);

// ── Download playlists from cloud ──────────────────────────────────────────

async function downloadFileFromFilebrowser(
    filebrowserUrl: string,
    filebrowserToken: string,
    fileName: string,
    destPath: string,
): Promise<void> {
    const url = `${filebrowserUrl}/api/raw/downloads/${fileName}`;
    const response = await axios.get(url, {
        headers: { 'X-Auth': filebrowserToken },
        httpsAgent,
        responseType: 'stream',
    });

    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);

    return new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

function getAppPath(): string {
    const userPath = app.getPath('userData');
    return path.join(path.dirname(userPath), 'subbox');
}

function getMusicPath(): string {
    return path.join(getAppPath(), 'music');
}

/**
 * Scan the local music directory and return track metadata parsed from the
 * directory structure: music/<artist>/<album>/<title>.<ext>
 */
async function scanLocalTracks(): Promise<
    Array<{ album?: string; artist: string; fromTag: boolean; title: string }>
> {
    const musicDir = getMusicPath();
    if (!fs.existsSync(musicDir)) return [];

    const tracks: Array<{ album?: string; artist: string; fromTag: boolean; title: string }> = [];

    let artistDirs: string[];
    try {
        artistDirs = fs.readdirSync(musicDir);
    } catch {
        return [];
    }

    for (const artistName of artistDirs) {
        const artistPath = path.join(musicDir, artistName);
        try {
            if (!fs.statSync(artistPath).isDirectory()) continue;
        } catch {
            continue;
        }

        let albumDirs: string[];
        try {
            albumDirs = fs.readdirSync(artistPath);
        } catch {
            continue;
        }

        for (const albumName of albumDirs) {
            const albumPath = path.join(artistPath, albumName);
            try {
                if (!fs.statSync(albumPath).isDirectory()) continue;
            } catch {
                continue;
            }

            let files: string[];
            try {
                files = fs.readdirSync(albumPath);
            } catch {
                continue;
            }

            for (const fileName of files) {
                const filePath = path.join(albumPath, fileName);
                try {
                    if (fs.statSync(filePath).isDirectory()) continue;
                } catch {
                    continue;
                }

                const ext = path.extname(fileName);
                if (
                    !['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.wma'].includes(
                        ext.toLowerCase(),
                    )
                )
                    continue;

                // Attempt to read tags from the file
                let tagArtist: string | undefined;
                let tagAlbum: string | undefined;
                let tagTitle: string | undefined;
                try {
                    const meta = await parseFile(filePath, { duration: false });
                    tagArtist = meta.common.artist;
                    tagAlbum = meta.common.album;
                    tagTitle = meta.common.title;
                } catch {
                    // tag read failed — fall back to path-derived values
                }

                const fromTag = !!(tagArtist && tagTitle);
                tracks.push({
                    album: (fromTag ? tagAlbum : albumName) ?? albumName,
                    artist: fromTag ? tagArtist! : artistName,
                    fromTag,
                    title: fromTag ? tagTitle! : path.basename(fileName, ext),
                });
            }
        }
    }

    return tracks;
}

async function unzipAndMerge(zipFilePath: string, targetDirPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        fs.createReadStream(zipFilePath)
            .pipe(unzipper.Parse())
            .on('entry', (entry: unzipper.Entry) => {
                const entryPath = entry.path;
                const type = entry.type; // 'Directory' or 'File'

                if (type === 'Directory') {
                    const dir = path.join(targetDirPath, entryPath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    entry.autodrain();
                    return;
                }

                const filePath = path.join(targetDirPath, entryPath);
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                if (fs.existsSync(filePath)) {
                    // Skip existing files
                    entry.autodrain();
                } else {
                    entry.pipe(fs.createWriteStream(filePath));
                }
            })
            .on('finish', resolve)
            .on('error', reject);
    });
}

ipcMain.handle(
    'sync:download-playlists',
    async (
        _event,
        args: {
            filebrowserToken: string;
            filebrowserUrl: string;
            includeRekordboxXml?: boolean;
            playlistIds: string[];
            pymixUrl: string;
        },
    ): Promise<{ tracksExported: number }> => {
        const { filebrowserToken, filebrowserUrl, includeRekordboxXml, playlistIds, pymixUrl } =
            args;
        const pymixCookies = await getCookiesForUrl(pymixUrl);

        // Scan local music directory for existing tracks
        const localTracks = await scanLocalTracks();

        // Step 1: Call syncPlaylists to prepare the zip on the server
        const syncResponse = await axios.post(
            `${pymixUrl}/sync/playlists`,
            {
                direction: 'download',
                localTracks,
                options: {
                    fuzzyMatch: true,
                    includeMetadata: true,
                },
                playlists: playlistIds.map((id) => ({ id, source: 'subbox' })),
            },
            { headers: { Cookie: pymixCookies }, httpsAgent, timeout: 0 },
        );

        if (!syncResponse.data.success) {
            throw new Error(`Sync failed: ${syncResponse.data.reason}`);
        }

        const { nTracksExported, zipPath } = syncResponse.data;
        const zipFileName = `${path.basename(zipPath)}.zip`;

        // Step 2: Download the zip from filebrowser
        const appPath = getAppPath();
        if (!fs.existsSync(appPath)) {
            fs.mkdirSync(appPath, { recursive: true });
        }
        const localZipPath = path.join(appPath, zipFileName);
        await downloadFileFromFilebrowser(
            filebrowserUrl,
            filebrowserToken,
            zipFileName,
            localZipPath,
        );

        // Step 3: Unzip and merge into app directory (zip contains music/ prefix)
        await unzipAndMerge(localZipPath, appPath);

        // Clean up the zip
        try {
            fs.unlinkSync(localZipPath);
        } catch {
            // ignore cleanup errors
        }

        // Step 4: Optionally export and download Rekordbox XML
        if (includeRekordboxXml) {
            const musicPath = getMusicPath();

            // Call pymix to prepare the Rekordbox XML on the server
            console.log('[Subbox] Exporting Rekordbox XML with playlistIds:', playlistIds);
            await axios.post(
                `${pymixUrl}/rekordbox/export`,
                { playlistIds, user_root: musicPath },
                { headers: { Cookie: pymixCookies }, httpsAgent, timeout: 0 },
            );

            // Download the XML from filebrowser
            const xmlDestPath = path.join(appPath, 'subbox_rb_export.xml');
            await downloadFileFromFilebrowser(
                filebrowserUrl,
                filebrowserToken,
                'subbox_rb_export.xml',
                xmlDestPath,
            );
        }

        return { tracksExported: nTracksExported };
    },
);

ipcMain.handle(
    'sync:get-local-tracks',
    async (): Promise<
        Array<{ album?: string; artist: string; fromTag: boolean; title: string }>
    > => {
        return scanLocalTracks();
    },
);

// ── Watch directory for auto-upload ────────────────────────────────────────

const AUDIO_EXTENSIONS = new Set([
    '.aac',
    '.flac',
    '.m4a',
    '.mp3',
    '.ogg',
    '.opus',
    '.wav',
    '.wma',
]);

export interface WatchProgress {
    currentFile: string;
    phase: 'error' | 'idle' | 'scanning' | 'uploading';
    total: number;
    uploaded: number;
}

let watchInterval: null | ReturnType<typeof setInterval> = null;
const uploadedFiles = new Set<string>();

function getAudioFiles(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) return [];

    const files: string[] = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...getAudioFiles(fullPath));
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (AUDIO_EXTENSIONS.has(ext)) {
                files.push(fullPath);
            }
        }
    }

    return files;
}

ipcMain.handle('sync:select-watch-directory', async (): Promise<null | string> => {
    const { dialog: electronDialog } = await import('electron');
    const result = await electronDialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Watch Directory',
    });
    return result.filePaths[0] || null;
});

ipcMain.handle(
    'sync:start-watch',
    async (
        event,
        args: {
            filebrowserToken: string;
            filebrowserUrl: string;
            pollIntervalMs?: number;
            watchDir: string;
        },
    ): Promise<void> => {
        const { filebrowserToken, filebrowserUrl, pollIntervalMs = 10000, watchDir } = args;

        // Stop any existing watcher
        if (watchInterval) {
            clearInterval(watchInterval);
            watchInterval = null;
        }

        const sendProgress = (progress: WatchProgress) => {
            event.sender.send('sync:watch-progress', progress);
        };

        const pollAndUpload = async () => {
            try {
                sendProgress({ currentFile: '', phase: 'scanning', total: 0, uploaded: 0 });

                const audioFiles = getAudioFiles(watchDir);
                const newFiles = audioFiles.filter((f) => !uploadedFiles.has(f));

                if (newFiles.length === 0) {
                    sendProgress({ currentFile: '', phase: 'idle', total: 0, uploaded: 0 });
                    return;
                }

                let uploaded = 0;
                for (const filePath of newFiles) {
                    const fileName = path.basename(filePath);
                    const resourcePath = `${filebrowserUrl}/api/resources/watch/${encodeURIComponent(fileName)}?override=false`;
                    const fileContents = fs.readFileSync(filePath);

                    sendProgress({
                        currentFile: fileName,
                        phase: 'uploading',
                        total: newFiles.length,
                        uploaded,
                    });

                    try {
                        await axios.post(resourcePath, fileContents, {
                            headers: {
                                'Content-Type': 'application/octet-stream',
                                'X-Auth': filebrowserToken,
                            },
                            httpsAgent,
                        });
                    } catch (err) {
                        if (axios.isAxiosError(err) && err.response?.status === 409) {
                            // File already exists on server, mark as uploaded
                        } else {
                            console.error(`Failed to upload ${fileName}:`, err);
                            sendProgress({
                                currentFile: fileName,
                                phase: 'error',
                                total: newFiles.length,
                                uploaded,
                            });
                            continue;
                        }
                    }

                    uploadedFiles.add(filePath);
                    uploaded++;
                }

                sendProgress({ currentFile: '', phase: 'idle', total: newFiles.length, uploaded });
            } catch (err) {
                console.error('Watch poll error:', err);
                sendProgress({ currentFile: '', phase: 'error', total: 0, uploaded: 0 });
            }
        };

        // Run immediately on start
        await pollAndUpload();

        // Then poll at interval
        watchInterval = setInterval(() => {
            pollAndUpload().catch(console.error);
        }, pollIntervalMs);
    },
);

ipcMain.handle('sync:stop-watch', async (): Promise<void> => {
    if (watchInterval) {
        clearInterval(watchInterval);
        watchInterval = null;
    }
});
