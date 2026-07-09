import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { randomUUID } from 'crypto';
import { app, ipcMain, session, shell } from 'electron';
import Store from 'electron-store';
import * as fs from 'fs';
import * as https from 'https';
import { parseFile } from 'music-metadata';
import * as TagLib from 'node-taglib-sharp';
import * as path from 'path';
import * as tus from 'tus-js-client';
import * as unzipper from 'unzipper';

import { getStoredPassword } from '/@/main/features/core/settings';
import { extractTrackName } from '/@/main/features/core/sync/extract-track-name';
import {
    extractPlaylists,
    ParsedPlaylist,
    ParsedTrack,
    sanitizeName,
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

interface FbAuth {
    /** The current filebrowser token (updated in place after a refresh). */
    getToken(): string;
    /**
     * Re-login via the stored password and return the new token, or null when no
     * stored password is available (e.g. the user never opted into "remember me").
     */
    refresh(): Promise<null | string>;
}

type LocalTrack = {
    album?: string;
    artist: string;
    fileExtension?: string;
    fromTag: boolean;
    subboxId?: string;
    title: string;
};

/**
 * Build a filebrowser auth helper that can silently re-login when its short-lived
 * (~2h) token expires mid-operation. The token outlives by far less than a long
 * download, so refresh it in place on a 401 instead of failing the whole flow.
 * On refresh it notifies the renderer (`sync:filebrowser-token-refreshed`) so the
 * store stays canonical. Refreshes are deduped so concurrent 401s trigger a single
 * login. Mirrors the watch poller's refresh logic.
 */
function createFbAuth(args: {
    event: Electron.IpcMainInvokeEvent;
    filebrowserUrl: string;
    initialToken: string;
    serverId?: string;
    username?: string;
}): FbAuth {
    let token = args.initialToken;
    let inFlight: null | Promise<null | string> = null;

    const refresh = (): Promise<null | string> => {
        if (!inFlight) {
            inFlight = (async () => {
                if (!args.serverId || !args.username) return null;
                const password = getStoredPassword(args.serverId);
                if (!password) return null;
                const res = await axios.post<string>(
                    `${args.filebrowserUrl}/api/login`,
                    { password, username: args.username },
                    { httpsAgent },
                );
                token = res.data;
                args.event.sender.send('sync:filebrowser-token-refreshed', token);
                return token;
            })().finally(() => {
                inFlight = null;
            });
        }
        return inFlight;
    };

    return { getToken: () => token, refresh };
}

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

            // Sanitize each path component so characters like '%' don't reach
            // filebrowser's TUS endpoint, which double-unescapes the path and 400s
            // on an invalid URL escape (e.g. album "99.9%" → ".../99.9%/..." →
            // "invalid URL escape"). sanitizeName strips the same character set
            // already used for playlist/folder names. The file extension is a
            // controlled value (path.extname) so it's left as-is. This is the same
            // value sent to /sync/map_meta below, so server-side tagging still matches.
            const stagingPath = `${sanitizeName(track.artist)}/${sanitizeName(track.album)}/${sanitizeName(track.cleanName)}${track.fileExtension}`;
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
    auth: FbAuth,
    fileName: string,
    destPath: string,
): Promise<void> {
    const url = `${filebrowserUrl}/api/raw/downloads/${fileName}`;
    const requestStream = (token: string): Promise<AxiosResponse> =>
        axios.get(url, {
            headers: { 'X-Auth': token },
            httpsAgent,
            responseType: 'stream',
        });

    let response: AxiosResponse;
    try {
        response = await requestStream(auth.getToken());
    } catch (err) {
        // The filebrowser token can expire mid-session; refresh it once and retry
        // before giving up so an expired token self-heals instead of failing.
        if (axios.isAxiosError(err) && err.response?.status === 401) {
            const token = await auth.refresh();
            if (!token) throw err;
            response = await requestStream(token);
        } else {
            throw err;
        }
    }

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
    const subboxIdCache = loadSubboxIdCache();
    let subboxIdCacheChanged = false;

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
                let fileStat: fs.Stats;
                try {
                    fileStat = fs.statSync(filePath);
                    if (fileStat.isDirectory()) continue;
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

                // SUBBOX_ID survives independently of how title/artist get resolved
                // below (filename vs tag), so resolve it once regardless of which path
                // is taken — when present, the server can match this track exactly
                // instead of falling back to fuzzy title/artist matching. Cached by
                // (path, mtime, size) so unchanged files skip the TagLib open entirely.
                const subboxIdResult = resolveSubboxId(filePath, fileStat, subboxIdCache);
                if (subboxIdResult.changed) subboxIdCacheChanged = true;
                const subboxId = subboxIdResult.subboxId ?? undefined;

                // Fast path: parse artist/title directly from the filename
                const nameWithoutExt = path.basename(fileName, ext);
                const fromFilename = parseFilename(nameWithoutExt);
                if (fromFilename) {
                    tracks.push({
                        album: albumName,
                        artist: fromFilename.artist,
                        fromTag: false,
                        subboxId,
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
                    subboxId,
                    title: fromTag ? tagTitle! : nameWithoutExt,
                });
            }
        }
    }

    if (subboxIdCacheChanged) saveSubboxIdCache(subboxIdCache);

    return tracks;
}

async function unzipAndMerge(zipFilePath: string, targetDirPath: string): Promise<string[]> {
    const newFilePaths: string[] = [];
    return new Promise<string[]>((resolve, reject) => {
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
                    newFilePaths.push(filePath);
                }
            })
            .on('finish', () => resolve(newFilePaths))
            .on('error', reject);
    });
}

ipcMain.handle(
    'sync:download-playlists',
    async (
        event,
        args: {
            filebrowserToken: string;
            filebrowserUrl: string;
            includeRekordboxXml?: boolean;
            playlistIds: string[];
            pymixUrl: string;
            rekordboxXmlDir?: string;
            serverId?: string;
            username?: string;
        },
    ): Promise<{ musicPath: string; tracksExported: number; xmlPath?: string }> => {
        const {
            filebrowserToken,
            filebrowserUrl,
            includeRekordboxXml,
            playlistIds,
            pymixUrl,
            rekordboxXmlDir,
            serverId,
            username,
        } = args;
        const pymixCookies = await getCookiesForUrl(pymixUrl);

        // Filebrowser auth that self-heals on a 401 by re-logging in with the
        // stored password — the token (~2h) can lapse before a long download.
        const fbAuth = createFbAuth({
            event,
            filebrowserUrl,
            initialToken: filebrowserToken,
            serverId,
            username,
        });

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
        await downloadFileFromFilebrowser(filebrowserUrl, fbAuth, zipFileName, localZipPath);

        // Step 3: Unzip and merge into app directory (zip contains music/ prefix)
        const newFilePaths = await unzipAndMerge(localZipPath, appPath);

        // pymix already tagged these files with SUBBOX_ID before zipping them up, so
        // read it now and cache it — the next scanLocalTracks() then recognizes these
        // tracks straight from the cache instead of reopening files we just wrote.
        cacheSubboxIdsForNewFiles(newFilePaths);

        // Clean up the zip
        try {
            fs.unlinkSync(localZipPath);
        } catch {
            // ignore cleanup errors
        }

        // Step 4: Optionally export and download Rekordbox XML
        let xmlPath: string | undefined;
        if (includeRekordboxXml) {
            const musicPath = getMusicPath();

            // Call pymix to prepare the Rekordbox XML on the server
            console.log('[Subbox] Exporting Rekordbox XML with playlistIds:', playlistIds);
            await axios.post(
                `${pymixUrl}/rekordbox/export`,
                { playlistIds, user_root: musicPath },
                { headers: { Cookie: pymixCookies }, httpsAgent, timeout: 0 },
            );

            // Download the XML from filebrowser into the user-configured directory,
            // falling back to the app directory when none has been set.
            const xmlDir =
                rekordboxXmlDir && rekordboxXmlDir.length > 0 ? rekordboxXmlDir : appPath;
            if (!fs.existsSync(xmlDir)) {
                fs.mkdirSync(xmlDir, { recursive: true });
            }
            const xmlDestPath = path.join(xmlDir, 'subbox_rb_export.xml');
            await downloadFileFromFilebrowser(
                filebrowserUrl,
                fbAuth,
                'subbox_rb_export.xml',
                xmlDestPath,
            );
            xmlPath = xmlDestPath;
        }

        return { musicPath: getMusicPath(), tracksExported: nTracksExported, xmlPath };
    },
);

ipcMain.handle('sync:get-local-tracks', async (): Promise<LocalTrack[]> => {
    return scanLocalTracks();
});

// ── Choose where downloaded Rekordbox XML is saved ─────────────────────────

ipcMain.handle('sync:select-xml-directory', async (): Promise<null | string> => {
    const { dialog: electronDialog } = await import('electron');
    const result = await electronDialog.showOpenDialog({
        buttonLabel: 'Select Folder',
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Rekordbox XML Download Folder',
    });
    return result.filePaths[0] || null;
});

/** Default directory the Rekordbox XML is saved to when the user hasn't picked one. */
ipcMain.handle('sync:get-default-xml-directory', async (): Promise<string> => {
    return getAppPath();
});

/** Open a folder in the OS file manager. */
ipcMain.handle('sync:open-folder', async (_event, folderPath: string): Promise<void> => {
    if (folderPath) await shell.openPath(folderPath);
});

/** Reveal a file in the OS file manager, highlighting it within its folder. */
ipcMain.handle('sync:reveal-file', async (_event, filePath: string): Promise<void> => {
    if (filePath) shell.showItemInFolder(filePath);
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

// MP4/M4A files store custom tags as iTunes-style freeform atoms keyed by a
// MEAN/NAME pair (the "----:<mean>:<name>" atom). This MEAN mirrors what the
// pymix backend writes via mutagen ("----:com.apple.iTunes:SUBBOX_ID"), so a
// SUBBOX_ID written by either side is readable by the other.
const APPLE_ITUNES_MEAN = 'com.apple.iTunes';

interface SubboxIdCacheEntry {
    mtimeMs: number;
    size: number;
    subboxId: string;
}

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

// ── SUBBOX_ID cache ──────────────────────────────────────────────────────────
// Reading SUBBOX_ID means opening every file with TagLib — exactly the per-file
// I/O the filename-parsing fast path in scanLocalTracks otherwise avoids. Cache
// each file's id keyed by (path, mtimeMs, size) so a later scan only reopens
// files that are new or have changed since they were last read.

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

        if (types & TagLib.TagTypes.Apple) {
            const apple = file.getTag(TagLib.TagTypes.Apple, false) as null | TagLib.Mpeg4AppleTag;
            const val = apple?.getFirstItunesString(APPLE_ITUNES_MEAN, SUBBOX_ID_FIELD);
            if (val) return val;
        }

        return null;
    } catch {
        return null;
    } finally {
        file?.dispose();
    }
}

const isDevelopment = process.env.NODE_ENV === 'development';
const subboxIdCacheStorePath = isDevelopment
    ? path.normalize(`${app.getPath('userData')}-dev`)
    : path.normalize(app.getPath('userData'));

const subboxIdCacheStore = new Store<{ entries: Record<string, SubboxIdCacheEntry> }>({
    cwd: subboxIdCacheStorePath,
    defaults: { entries: {} },
    name: 'subbox-id-cache',
});

/**
 * Record SUBBOX_IDs for files just written to disk, e.g. after a download unzips
 * new tracks. pymix always tags a track before zipping it up, so the id is already
 * sitting in the file we just wrote — reading it now means scanLocalTracks doesn't
 * need to reopen these files again on the next preview/download.
 */
function cacheSubboxIdsForNewFiles(filePaths: string[]): void {
    const audioFiles = filePaths.filter((p) => AUDIO_EXTENSIONS.has(path.extname(p).toLowerCase()));
    if (audioFiles.length === 0) return;

    const cache = loadSubboxIdCache();
    let changed = false;
    for (const filePath of audioFiles) {
        try {
            const stat = fs.statSync(filePath);
            const result = resolveSubboxId(filePath, stat, cache);
            if (result.changed) changed = true;
        } catch {
            // File vanished or unreadable — the next scan will handle it normally.
        }
    }
    if (changed) saveSubboxIdCache(cache);
}

function loadSubboxIdCache(): Record<string, SubboxIdCacheEntry> {
    return subboxIdCacheStore.get('entries');
}

/**
 * Resolve a file's SUBBOX_ID, reusing `cache` when the file's mtime/size match what
 * was cached last time, and falling back to a real TagLib read otherwise. Mutates
 * `cache` in place; callers batch entries and persist once via saveSubboxIdCache
 * after processing a whole directory/list, rather than writing to disk per file.
 */
function resolveSubboxId(
    filePath: string,
    stat: fs.Stats,
    cache: Record<string, SubboxIdCacheEntry>,
): { changed: boolean; subboxId: null | string } {
    const cached = cache[filePath];
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return { changed: false, subboxId: cached.subboxId };
    }

    const subboxId = readSubboxId(filePath);
    if (subboxId) {
        cache[filePath] = { mtimeMs: stat.mtimeMs, size: stat.size, subboxId };
        return { changed: true, subboxId };
    }

    // No tag present now, but a stale entry from before the file changed exists.
    if (cached) {
        delete cache[filePath];
        return { changed: true, subboxId: null };
    }
    return { changed: false, subboxId: null };
}

function saveSubboxIdCache(entries: Record<string, SubboxIdCacheEntry>): void {
    subboxIdCacheStore.set('entries', entries);
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
        } else if (types & TagLib.TagTypes.Apple) {
            // MP4/M4A: store as an iTunes freeform atom. ID3v2 (the fallback below)
            // cannot be attached to an MP4 container, so this branch is required —
            // without it, SUBBOX_ID silently never persists on .m4a files.
            const apple = file.getTag(TagLib.TagTypes.Apple, true) as TagLib.Mpeg4AppleTag;
            apple.setItunesStrings(APPLE_ITUNES_MEAN, SUBBOX_ID_FIELD, id);
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
            serverId: string;
            username: string;
            watchDir: string;
        },
    ): Promise<void> => {
        const {
            filebrowserToken,
            filebrowserUrl,
            pollIntervalMs = 10000,
            pymixUrl,
            serverId,
            username,
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

        // The filebrowser token (~2h) outlives by far less than this long-running
        // poller, so refresh it in place on a 401 instead of failing/logging out.
        // The password lives in the main-process safeStorage store.
        let fbToken = filebrowserToken;
        let fbRefreshInFlight: null | Promise<null | string> = null;

        const refreshFbToken = (): Promise<null | string> => {
            if (!fbRefreshInFlight) {
                fbRefreshInFlight = (async () => {
                    const password = getStoredPassword(serverId);
                    if (!password) return null;
                    const res = await axios.post<string>(
                        `${filebrowserUrl}/api/login`,
                        { password, username },
                        { httpsAgent },
                    );
                    fbToken = res.data;
                    // Keep the renderer store canonical so restarts / other sync
                    // operations start with a valid token.
                    event.sender.send('sync:filebrowser-token-refreshed', fbToken);
                    return fbToken;
                })().finally(() => {
                    fbRefreshInFlight = null;
                });
            }
            return fbRefreshInFlight;
        };

        // Filebrowser request that refreshes the token once on a 401 and retries.
        const fbRequest = async (
            config: AxiosRequestConfig,
            retried = false,
        ): Promise<AxiosResponse> => {
            try {
                return await axios.request({
                    ...config,
                    headers: { ...config.headers, 'X-Auth': fbToken },
                    httpsAgent,
                });
            } catch (err) {
                if (!retried && axios.isAxiosError(err) && err.response?.status === 401) {
                    const token = await refreshFbToken();
                    if (token) return fbRequest(config, true);
                }
                throw err;
            }
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
                        // Pass username explicitly: the session cookie can be absent
                        // here, and without it the server resolves the user as None
                        // and 500s (AssertionError: found 0 users with username None).
                        { headers: { Cookie: pymixCookies }, httpsAgent, params: { username } },
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
                        await fbRequest({
                            data: fileContents,
                            headers: { 'Content-Type': 'application/octet-stream' },
                            method: 'POST',
                            url: resourcePath,
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

                // Only a genuine, unrecoverable auth failure should log the user out.
                // Filebrowser 401s are already refreshed-and-retried by fbRequest, so a
                // 401/403 reaching here means reauth failed (no saved password / bad
                // creds). Transient errors (network, 5xx) must not log the user out.
                const status = axios.isAxiosError(err) ? err.response?.status : undefined;
                if (status === 401 || status === 403) {
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
        event,
        args: {
            filebrowserToken: string;
            filebrowserUrl: string;
            pymixUrl: string;
            serverId?: string;
            tracksToDownload: Array<{
                album?: string;
                artist: string;
                fileExtension?: string;
                fromTag: boolean;
                title: string;
            }>;
            username?: string;
        },
    ): Promise<{ tracksExported: number }> => {
        const { filebrowserToken, filebrowserUrl, pymixUrl, serverId, tracksToDownload, username } =
            args;
        const pymixCookies = await getCookiesForUrl(pymixUrl);

        // Filebrowser auth that self-heals on a 401 by re-logging in (see download-playlists).
        const fbAuth = createFbAuth({
            event,
            filebrowserUrl,
            initialToken: filebrowserToken,
            serverId,
            username,
        });

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
        await downloadFileFromFilebrowser(filebrowserUrl, fbAuth, zipFileName, localZipPath);

        // Step 3: Unzip and merge into app directory
        const newFilePaths = await unzipAndMerge(localZipPath, appPath);

        // pymix already tagged these files with SUBBOX_ID before zipping them up, so
        // read it now and cache it — the next scanLocalTracks() then recognizes these
        // tracks straight from the cache instead of reopening files we just wrote.
        cacheSubboxIdsForNewFiles(newFilePaths);

        // Clean up the zip
        try {
            fs.unlinkSync(localZipPath);
        } catch {
            // ignore cleanup errors
        }

        return { tracksExported: nTracksExported };
    },
);
