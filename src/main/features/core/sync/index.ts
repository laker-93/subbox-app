import axios from 'axios';
import { randomUUID } from 'crypto';
import { app, ipcMain, session } from 'electron';
import * as fs from 'fs';
import * as https from 'https';
import { parseFile } from 'music-metadata';
import * as TagLib from 'node-taglib-sharp';
import * as path from 'path';
import * as tus from 'tus-js-client';
import * as unzipper from 'unzipper';

import { extractTrackName } from '/@/main/features/core/sync/extract-track-name';
import {
    extractPlaylists,
    ParsedPlaylist,
    ParsedTrack,
} from '/@/main/features/core/sync/rekordbox-xml';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/** Lightweight playlist info sent to renderer for preview (no file paths). */
export interface PlaylistPreview {
    name: string;
    path: string[];
    trackCount: number;
}

export interface UploadProgress {
    activeTracks?: string[];
    currentTrack: string;
    phase: 'done' | 'error' | 'mapping-metadata' | 'matching' | 'uploading';
    total: number;
    uploaded: number;
}

export interface UploadResult {
    skipped: number;
    totalTracksInXml: number;
    uploaded: number;
}

type LocalTrack = {
    album?: string;
    artist: string;
    fileExtension?: string;
    fromTag: boolean;
    title: string;
};

async function getCookiesForUrl(url: string): Promise<string> {
    const cookies = await session.defaultSession.cookies.get({ url });
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Send a session-expired event to the renderer that triggered the IPC call.
 * The renderer's global handler will log the user out automatically.
 */
function sendSessionExpired(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): void {
    event.sender.send('sync:session-expired');
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
            matched.push({
                name: NOPLAYLIST_NAME,
                trackCount: orphanTracks.length,
                tracks: orphanTracks,
            });
        }
    }

    return matched;
}

/**
 * Returns all tracks from the parsed XML that are not referenced by any playlist.
 */
function collectTracksNotInAnyPlaylist(result: ReturnType<typeof extractPlaylists>): ParsedTrack[] {
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
        console.log(
            `[sync] XML parsed: ${totalTracks} unique tracks across ${selectedPlaylists.length} selected playlist(s)`,
        );

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
            console.log(
                `[storage-check] calculated upload size: ${totalUploadBytes} bytes (${Math.round(totalUploadBytes / (1024 * 1024))} MB) for ${missingTracks.length} missing track(s)`,
            );
            const storageRes = await axios.get(`${pymixUrl}/user/storage_check`, {
                headers: { Cookie: pymixCookies },
                httpsAgent,
                params: { uploadSizeBytes: totalUploadBytes },
            });

            console.log('[storage-check] server response:', storageRes.data);

            if (storageRes.data?.allowed === false) {
                console.log(storageRes.data);
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
        } else {
            console.log(
                `[storage-check] skipping server check — all ${missingTracks.length} missing track(s) have no local files`,
            );
        }

        // Step 3: Upload missing tracks via concurrent TUS uploads
        sendProgress({
            currentTrack: 'Checking existing uploads...',
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
        const uploadableTracks: Array<{
            stagingPath: string;
            track: ParsedTrack;
            trackName: string;
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
            // Fetch already-uploaded files from filebrowser and skip them
            let existingPaths = new Set<string>();
            try {
                const listRes = await axios.get(`${filebrowserUrl}/api/resources/uploads`, {
                    headers: { 'X-Auth': filebrowserToken },
                    httpsAgent,
                });
                const items: Array<{ path: string }> = listRes.data?.items ?? [];
                existingPaths = new Set(items.map((i) => i.path.replace(/^\//, '')));
            } catch (err) {
                console.warn('Failed to list existing uploads, proceeding without dedup:', err);
            }

            const tracksToUpload = uploadableTracks.filter(
                ({ stagingPath }) => !existingPaths.has(stagingPath),
            );
            skippedCount += uploadableTracks.length - tracksToUpload.length;

            sendProgress({
                currentTrack: '',
                phase: 'uploading',
                total: tracksToUpload.length,
                uploaded: 0,
            });

            // Upload concurrently, capped at 3 simultaneous uploads
            const CONCURRENCY = 3;
            let completedCount = 0;
            const activeUploads = new Map<string, string>();

            const emitUploadingProgress = (currentTrack = '') => {
                sendProgress({
                    activeTracks: Array.from(activeUploads.values()),
                    currentTrack,
                    phase: 'uploading',
                    total: tracksToUpload.length,
                    uploaded: completedCount,
                });
            };

            const uploadTrack = async ({
                stagingPath,
                track,
                trackName,
            }: (typeof tracksToUpload)[number]) => {
                const fileSize = fs.statSync(track.location).size;
                const resourcePath = `${filebrowserUrl}/api/tus/uploads/${encodeURIComponent(stagingPath)}?override=true`;

                const createResp = await axios.post(resourcePath, null, {
                    headers: { 'upload-length': fileSize, 'X-Auth': filebrowserToken },
                    httpsAgent,
                });
                if (createResp.status !== 201) {
                    throw new Error(
                        `Failed to create TUS upload for "${trackName}": ${createResp.status}`,
                    );
                }

                await new Promise<void>((resolve, reject) => {
                    const fileStream = fs.createReadStream(track.location);
                    const uploader = new tus.Upload(fileStream as unknown as Buffer, {
                        chunkSize: 20 * 1024 * 1024,
                        headers: { 'X-Auth': filebrowserToken },
                        // Pass a custom HTTP stack so TUS respects self-signed certs in dev
                        httpStack: new tus.DefaultHttpStack({ rejectUnauthorized: false }),
                        onError: reject,
                        onProgress: (bytesUploaded, bytesTotal) => {
                            const pct = ((bytesUploaded / bytesTotal) * 100).toFixed(1);
                            activeUploads.set(trackName, `${trackName} (${pct}%)`);
                            emitUploadingProgress();
                        },
                        onSuccess: () => resolve(),
                        uploadSize: fileSize,
                        uploadUrl: resourcePath,
                    });
                    uploader.start();
                });

                activeUploads.delete(trackName);
                completedCount++;
                uploadedCount++;
                emitUploadingProgress(trackName);
            };

            // Run with bounded concurrency
            const queue = [...tracksToUpload];
            const workers = Array.from({ length: CONCURRENCY }, async () => {
                while (queue.length > 0) {
                    const item = queue.shift()!;
                    await uploadTrack(item);
                }
            });
            await Promise.all(workers);
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

        return { skipped: skippedCount, totalTracksInXml: totalTracks, uploaded: uploadedCount };
    },
);

// ── Upload XML only (metadata, no tracks) ─────────────────────────────────

ipcMain.handle(
    'sync:upload-xml',
    async (
        _event,
        args: {
            filebrowserToken: string;
            filebrowserUrl: string;
            xmlPath: string;
        },
    ): Promise<void> => {
        const { filebrowserToken, filebrowserUrl, xmlPath } = args;
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
 * Try to extract artist and title from a filename following the convention:
 *   [tracknum -] artist - title
 * e.g. "06 - Binary Digit - Overdoze in Ibiza" → { artist: 'Binary Digit', title: 'Overdoze in Ibiza' }
 * Returns null if the filename doesn't match.
 */
function parseFilename(nameWithoutExt: string): null | { artist: string; title: string } {
    const parts = nameWithoutExt.split(' - ');
    if (parts.length < 2) return null;

    // If first segment is purely numeric treat it as a track number and skip it
    const firstIsTrackNum = /^\d+$/.test(parts[0].trim());
    if (firstIsTrackNum && parts.length < 3) return null;

    const artistIndex = firstIsTrackNum ? 1 : 0;
    return {
        artist: parts[artistIndex].trim(),
        // Rejoin the rest so titles that contain ' - ' are preserved
        title: parts
            .slice(artistIndex + 1)
            .join(' - ')
            .trim(),
    };
}

/**
 * Scan the local music directory and return track metadata parsed from the
 * directory structure: music/<artist>/<album>/<title>.<ext>
 */
async function scanLocalTracks(): Promise<LocalTrack[]> {
    const musicDir = getMusicPath();
    if (!fs.existsSync(musicDir)) return [];

    const tracks: LocalTrack[] = [];

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

                // Fast path: parse artist/title directly from the filename
                const nameWithoutExt = path.basename(fileName, ext);
                const fromFilename = parseFilename(nameWithoutExt);
                if (fromFilename) {
                    tracks.push({
                        album: albumName,
                        artist: fromFilename.artist,
                        fromTag: false,
                        title: fromFilename.title,
                    });
                    continue;
                }

                // Slow path: open file and read tags
                let tagArtist: string | undefined;
                let tagAlbum: string | undefined;
                let tagTitle: string | undefined;
                try {
                    const meta = await parseFile(filePath, {
                        duration: false,
                        skipCovers: true,
                        skipPostHeaders: true,
                    });
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
                    title: fromTag ? tagTitle! : nameWithoutExt,
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

ipcMain.handle('sync:get-local-tracks', async (): Promise<LocalTrack[]> => {
    return scanLocalTracks();
});

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
/** SUBBOX_IDs confirmed present on the server — avoids redundant presence checks. */
const knownPresentIds = new Set<string>();

// ── SUBBOX_ID tag helpers ──────────────────────────────────────────────────

const SUBBOX_ID_FIELD = 'SUBBOX_ID';

function getAudioFiles(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) return [];

    const files: string[] = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        // Skip hidden directories (e.g. .Spotlight-V100, .fseventsd) — they are
        // macOS system folders that are not readable without elevated permissions.
        if (entry.isDirectory() && entry.name.startsWith('.')) continue;

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

/**
 * Return the existing SUBBOX_ID for a file, or generate a fresh UUID.
 * Returns null if the file cannot be opened by TagLib — this indicates a partial
 * or corrupt file (e.g. a download still in progress) and it should be skipped.
 * If the file is valid but writing the tag fails, the UUID is still returned so
 * the upload can proceed.
 */
function getOrCreateSubboxId(filePath: string): null | string {
    // Validate the file is a complete, parseable audio file before proceeding.
    // TagLib throws on truncated or corrupt files, making this a reliable
    // completeness check that avoids uploading partial downloads.
    let probe: null | TagLib.File = null;
    try {
        probe = TagLib.File.createFromPath(filePath);
    } catch {
        return null;
    } finally {
        probe?.dispose();
    }

    const existing = readSubboxId(filePath);
    if (existing) return existing;

    const newId = randomUUID();
    try {
        writeSubboxId(filePath, newId);
    } catch (err) {
        console.error(`[subbox-id] Failed to write SUBBOX_ID tag to ${filePath}:`, err);
    }
    return newId;
}

/**
 * Read the SUBBOX_ID custom tag from any audio file via node-taglib-sharp.
 * Tries each tag type present on the file in priority order:
 *   Xiph (FLAC/OGG/OPUS) → ID3v2 (MP3/WAV) → APE → ASF (WMA)
 * Returns null if the tag is absent or the file cannot be opened.
 */
function readSubboxId(filePath: string): null | string {
    let file: null | TagLib.File = null;
    try {
        file = TagLib.File.createFromPath(filePath);
        const types = file.tagTypes;

        if (types & TagLib.TagTypes.Xiph) {
            const xiph = file.getTag(TagLib.TagTypes.Xiph, false) as null | TagLib.XiphComment;
            const val = xiph?.getFieldFirstValue(SUBBOX_ID_FIELD);
            if (val) return val;
        }

        if (types & TagLib.TagTypes.Id3v2) {
            const id3 = file.getTag(TagLib.TagTypes.Id3v2, false) as null | TagLib.Id3v2Tag;
            if (id3) {
                const frames = id3.getFramesByClassType<TagLib.Id3v2UserTextInformationFrame>(
                    TagLib.Id3v2FrameClassType.UserTextInformationFrame,
                );
                const frame = TagLib.Id3v2UserTextInformationFrame.findUserTextInformationFrame(
                    frames,
                    SUBBOX_ID_FIELD,
                );
                if (frame?.text[0]) return frame.text[0];
            }
        }

        if (types & TagLib.TagTypes.Ape) {
            const ape = file.getTag(TagLib.TagTypes.Ape, false) as null | TagLib.ApeTag;
            const val = ape?.getItem(SUBBOX_ID_FIELD)?.text[0];
            if (val) return val;
        }

        if (types & TagLib.TagTypes.Asf) {
            const asf = file.getTag(TagLib.TagTypes.Asf, false) as null | TagLib.AsfTag;
            const val = asf?.getDescriptorStrings(SUBBOX_ID_FIELD)[0];
            if (val) return val;
        }

        return null;
    } catch {
        return null;
    } finally {
        file?.dispose();
    }
}

/**
 * Write a SUBBOX_ID custom tag to any audio file via node-taglib-sharp.
 * Uses the tag type already present on the file (Xiph > ID3v2 > APE > ASF).
 * Throws if the file cannot be opened or saved — callers decide how to handle.
 */
function writeSubboxId(filePath: string, id: string): void {
    let file: null | TagLib.File = null;
    try {
        file = TagLib.File.createFromPath(filePath);
        const types = file.tagTypes;

        if (types & TagLib.TagTypes.Xiph) {
            const xiph = file.getTag(TagLib.TagTypes.Xiph, true) as TagLib.XiphComment;
            xiph.setFieldAsStrings(SUBBOX_ID_FIELD, id);
        } else if (types & TagLib.TagTypes.Id3v2) {
            const id3 = file.getTag(TagLib.TagTypes.Id3v2, true) as TagLib.Id3v2Tag;
            const frames = id3.getFramesByClassType<TagLib.Id3v2UserTextInformationFrame>(
                TagLib.Id3v2FrameClassType.UserTextInformationFrame,
            );
            const existing = TagLib.Id3v2UserTextInformationFrame.findUserTextInformationFrame(
                frames,
                SUBBOX_ID_FIELD,
            );
            if (existing) {
                existing.text = [id];
            } else {
                const frame = TagLib.Id3v2UserTextInformationFrame.fromDescription(SUBBOX_ID_FIELD);
                frame.text = [id];
                id3.addFrame(frame);
            }
        } else if (types & TagLib.TagTypes.Ape) {
            const ape = file.getTag(TagLib.TagTypes.Ape, true) as TagLib.ApeTag;
            ape.setItem(TagLib.ApeTagItem.fromTextValues(SUBBOX_ID_FIELD, id));
        } else if (types & TagLib.TagTypes.Asf) {
            const asf = file.getTag(TagLib.TagTypes.Asf, true) as TagLib.AsfTag;
            asf.setDescriptorStrings([id], SUBBOX_ID_FIELD);
        } else {
            // No recognised tag type — create an ID3v2 tag as the most portable option
            const id3 = file.getTag(TagLib.TagTypes.Id3v2, true) as TagLib.Id3v2Tag;
            const frame = TagLib.Id3v2UserTextInformationFrame.fromDescription(SUBBOX_ID_FIELD);
            frame.text = [id];
            id3.addFrame(frame);
        }

        file.save();
    } finally {
        file?.dispose();
    }
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
            pymixUrl: string;
            watchDir: string;
        },
    ): Promise<void> => {
        const {
            filebrowserToken,
            filebrowserUrl,
            pollIntervalMs = 10000,
            pymixUrl,
            watchDir,
        } = args;

        // Stop any existing watcher
        if (watchInterval) {
            clearInterval(watchInterval);
            watchInterval = null;
        }
        // Clear cached presence so a fresh startup check runs immediately
        knownPresentIds.clear();

        const sendProgress = (progress: WatchProgress) => {
            event.sender.send('sync:watch-progress', progress);
        };

        const pollAndUpload = async () => {
            try {
                sendProgress({ currentFile: '', phase: 'scanning', total: 0, uploaded: 0 });

                const audioFiles = getAudioFiles(watchDir);
                if (audioFiles.length === 0) {
                    sendProgress({ currentFile: '', phase: 'idle', total: 0, uploaded: 0 });
                    return;
                }

                // Step 1: Tag each file to get its SUBBOX_ID.
                // getOrCreateSubboxId returns null if TagLib cannot open the file,
                // which reliably identifies partial/corrupt files (e.g. still downloading).
                const fileIdMap = new Map<string, string>(); // filePath → subboxId
                for (const filePath of audioFiles) {
                    const id = getOrCreateSubboxId(filePath);
                    if (id !== null) fileIdMap.set(filePath, id);
                }

                const validFiles = Array.from(fileIdMap.keys());
                if (validFiles.length === 0) {
                    sendProgress({ currentFile: '', phase: 'idle', total: 0, uploaded: 0 });
                    return;
                }

                // Step 2: Only check presence for IDs not already confirmed on the server
                const uncheckedFiles = validFiles.filter(
                    (f) => !knownPresentIds.has(fileIdMap.get(f)!),
                );

                if (uncheckedFiles.length > 0) {
                    const pymixCookies = await getCookiesForUrl(pymixUrl);
                    const presenceRes = await axios.post(
                        `${pymixUrl}/tracks/presence`,
                        { subbox_ids: uncheckedFiles.map((f) => fileIdMap.get(f)!) },
                        { headers: { Cookie: pymixCookies }, httpsAgent },
                    );
                    const presence: Record<string, boolean> = presenceRes.data.presence;

                    // Cache IDs confirmed present so we skip them on future polls
                    for (const [id, isPresent] of Object.entries(presence)) {
                        if (isPresent) knownPresentIds.add(id);
                    }
                }

                const missingFiles = validFiles.filter(
                    (f) => !knownPresentIds.has(fileIdMap.get(f)!),
                );
                if (missingFiles.length === 0) {
                    sendProgress({ currentFile: '', phase: 'idle', total: 0, uploaded: 0 });
                    return;
                }

                // Step 3: Upload missing files
                let uploaded = 0;
                for (const filePath of missingFiles) {
                    const fileName = path.basename(filePath);
                    const resourcePath = `${filebrowserUrl}/api/resources/watch/${encodeURIComponent(fileName)}?override=false`;
                    const fileContents = fs.readFileSync(filePath);

                    sendProgress({
                        currentFile: fileName,
                        phase: 'uploading',
                        total: missingFiles.length,
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
                            // Already on server — count as uploaded
                        } else {
                            console.error(`Failed to upload ${fileName}:`, err);
                            sendProgress({
                                currentFile: fileName,
                                phase: 'error',
                                total: missingFiles.length,
                                uploaded,
                            });
                            continue;
                        }
                    }

                    knownPresentIds.add(fileIdMap.get(filePath)!);
                    uploaded++;
                }

                sendProgress({
                    currentFile: '',
                    phase: 'idle',
                    total: missingFiles.length,
                    uploaded,
                });
            } catch (err) {
                console.error('Watch poll error:', err);

                // Any HTTP error response from an endpoint means the session is invalid.
                // Stop polling and signal the renderer to log out.
                if (axios.isAxiosError(err) && err.response) {
                    if (watchInterval) {
                        clearInterval(watchInterval);
                        watchInterval = null;
                    }
                    knownPresentIds.clear();
                    sendSessionExpired(event);
                    return;
                }

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
    knownPresentIds.clear();
});

// ── External drive comparison ───────────────────────────────────────────────

/**
 * Recursively scan any directory for audio tracks, reading ID3/metadata tags
 * first and falling back to path-derived values when tags are unavailable.
 */
async function scanDirectoryTracks(
    rootDir: string,
): Promise<Array<{ album?: string; artist: string; fromTag: boolean; title: string }>> {
    const audioFiles = getAudioFiles(rootDir);

    const readTrack = async (
        filePath: string,
    ): Promise<{ album?: string; artist: string; fromTag: boolean; title: string }> => {
        const nameWithoutExt = path.basename(filePath, path.extname(filePath));

        // Derive path-based values (always needed as fallback)
        const rel = path.relative(rootDir, filePath);
        const parts = rel.split(path.sep);
        let pathArtist = '';
        let pathAlbum: string | undefined;
        if (parts.length >= 3) {
            pathArtist = parts[0];
            pathAlbum = parts[1];
        } else if (parts.length === 2) {
            pathArtist = parts[0];
        }

        // Fast path: parse artist/title directly from the filename
        const fromFilename = parseFilename(nameWithoutExt);
        if (fromFilename) {
            return {
                album: pathAlbum,
                artist: fromFilename.artist,
                fromTag: false,
                title: fromFilename.title,
            };
        }

        // Slow path: open file and read tags
        let tagArtist: string | undefined;
        let tagAlbum: string | undefined;
        let tagTitle: string | undefined;
        try {
            const meta = await parseFile(filePath, {
                duration: false,
                skipCovers: true,
                skipPostHeaders: true,
            });
            tagArtist = meta.common.artist;
            tagAlbum = meta.common.album;
            tagTitle = meta.common.title;
        } catch {
            // tag read failed — fall back to path-derived values
        }

        const fromTag = !!(tagArtist && tagTitle);
        return {
            album: fromTag ? tagAlbum : pathAlbum,
            artist: fromTag ? tagArtist! : pathArtist || 'Unknown',
            fromTag,
            title: fromTag ? tagTitle! : nameWithoutExt,
        };
    };

    // Process files concurrently, capped to avoid overwhelming the filesystem
    const CONCURRENCY = 20;
    const results: Array<{ album?: string; artist: string; fromTag: boolean; title: string }> =
        new Array(audioFiles.length);
    const queue = audioFiles.map((f, i) => ({ filePath: f, index: i }));

    await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
            while (queue.length > 0) {
                const item = queue.shift()!;
                results[item.index] = await readTrack(item.filePath);
            }
        }),
    );

    return results;
}

ipcMain.handle('sync:select-external-drive', async (): Promise<null | string> => {
    const { dialog: electronDialog } = await import('electron');
    const result = await electronDialog.showOpenDialog({
        buttonLabel: 'Select Folder',
        properties: ['openDirectory'],
        title: 'Select External Drive or Folder',
    });
    return result.filePaths[0] || null;
});

ipcMain.handle(
    'sync:scan-external-drive',
    async (
        _event,
        dirPath: string,
    ): Promise<
        Array<{
            album?: string;
            artist: string;
            fileExtension?: string;
            fromTag: boolean;
            title: string;
        }>
    > => {
        return scanDirectoryTracks(dirPath);
    },
);

ipcMain.handle(
    'sync:download-missing-tracks',
    async (
        _event,
        args: {
            filebrowserToken: string;
            filebrowserUrl: string;
            pymixUrl: string;
            tracksToDownload: Array<{
                album?: string;
                artist: string;
                fileExtension?: string;
                fromTag: boolean;
                title: string;
            }>;
        },
    ): Promise<{ tracksExported: number }> => {
        const { filebrowserToken, filebrowserUrl, pymixUrl, tracksToDownload } = args;
        const pymixCookies = await getCookiesForUrl(pymixUrl);

        // Step 1: Call sync/tracks to prepare the zip on the server
        const syncResponse = await axios.post(
            `${pymixUrl}/sync/tracks`,
            { tracksToDownload },
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

        // Step 3: Unzip and merge into app directory
        await unzipAndMerge(localZipPath, appPath);

        // Clean up the zip
        try {
            fs.unlinkSync(localZipPath);
        } catch {
            // ignore cleanup errors
        }

        return { tracksExported: nTracksExported };
    },
);
