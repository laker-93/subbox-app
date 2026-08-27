import axios from 'axios';
import { ipcMain } from 'electron';
import * as fs from 'fs';
import { parseFile } from 'music-metadata';
import * as os from 'os';
import * as path from 'path';
import * as tus from 'tus-js-client';

import { getMusicPath } from '/@/main/features/core/sync';
import {
    createFbAuth,
    createPymixAuth,
    FbAuth,
    fbRequest,
    httpsAgent,
    withPymixAuth,
} from '/@/main/features/core/sync/pymix-auth';
import { sanitizePathSegment } from '/@/main/features/core/sync/rekordbox-xml';
import {
    CRATE_ZIP_FILENAME,
    CratePreview,
    CrateToWrite,
    DEFAULT_SERATO_FOLDER,
    nodeKey,
    readCrateTree,
    readTrackCues,
    resolveSeratoFolder,
    SeratoCueWire,
    writeCrates,
    WriteCratesResult,
    WriteCuesResult,
    writeTrackCues,
} from '/@/main/features/core/sync/serato-crates';
import { getOrCreateSubboxId } from '/@/main/features/core/sync/subbox-id-tags';
import { writeFlatZip } from '/@/main/features/core/sync/write-zip';

// ── Serato import ───────────────────────────────────────────────────────────
//
// The Serato counterpart to the Rekordbox flow in ./index.ts. It differs from
// that flow in one way that shapes everything else: a Rekordbox XML carries the
// track's tags, so the server can match a track by title/artist, but a `.crate`
// file stores an absolute path on this machine and *nothing else*. pymix never
// sees the user's files, so the path is the only key it gets — and a path is not
// an identity, because Serato users move and rename their music.
//
// So identity is resolved here, where the files actually are: read SUBBOX_ID off
// each local file and send pymix a path → subbox_id manifest alongside the
// crates (`track_identities` on POST /serato/import). See pymix's
// `SeratoCrateOrchestrator._resolve_subbox_id` for the server half.

/** pymix's /tracks/presence rejects a batch larger than this. */
const PRESENCE_CHUNK_SIZE = 1000;

/** Simultaneous TUS uploads, matching the Rekordbox flow. */
const UPLOAD_CONCURRENCY = 3;

export interface SeratoUploadProgress {
    activeTracks?: string[];
    currentTrack: string;
    phase: 'checking' | 'done' | 'error' | 'identifying' | 'mapping-metadata' | 'uploading';
    total: number;
    uploaded: number;
}

export interface SeratoUploadResult {
    /** Crate entries that can never be imported, with the reason. A Serato library
     *  routinely points at records the user has since moved or deleted, so this is
     *  an expected outcome rather than a failure — but it changes what lands, so it
     *  is named rather than folded into a smaller number. */
    dropped: Array<{ reason: string; trackName: string }>;
    /** Uploads that failed server-side, per track, rather than being skipped for a
     *  known local reason. */
    failed: Array<{ reason: string; trackName: string }>;
    /** Tracks already in the library, or deliberately not uploaded. */
    skipped: number;
    totalTracksInCrates: number;
    /** The manifest to send as `track_identities` on POST /serato/import. */
    trackIdentities: Array<{ crate_path: string; cues?: SeratoCueWire[]; subbox_id: string }>;
    uploaded: number;
}

/** Best name for a track we can only refer to by its path — its filename. */
function describeCrateTrack(trackPath: string): string {
    return path.basename(trackPath);
}

/** A crate's identity for selection: its full ancestry, as pymix names the playlist. */

ipcMain.handle('sync:get-default-serato-folder', async (): Promise<null | string> => {
    return fs.existsSync(path.join(DEFAULT_SERATO_FOLDER, 'SubCrates'))
        ? DEFAULT_SERATO_FOLDER
        : null;
});

ipcMain.handle('sync:select-serato-folder', async (): Promise<null | string> => {
    const { dialog: electronDialog } = await import('electron');
    const result = await electronDialog.showOpenDialog({
        defaultPath: fs.existsSync(DEFAULT_SERATO_FOLDER) ? DEFAULT_SERATO_FOLDER : undefined,
        properties: ['openDirectory'],
        title: 'Select your _Serato_ folder',
    });
    const picked = result.filePaths[0];
    if (!picked) return null;

    const resolved = resolveSeratoFolder(picked);
    if (!resolved) {
        throw new Error(
            `${path.basename(picked)} has no SubCrates folder in it. Pick the _Serato_ ` +
                `folder itself — it is normally in your Music folder.`,
        );
    }
    return resolved;
});

ipcMain.handle(
    'sync:parse-serato-crates',
    async (_event, seratoFolder: string): Promise<CratePreview[]> => {
        return readCrateTree(seratoFolder).map((node) => ({
            files: node.files,
            name: node.components[node.components.length - 1],
            path: node.components.slice(0, -1),
            trackCount: node.tracks.length,
            trackKeys: node.tracks,
        }));
    },
);

ipcMain.handle(
    'sync:upload-from-crates',
    async (
        event,
        args: {
            /** Ancestry of each crate the user ticked, as `[...preview.path, preview.name]`. */
            crateKeys: string[][];
            /** Send the crates and the manifest, but upload no audio. */
            cratesOnly?: boolean;
            filebrowserToken: string;
            filebrowserUrl: string;
            pymixUrl: string;
            seratoFolder: string;
            serverId?: string;
            username: string;
        },
    ): Promise<SeratoUploadResult> => {
        const {
            crateKeys,
            cratesOnly = false,
            filebrowserToken,
            filebrowserUrl,
            pymixUrl,
            seratoFolder,
            serverId,
            username,
        } = args;

        const pymixAuth = createPymixAuth({ pymixUrl, serverId, username });
        const fbAuth: FbAuth = createFbAuth({
            event,
            filebrowserUrl,
            initialToken: filebrowserToken,
            serverId,
            username,
        });

        const sendProgress = (progress: SeratoUploadProgress) => {
            event.sender.send('sync:serato-progress', progress);
        };

        const selected = new Set(crateKeys.map((components) => nodeKey(components)));
        const nodes = readCrateTree(seratoFolder).filter((n) =>
            selected.has(nodeKey(n.components)),
        );
        if (nodes.length === 0) {
            throw new Error('none of the selected crates could be read from your Serato library');
        }

        // Step 1: the crates themselves. Flat at the zip root, which is the only
        // layout pymix's parse can see — see write-zip.ts.
        const subcrates = path.join(seratoFolder, 'SubCrates');
        const crateFiles = Array.from(new Set(nodes.flatMap((n) => n.files))).sort();
        const zipPath = path.join(os.tmpdir(), CRATE_ZIP_FILENAME);
        writeFlatZip(
            zipPath,
            crateFiles.map((name) => ({
                data: fs.readFileSync(path.join(subcrates, name)),
                modified: fs.statSync(path.join(subcrates, name)).mtime,
                name,
            })),
        );

        await fbRequest(fbAuth, {
            data: fs.readFileSync(zipPath),
            headers: { 'Content-Type': 'application/zip' },
            method: 'post',
            url: `${filebrowserUrl}/api/resources/uploads/${CRATE_ZIP_FILENAME}?override=true`,
        });
        fs.rmSync(zipPath, { force: true });
        console.log(
            `[serato] uploaded ${CRATE_ZIP_FILENAME} with ${crateFiles.length} crate file(s) ` +
                `covering ${nodes.length} playlist(s)`,
        );

        // Step 2: resolve every crate entry to a subbox_id, reading the tag off the
        // local file (and writing one if it has none). This is the manifest — without
        // it pymix has only the path, which does not survive the user moving a file.
        const allTrackPaths = Array.from(new Set(nodes.flatMap((n) => n.tracks)));
        sendProgress({
            currentTrack: '',
            phase: 'identifying',
            total: allTrackPaths.length,
            uploaded: 0,
        });

        const dropped: Array<{ reason: string; trackName: string }> = [];
        const trackIdentities: Array<{
            crate_path: string;
            cues?: SeratoCueWire[];
            subbox_id: string;
        }> = [];
        /** subbox_id → absolute local path, for the upload pass below. */
        const pathById = new Map<string, string>();

        for (const [index, trackPath] of allTrackPaths.entries()) {
            // Reading (and where needed writing) a tag opens every file in the
            // selection, which on a real library is thousands of them. Report as we
            // go: a phase that says nothing until it finishes is indistinguishable
            // from one that has hung (laker-93/subbox-app#83).
            if (index % 25 === 0) {
                sendProgress({
                    currentTrack: describeCrateTrack(trackPath),
                    phase: 'identifying',
                    total: allTrackPaths.length,
                    uploaded: index,
                });
            }

            if (!fs.existsSync(trackPath)) {
                // The commonest state of a real Serato library: crates outlive the
                // files they point at.
                dropped.push({
                    reason: 'file is not on this computer any more',
                    trackName: describeCrateTrack(trackPath),
                });
                continue;
            }
            const subboxId = getOrCreateSubboxId(trackPath);
            if (!subboxId) {
                dropped.push({
                    reason: 'tags could not be read, so it cannot be identified',
                    trackName: describeCrateTrack(trackPath),
                });
                continue;
            }
            // The cues, read off the file the user is actually cueing. pymix can
            // only read its own copy, which is frozen at whatever was uploaded, so
            // for a track the library already has, every cue set in Serato since is
            // invisible to it. null means this file can't carry cues (not an MP3,
            // or unreadable) and pymix should fall back to its own copy; an empty
            // array means it can and there are none.
            const cues = readTrackCues(trackPath);

            // pymix keys the manifest on the path as stored in the crate, which is
            // exactly what tserato handed us. Two crate entries can share an id --
            // the same track filed under two paths -- and both belong in the
            // manifest, because both crates need the playlist entry.
            trackIdentities.push({
                crate_path: trackPath,
                subbox_id: subboxId,
                ...(cues === null ? {} : { cues }),
            });
            const alreadySeen = pathById.get(subboxId);
            if (alreadySeen && alreadySeen !== trackPath) {
                console.log(
                    `[serato] ${describeCrateTrack(trackPath)} is the same track as ` +
                        `${describeCrateTrack(alreadySeen)}; uploading it once`,
                );
            }
            pathById.set(subboxId, trackPath);
        }

        if (dropped.length > 0) {
            console.warn(`[serato] ${dropped.length} crate entry/entries left out:`);
            for (const { reason, trackName } of dropped) {
                console.warn(`[serato]   ${trackName} — ${reason}`);
            }
        }

        const result: SeratoUploadResult = {
            dropped,
            failed: [],
            skipped: 0,
            totalTracksInCrates: allTrackPaths.length,
            trackIdentities,
            uploaded: 0,
        };

        if (cratesOnly || trackIdentities.length === 0) {
            console.log(
                `[serato] ${trackIdentities.length} crate entries identified` +
                    `${cratesOnly ? ', uploading no audio (playlists only)' : ''}`,
            );
            sendProgress({ currentTrack: '', phase: 'done', total: 0, uploaded: 0 });
            return result;
        }

        // Step 3: which of them the library already has. Keyed on subbox_id, so a
        // track that is present under a different name still counts as present —
        // the whole point of having an identity rather than a path.
        sendProgress({
            currentTrack: '',
            phase: 'checking',
            total: trackIdentities.length,
            uploaded: 0,
        });

        const present = new Set<string>();
        const ids = Array.from(pathById.keys());
        for (let i = 0; i < ids.length; i += PRESENCE_CHUNK_SIZE) {
            const chunk = ids.slice(i, i + PRESENCE_CHUNK_SIZE);
            const res = await withPymixAuth<{ presence: Record<string, boolean> }>(
                pymixAuth,
                (cookie) =>
                    axios.post(
                        `${pymixUrl}/tracks/presence`,
                        { subbox_ids: chunk },
                        { headers: { Cookie: cookie }, httpsAgent },
                    ),
            );
            for (const [id, isPresent] of Object.entries(res.data.presence)) {
                if (isPresent) present.add(id);
            }
        }

        const missingIds = ids.filter((id) => !present.has(id));
        result.skipped = ids.length - missingIds.length;
        console.log(
            `[serato] ${ids.length} identified track(s): ${present.size} already in the library, ` +
                `${missingIds.length} to upload`,
        );

        if (missingIds.length === 0) {
            sendProgress({ currentTrack: '', phase: 'done', total: 0, uploaded: 0 });
            return result;
        }

        // Step 4: where each missing track will land on the server. Same
        // artist/album/title layout the Rekordbox flow stages into, read from the
        // file's own tags — a crate carries no metadata to read it from.
        const uploads: Array<{
            album: null | string;
            artist: string;
            filePath: string;
            stagingPath: string;
            title: string;
            trackName: string;
        }> = [];
        const takenStagingPaths = new Set<string>();

        for (const subboxId of missingIds) {
            const filePath = pathById.get(subboxId)!;
            const ext = path.extname(filePath);
            let artist: string | undefined;
            let album: string | undefined;
            let title: string | undefined;
            try {
                const meta = await parseFile(filePath, {
                    duration: false,
                    skipCovers: true,
                    skipPostHeaders: true,
                });
                artist = meta.common.artist?.trim();
                album = meta.common.album?.trim();
                title = meta.common.title?.trim();
            } catch (err) {
                console.warn(`[serato] could not read tags from ${filePath}:`, err);
            }

            // Unlike the Rekordbox flow, missing tags are not a reason to drop the
            // track: we already have its identity from SUBBOX_ID, and the server
            // matches on that. The tags only decide where the bytes are staged, so
            // fall back to the filename rather than losing the track.
            const fallbackName = path.basename(filePath, ext);
            const resolvedArtist = artist || 'Unknown Artist';
            const resolvedTitle = title || fallbackName;

            let stagingPath = [
                sanitizePathSegment(resolvedArtist),
                sanitizePathSegment(album ?? null) || 'Unknown Album',
                `${sanitizePathSegment(resolvedTitle)}${ext}`,
            ].join('/');
            // Two distinct files can sanitize to the same staging path (the same
            // track filed twice under different tags is normal in a DJ library).
            // Uploading both to one path would leave the second overwriting the
            // first, and one subbox_id with no audio behind it.
            if (takenStagingPaths.has(stagingPath)) {
                stagingPath = `${stagingPath.slice(0, -ext.length)}-${subboxId.slice(0, 8)}${ext}`;
            }
            takenStagingPaths.add(stagingPath);

            uploads.push({
                album: album ?? null,
                artist: resolvedArtist,
                filePath,
                stagingPath,
                title: resolvedTitle,
                trackName: `${resolvedArtist} - ${resolvedTitle}`,
            });
        }

        // Step 5: does it fit? Ask before spending the transfer, not after.
        const totalUploadBytes = uploads.reduce((sum, u) => sum + fs.statSync(u.filePath).size, 0);
        if (totalUploadBytes > 0) {
            const storageRes = await withPymixAuth<{
                allowed?: boolean;
                currentUsageBytes?: number;
                maxStorageBytes?: number;
            }>(pymixAuth, (cookie) =>
                axios.get(`${pymixUrl}/user/storage_check`, {
                    headers: { Cookie: cookie },
                    httpsAgent,
                    params: { uploadSizeBytes: totalUploadBytes },
                }),
            );
            if (storageRes.data?.allowed === false) {
                const toMB = (bytes: number) => Math.round(bytes / (1024 * 1024));
                throw new Error(
                    `STORAGE_LIMIT_EXCEEDED:Your upload of ${toMB(totalUploadBytes)} MB would ` +
                        `exceed your storage limit. You are currently using ` +
                        `${toMB(storageRes.data?.currentUsageBytes ?? 0)} MB of your ` +
                        `${toMB(storageRes.data?.maxStorageBytes ?? 0)} MB allowance.`,
                );
            }
        }

        // Step 6: upload, at the same bounded concurrency as the Rekordbox flow.
        const activeUploads = new Map<string, string>();
        let completed = 0;
        const emitProgress = (currentTrack = '') => {
            sendProgress({
                activeTracks: Array.from(activeUploads.values()),
                currentTrack,
                phase: 'uploading',
                total: uploads.length,
                uploaded: completed,
            });
        };
        emitProgress();

        const uploadOne = async (item: (typeof uploads)[number]) => {
            const fileSize = fs.statSync(item.filePath).size;
            // Encode each segment separately so the `/`s stay real separators —
            // encoding the whole path turns them into %2F and filebrowser then
            // tracks the TUS upload at a different URL than the one we PATCH.
            const encoded = item.stagingPath.split('/').map(encodeURIComponent).join('/');
            const resourcePath = `${filebrowserUrl}/api/tus/uploads/${encoded}?override=true`;

            const createResp = await fbRequest(fbAuth, {
                data: null,
                headers: { 'upload-length': fileSize },
                method: 'post',
                url: resourcePath,
            });
            if (createResp.status !== 201) {
                throw new Error(
                    `Failed to create TUS upload for "${item.trackName}": ${createResp.status}`,
                );
            }

            const rawLocation = createResp.headers['location'] as string | undefined;
            const uploadUrl = rawLocation
                ? rawLocation.startsWith('http')
                    ? rawLocation
                    : `${new URL(filebrowserUrl).origin}${rawLocation}`
                : resourcePath;

            await new Promise<void>((resolve, reject) => {
                const fileStream = fs.createReadStream(item.filePath);
                const uploader = new tus.Upload(fileStream as unknown as Buffer, {
                    chunkSize: 20 * 1024 * 1024,
                    headers: { 'X-Auth': fbAuth.getToken() },
                    httpStack: new tus.DefaultHttpStack({ rejectUnauthorized: false }),
                    onError: reject,
                    onProgress: (bytesUploaded, bytesTotal) => {
                        const pct = ((bytesUploaded / bytesTotal) * 100).toFixed(1);
                        activeUploads.set(item.trackName, `${item.trackName} (${pct}%)`);
                        emitProgress();
                    },
                    onSuccess: () => resolve(),
                    uploadSize: fileSize,
                    uploadUrl,
                });
                uploader.start();
            });

            activeUploads.delete(item.trackName);
            completed++;
            result.uploaded++;
            emitProgress(item.trackName);
        };

        const queue = [...uploads];
        const failedStagingPaths = new Set<string>();
        const workers = Array.from({ length: UPLOAD_CONCURRENCY }, async () => {
            while (queue.length > 0) {
                const item = queue.shift()!;
                try {
                    await uploadOne(item);
                } catch (err) {
                    // One track's failure must not sink the batch — the user has
                    // dozens of other tracks in flight behind it.
                    activeUploads.delete(item.trackName);
                    completed++;
                    result.skipped++;
                    failedStagingPaths.add(item.stagingPath);
                    result.failed.push({
                        reason: err instanceof Error ? err.message : String(err),
                        trackName: item.trackName,
                    });
                    console.warn(`[serato] upload failed for "${item.trackName}":`, err);
                    emitProgress();
                }
            }
        });
        await Promise.all(workers);

        // Step 7: map the staged files to their identities. The server re-reads the
        // SUBBOX_ID we wrote above rather than minting a new one, so this records
        // the same id the manifest carries — and it records `userLocation`, which
        // is what lets a *later* import of this library resolve these same tracks
        // even with no manifest at all.
        sendProgress({
            currentTrack: '',
            phase: 'mapping-metadata',
            total: uploads.length,
            uploaded: result.uploaded,
        });

        const tracksToMap = uploads
            .filter((u) => !failedStagingPaths.has(u.stagingPath))
            .map((u) => ({
                originalAlbum: u.album,
                originalArtist: u.artist,
                originalName: u.title,
                stagingLocation: u.stagingPath,
                userLocation: u.filePath,
            }));

        if (tracksToMap.length > 0) {
            await withPymixAuth(pymixAuth, (cookie) =>
                axios.post(
                    `${pymixUrl}/sync/map_meta`,
                    { tracks: tracksToMap },
                    { headers: { Cookie: cookie }, httpsAgent },
                ),
            );
        }

        sendProgress({
            currentTrack: '',
            phase: 'done',
            total: uploads.length,
            uploaded: result.uploaded,
        });
        return result;
    },
);

// ── Serato export ───────────────────────────────────────────────────────────
//
// The other direction, and the same argument. pymix used to write `.crate` files
// itself against a `user_root` the client sent it — a prediction about this
// filesystem, made by a machine that has never seen it. Now the server returns
// the structure (POST /serato/export) and the crates are written here, against
// the paths the download actually landed on.
//
// It also means the cues can go into the real files. Writing them is deliberately
// timid: only into a track that has no cues of its own. See writeTrackCues.

export interface SeratoExportResult extends WriteCratesResult {
    cues: WriteCuesResult;
    seratoFolder: string;
}

ipcMain.handle(
    'sync:write-serato-crates',
    async (
        _event,
        args: {
            /** As returned by POST /serato/export. */
            crates: Array<{
                display_name: string;
                path_components: string[];
                tracks: Array<{ cues?: SeratoCueWire[]; relative_path: string }>;
            }>;
            /** Where the download put the tracks — the `music` folder, not its
             *  parent. Empty falls back to the app's own music folder, which is
             *  where a download would have put them anyway. */
            musicRoot: string;
            seratoFolder: string;
            /** Write subbox's cues into files that have none of their own. */
            writeCues?: boolean;
        },
    ): Promise<SeratoExportResult> => {
        const { crates, seratoFolder, writeCues = true } = args;
        const musicRoot = args.musicRoot || getMusicPath();

        if (!fs.existsSync(path.join(seratoFolder, 'SubCrates'))) {
            // Refuse rather than create one: a typo'd path would otherwise produce
            // a second, invisible Serato library that the user never sees again.
            throw new Error(
                `${path.basename(seratoFolder)} has no SubCrates folder in it. Pick the ` +
                    `_Serato_ folder itself — it is normally in your Music folder.`,
            );
        }

        const toWrite: CrateToWrite[] = crates.map((crate) => ({
            pathComponents:
                crate.path_components.length > 0 ? crate.path_components : [crate.display_name],
            tracks: crate.tracks.map((track) => ({
                cues: track.cues,
                localPath: path.join(musicRoot, track.relative_path),
            })),
        }));

        const written = writeCrates(seratoFolder, toWrite);
        console.log(
            `[serato] wrote ${written.cratesWritten} crate(s), ${written.tracksWritten} track(s)` +
                `${written.backupFolder ? `, replaced files backed up to ${written.backupFolder}` : ''}`,
        );
        if (written.missing.length > 0) {
            console.warn(
                `[serato] ${written.missing.length} track(s) were not on disk and were left out ` +
                    `of the crates: ${written.missing.slice(0, 5).join(', ')}` +
                    `${written.missing.length > 5 ? ' …' : ''}`,
            );
        }

        // One entry per track file, not per crate entry: the same track in two
        // playlists is one file, and writing it twice would find its own cues the
        // second time round and count itself as already cued.
        const cueTargets = new Map<string, SeratoCueWire[]>();
        if (writeCues) {
            for (const crate of toWrite) {
                for (const track of crate.tracks) {
                    if (track.cues && track.cues.length > 0 && !cueTargets.has(track.localPath)) {
                        cueTargets.set(track.localPath, track.cues);
                    }
                }
            }
        }
        const cues = writeTrackCues(
            Array.from(cueTargets, ([localPath, trackCues]) => ({ cues: trackCues, localPath })),
        );
        if (cues.written > 0 || cues.alreadyCued > 0 || cues.failed.length > 0) {
            console.log(
                `[serato] cues: ${cues.written} written, ${cues.alreadyCued} left alone ` +
                    `(already cued in Serato), ${cues.unsupported} unsupported format, ` +
                    `${cues.failed.length} failed`,
            );
        }

        return { ...written, cues, seratoFolder };
    },
);
