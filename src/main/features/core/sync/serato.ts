import axios from 'axios';
import { ipcMain } from 'electron';
import * as fs from 'fs';
import { parseFile } from 'music-metadata';
import * as os from 'os';
import * as path from 'path';

import { getMusicPath } from '/@/main/features/core/sync';
import { findCloudOnlyAmong, pathKey } from '/@/main/features/core/sync/library-root';
import { findWhollyStaged, runMapMeta } from '/@/main/features/core/sync/map-meta';
import {
    connectionLostError,
    handleKeepingAwake,
    runUploadQueue,
} from '/@/main/features/core/sync/network-retry';
import {
    createFbAuth,
    createPymixAuth,
    FbAuth,
    fbRequest,
    httpsAgent,
    PymixAuth,
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
    readTrackGrid,
    resolveSeratoFolder,
    SeratoBeatgridWire,
    SeratoCueWire,
    volumeRootOf,
    writeCrates,
    WriteCratesResult,
    WriteCuesResult,
    WriteGridResult,
    writeTrackCues,
    writeTrackGrid,
} from '/@/main/features/core/sync/serato-crates';
import { getOrCreateSubboxId, writeSubboxId } from '/@/main/features/core/sync/subbox-id-tags';
import { uploadFileViaTus } from '/@/main/features/core/sync/tus-upload';
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

function* chunked<T>(items: T[]): Generator<T[]> {
    for (let i = 0; i < items.length; i += PRESENCE_CHUNK_SIZE) {
        yield items.slice(i, i + PRESENCE_CHUNK_SIZE);
    }
}

/** Best name for a track we can only refer to by its path — its filename. */
function describeCrateTrack(trackPath: string): string {
    return path.basename(trackPath);
}

/**
 * For each path on this machine, the subbox_id of the library track an earlier
 * upload of that file became (pymix's POST /tracks/by_location), when there is one.
 *
 * An empty answer when pymix can't say, so the upload goes ahead as it did before
 * the endpoint existed: a pymix older than laker-93/pymix#231 404s it.
 */
async function libraryIdsByLocation(
    pymixAuth: PymixAuth,
    pymixUrl: string,
    paths: string[],
): Promise<Record<string, null | string>> {
    const result: Record<string, null | string> = {};
    try {
        for (const chunk of chunked(Array.from(new Set(paths)))) {
            const res = await withPymixAuth<{ subbox_ids: Record<string, null | string> }>(
                pymixAuth,
                (cookie) =>
                    axios.post(
                        `${pymixUrl}/tracks/by_location`,
                        { user_locations: chunk },
                        { headers: { Cookie: cookie }, httpsAgent },
                    ),
            );
            Object.assign(result, res.data.subbox_ids);
        }
    } catch (err) {
        console.warn(
            '[serato] could not look up tracks by location; tracks with no id the library ' +
                'knows will be uploaded:',
            err,
        );
        return {};
    }
    return result;
}

const CLOUD_ONLY_REASON =
    'only in the cloud and not in your library yet; make it available offline to upload it';

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

handleKeepingAwake(
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

        // Cloud-only entries (OneDrive Files On-Demand and the like) are never
        // opened: reading the tag, cues or grid downloads the file, and writing a
        // tag is a changed file synced to every device (design-library-roots.md
        // §10 Q5). They are identified by the path an earlier upload recorded, or
        // left out. If this check fails the import fails, rather than open blind.
        const cloudOnly = await findCloudOnlyAmong(allTrackPaths);
        const cloudOnlyPaths: string[] = [];

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
            if (cloudOnly.has(pathKey(trackPath))) {
                cloudOnlyPaths.push(trackPath);
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
            // invisible to it. null means this file can't carry cues (a
            // container tserato has no reader for, or unreadable) and pymix
            // should fall back to its own copy; an empty array means it can and
            // there are none.
            const cues = readTrackCues(trackPath);
            // The beat grid, asked for separately and for the same reason: a
            // track can carry a grid and no cues, or cues and no grid. Note that
            // an analysed-but-ungridded file returns [] here, not null -- the
            // frame is present with no anchors in it, which is a reading, not a
            // failure to read.
            const beatgrid = readTrackGrid(trackPath);

            // pymix keys the manifest on the path as stored in the crate, which is
            // exactly what tserato handed us. Two crate entries can share an id --
            // the same track filed under two paths -- and both belong in the
            // manifest, because both crates need the playlist entry.
            trackIdentities.push({
                crate_path: trackPath,
                subbox_id: subboxId,
                ...(cues === null ? {} : { cues }),
                ...(beatgrid === null ? {} : { beatgrid }),
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

        if (cloudOnlyPaths.length > 0) {
            const known = await libraryIdsByLocation(pymixAuth, pymixUrl, cloudOnlyPaths);
            for (const trackPath of cloudOnlyPaths) {
                const libraryId = known[trackPath];
                if (!libraryId) {
                    dropped.push({
                        reason: CLOUD_ONLY_REASON,
                        trackName: describeCrateTrack(trackPath),
                    });
                    continue;
                }
                trackIdentities.push({ crate_path: trackPath, subbox_id: libraryId });
                if (!pathById.has(libraryId)) pathById.set(libraryId, trackPath);
            }
            console.log(
                `[serato] ${cloudOnlyPaths.length} crate entry/entries only in the cloud; ` +
                    `identified by path, not opened`,
            );
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

        if (trackIdentities.length === 0) {
            console.log('[serato] 0 crate entries identified');
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
        for (const chunk of chunked(Array.from(pathById.keys()))) {
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

        // A cloud-only entry whose recorded id the library no longer has can't be
        // uploaded: uploading reads the file, which downloads it.
        const cloudOnlyKeys = new Set(cloudOnlyPaths.map(pathKey));
        for (let i = trackIdentities.length - 1; i >= 0; i -= 1) {
            const identity = trackIdentities[i];
            if (present.has(identity.subbox_id) || !cloudOnlyKeys.has(pathKey(identity.crate_path)))
                continue;
            trackIdentities.splice(i, 1);
            const trackName = describeCrateTrack(identity.crate_path);
            dropped.push({ reason: CLOUD_ONLY_REASON, trackName });
            console.warn(`[serato]   ${trackName} — ${CLOUD_ONLY_REASON}`);
            if (pathById.get(identity.subbox_id) === identity.crate_path) {
                pathById.delete(identity.subbox_id);
            }
        }

        // Step 3b: an id the library doesn't know may still be a file it has. A
        // Rekordbox upload tags only the server's copy, so the user's own file has
        // no SUBBOX_ID and step 2 has just minted one; uploading it would make a
        // second copy of a track already there (laker-93/pymix#231). The path that
        // upload recorded identifies it. Both modes need this: "Playlists only"
        // would otherwise send an id the library can't find and lose the track.
        const libraryIdByPath = await libraryIdsByLocation(
            pymixAuth,
            pymixUrl,
            trackIdentities.filter((t) => !present.has(t.subbox_id)).map((t) => t.crate_path),
        );
        /** The id step 2 read or minted → the library's id for the same file. */
        const adopted = new Map<string, string>();
        for (const identity of trackIdentities) {
            const libraryId = libraryIdByPath[identity.crate_path];
            if (libraryId && !present.has(identity.subbox_id)) {
                adopted.set(identity.subbox_id, libraryId);
            }
        }
        for (const identity of trackIdentities) {
            const libraryId = adopted.get(identity.subbox_id);
            if (!libraryId) continue;
            // The library's id goes on the file too, so the next upload reads it
            // straight off the tag, and the file carries the identity the library
            // uses. The id replaced is one nothing in the library refers to.
            try {
                writeSubboxId(identity.crate_path, libraryId);
            } catch (err) {
                console.warn(
                    `[serato] could not write SUBBOX_ID to ${identity.crate_path}; ` +
                        `using the library's id for this upload only:`,
                    err,
                );
            }
            identity.subbox_id = libraryId;
        }
        for (const [localId, libraryId] of adopted) {
            pathById.set(libraryId, pathById.get(localId)!);
            pathById.delete(localId);
            present.add(libraryId);
        }
        if (adopted.size > 0) {
            console.log(
                `[serato] ${adopted.size} track(s) with no id the library knows are already ` +
                    `in it, from an earlier upload of the same file`,
            );
        }

        if (cratesOnly) {
            console.log(
                `[serato] ${trackIdentities.length} crate entries identified, uploading no audio (playlists only)`,
            );
            sendProgress({ currentTrack: '', phase: 'done', total: 0, uploaded: 0 });
            return result;
        }

        const ids = Array.from(pathById.keys());
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

        // Skip what an earlier attempt already uploaded whole: a retry after a late
        // failure re-sends nothing the server has (laker-93/pymix#237). They are
        // still mapped below, since this attempt's import has to stage them.
        const alreadyStaged = await findWhollyStaged({
            items: uploads.map((u) => ({ localPath: u.filePath, stagingPath: u.stagingPath })),
            pymixAuth,
            pymixUrl,
        });
        const toSend = uploads.filter((u) => !alreadyStaged.has(u.stagingPath));
        result.skipped += uploads.length - toSend.length;

        // Step 5: does it fit? Ask before spending the transfer, not after.
        const totalUploadBytes = toSend.reduce((sum, u) => sum + fs.statSync(u.filePath).size, 0);
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
                total: toSend.length,
                uploaded: completed,
            });
        };
        emitProgress();

        const uploadOne = async (item: (typeof uploads)[number]) => {
            await uploadFileViaTus({
                fbAuth,
                filebrowserUrl,
                filePath: item.filePath,
                onProgress: (bytesUploaded, bytesTotal) => {
                    const pct = ((bytesUploaded / bytesTotal) * 100).toFixed(1);
                    activeUploads.set(item.trackName, `${item.trackName} (${pct}%)`);
                    emitProgress();
                },
                stagingPath: item.stagingPath,
                trackName: item.trackName,
            });

            activeUploads.delete(item.trackName);
            completed++;
            result.uploaded++;
            emitProgress(item.trackName);
        };

        const failedStagingPaths = new Set<string>();
        // One track's failure must not sink the batch — the user has dozens of
        // other tracks in flight behind it. A dropped connection pauses the queue
        // instead of failing it (subbox-app#203).
        const { connectionLost, unsent } = await runUploadQueue({
            concurrency: UPLOAD_CONCURRENCY,
            items: toSend,
            onFailed: (item, reason) => {
                activeUploads.delete(item.trackName);
                completed++;
                result.skipped++;
                failedStagingPaths.add(item.stagingPath);
                result.failed.push({ reason, trackName: item.trackName });
                console.warn(`[serato] upload failed for "${item.trackName}": ${reason}`);
                emitProgress();
            },
            probeUrl: filebrowserUrl,
            uploadOne,
        });
        if (connectionLost) {
            throw connectionLostError(result.uploaded, unsent.length);
        }

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
            await runMapMeta({
                onProgress: (processed, total) =>
                    sendProgress({
                        currentTrack: '',
                        phase: 'mapping-metadata',
                        total,
                        uploaded: processed,
                    }),
                pymixAuth,
                pymixUrl,
                tracks: tracksToMap,
            });
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
// It also means the cues and the beat grid can go into the real files. Writing
// either is deliberately timid by default: only into a track that has none of its
// own, unless the user has asked for the opposite. The two are guarded separately,
// because a file can have one without the other -- see writeTrackCues,
// writeTrackGrid and OverwriteOptions.

export interface SeratoExportResult extends WriteCratesResult {
    beatgrid: WriteGridResult;
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
                tracks: Array<{
                    beatgrid?: SeratoBeatgridWire[];
                    cues?: SeratoCueWire[];
                    relative_path: string;
                }>;
            }>;
            /** Where the download put the tracks — the `music` folder, not its
             *  parent. Empty falls back to the app's own music folder, which is
             *  where a download would have put them anyway. */
            musicRoot: string;
            /** Replace a beat grid the file already carries. Off unless asked for. */
            overwriteBeatgrid?: boolean;
            /** Replace cues the file already carries. Off unless asked for. */
            overwriteCues?: boolean;
            seratoFolder: string;
            /** Write subbox's beat grid into files that have none of their own. */
            writeBeatgrid?: boolean;
            /** Write subbox's cues into files that have none of their own. */
            writeCues?: boolean;
        },
    ): Promise<SeratoExportResult> => {
        const {
            crates,
            overwriteBeatgrid = false,
            overwriteCues = false,
            seratoFolder,
            writeBeatgrid = true,
            writeCues = true,
        } = args;
        const musicRoot = args.musicRoot || getMusicPath();

        if (!fs.existsSync(path.join(seratoFolder, 'SubCrates'))) {
            // Refuse rather than create one: a typo'd path would otherwise produce
            // a second, invisible Serato library that the user never sees again.
            throw new Error(
                `${path.basename(seratoFolder)} has no SubCrates folder in it. Pick the ` +
                    `_Serato_ folder itself — it is normally in your Music folder.`,
            );
        }

        // A crate's `ptrk` is stored relative to the volume the _Serato_ folder is
        // on, so a library and its tracks have to live on the same volume to be
        // expressible at all. Serato does not write such crates either.
        //
        // Refused rather than written, for the same reason as the check above: the
        // fallback path would produce crates that open *empty* in Serato, after
        // overwriting whatever was there before. A download that puts tracks in the
        // app's music folder and crates on a DJ USB is exactly how a user reaches
        // this, and nothing on screen would otherwise say why the crates are blank.
        const libraryVolume = volumeRootOf(seratoFolder);
        const musicVolume = volumeRootOf(musicRoot);
        if (libraryVolume !== musicVolume) {
            throw new Error(
                `Your Serato library is on ${libraryVolume === '/' ? 'this Mac' : path.basename(libraryVolume)} ` +
                    `but the tracks are on ${musicVolume === '/' ? 'this Mac' : path.basename(musicVolume)}. ` +
                    `Serato can only read crates whose tracks are on the same drive as the ` +
                    `_Serato_ folder, so pick a library on the same drive as your music.`,
            );
        }

        const toWrite: CrateToWrite[] = crates.map((crate) => ({
            pathComponents:
                crate.path_components.length > 0 ? crate.path_components : [crate.display_name],
            tracks: crate.tracks.map((track) => ({
                beatgrid: track.beatgrid,
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
            { overwrite: overwriteCues },
        );
        if (cues.written > 0 || cues.alreadyCued > 0 || cues.failed.length > 0) {
            console.log(
                `[serato] cues: ${cues.written} written, ${cues.replaced} of them replacing ` +
                    `existing Serato cues, ${cues.alreadyCued} left alone ` +
                    `(already cued in Serato), ${cues.unsupported} unsupported format, ` +
                    `${cues.failed.length} failed`,
            );
        }

        // Deduplicated the same way and for the same reason: written twice, the
        // second pass would find the grid it just wrote and count the file as
        // already gridded.
        const gridTargets = new Map<string, SeratoBeatgridWire[]>();
        if (writeBeatgrid) {
            for (const crate of toWrite) {
                for (const track of crate.tracks) {
                    if (
                        track.beatgrid &&
                        track.beatgrid.length > 0 &&
                        !gridTargets.has(track.localPath)
                    ) {
                        gridTargets.set(track.localPath, track.beatgrid);
                    }
                }
            }
        }
        const beatgrid = writeTrackGrid(
            Array.from(gridTargets, ([localPath, grid]) => ({ beatgrid: grid, localPath })),
            { overwrite: overwriteBeatgrid },
        );
        if (beatgrid.written > 0 || beatgrid.alreadyGridded > 0 || beatgrid.failed.length > 0) {
            console.log(
                `[serato] beat grids: ${beatgrid.written} written, ${beatgrid.replaced} of them ` +
                    `replacing existing Serato grids, ${beatgrid.alreadyGridded} left ` +
                    `alone (already gridded in Serato), ${beatgrid.unsupported} unsupported ` +
                    `format, ${beatgrid.failed.length} failed`,
            );
        }

        return { ...written, beatgrid, cues, seratoFolder };
    },
);
