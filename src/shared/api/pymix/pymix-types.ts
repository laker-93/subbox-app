import { z } from 'zod';

const error = z.string();

const create = z.null();
const login = z.null();
const sync = z.null();

const syncPlaylists = z.object({
    nTracksExported: z.number(),
    reason: z.string(),
    success: z.boolean(),
    zipPath: z.string(),
});

const matchTracks = z.object({
    reason: z.string(),
    success: z.boolean(),
    tracks: z.array(
        z.object({
            artist: z.string(),
            matched: z.boolean(),
            title: z.string(),
        }),
    ),
});

const isValidToken = z.object({
    is_valid_token: z.boolean(),
    reason: z.string(),
    success: z.boolean(),
});

const deleteDuplicates = z.object({
    duplicates_removed: z.array(z.string()),
    reason: z.string(),
    success: z.boolean(),
});

const deleteSong = z.null();

const importJob = z.object({
    job_id: z.string(),
    max_library_size_exceeded: z.boolean(),
    n_tracks_for_import: z.number(),
    reason: z.string(),
    success: z.boolean(),
});

const beetsImportProgress = z.object({
    in_progress: z.boolean(),
    n_tracks_processed: z.number(),
    n_tracks_to_process: z.number(),
    percentage_complete: z.number(),
    reason: z.string(),
    result: z.boolean(),
});

const librarySize = z.object({
    reason: z.string(),
    success: z.boolean(),
    total_size_bytes: z.number(),
});

const rbImport = z.object({
    beets_output: z.string(),
    imported_tracks: z.number(),
    n_tracks_fir_imort: z.number(),
    reason: z.string(),
    success: z.boolean(),
});

const seratoImport = z.object({
    beets_output: z.string(),
    imported_tracks: z.number(),
    n_tracks_fir_imort: z.number(),
    reason: z.string(),
    success: z.boolean(),
});

const exportJob = z.object({
    beets_output: z.string(),
    n_beets_tracks: z.number(),
    reason: z.string(),
    success: z.boolean(),
});

const storageCheck = z.object({
    allowed: z.boolean(),
    currentUsageBytes: z.number(),
    maxStorageBytes: z.number(),
    reason: z.string(),
    remainingBytes: z.number(),
    success: z.boolean(),
});

const syncPlanTrackMissing = z.object({
    album: z.string().optional(),
    artist: z.string(),
    duration: z.number().optional(),
    fileSize: z.number().optional(),
    title: z.string(),
});

const syncPlanTrackExisting = z.object({
    album: z.string().optional(),
    artist: z.string(),
    status: z.string(),
    title: z.string(),
});

const syncPlanTrackConflict = z.object({
    album: z.string().optional(),
    artist: z.string(),
    reason: z.string().optional(),
    status: z.string(),
    title: z.string(),
});

const syncPlanMetadataUpdate = z.object({
    artist: z.string(),
    fields: z.array(z.string()),
    title: z.string(),
});

const syncPlan = z.object({
    download: z.object({
        strategy: z.string(),
    }),
    metadata: z.object({
        updates: z.array(syncPlanMetadataUpdate),
    }),
    summary: z.object({
        downloadSizeBytes: z.number(),
        metadataUpdates: z.number(),
        playlists: z.number(),
        tracksAlreadyPresent: z.number(),
        tracksMissing: z.number(),
        tracksRequested: z.number(),
    }),
    tracks: z.object({
        conflicts: z.array(syncPlanTrackConflict),
        existing: z.array(syncPlanTrackExisting),
        missing: z.array(syncPlanTrackMissing),
    }),
});

// --- Parameter schemas ---

const createParameters = z.object({
    email: z.string(),
    password: z.string(),
    token: z.string(),
    username: z.string(),
});

const loginParameters = z.object({
    password: z.string(),
    username: z.string(),
});

const rbExportParameters = z.object({
    playlistIds: z.array(z.string()).optional(),
    user_root: z.string(),
});

const track = z.object({
    album: z.string().optional(),
    artist: z.string(),
    fileExtension: z.string().optional(),
    fromTag: z.boolean().default(true),
    title: z.string(),
});

const syncParameters = z.object({
    tracks: z.array(track),
});

const matchTracksParameters = z.object({
    tracks: z.array(track),
});

const rbImportParameters = z.object({
    playlistNames: z.array(z.array(z.string())),
});

const importProgressParameters = z.object({
    job_id: z.string(),
    public: z.boolean(),
});

const deleteParameters = z.object({
    public: z.boolean(),
});

const deleteSongParameters = z.object({
    ids: z.array(z.string()),
    username: z.optional(z.string()),
});

const isValidTokenParameters = z.object({
    token: z.string(),
});

const storageCheckParameters = z.object({
    uploadSizeBytes: z.number(),
});

const syncPlanPlaylist = z.object({
    id: z.string(),
    source: z.string(),
});

const importParameters = z.object({
    public: z.boolean(),
});

const syncPlanLocalTrack = track;

const syncPlanParameters = z.object({
    direction: z.enum(['download', 'upload']),
    localTracks: z.array(syncPlanLocalTrack),
    options: z
        .object({
            fuzzyMatch: z.boolean().optional(),
            includeMetadata: z.boolean().optional(),
        })
        .optional(),
    playlists: z.array(syncPlanPlaylist),
});

const syncPlaylistsParameters = syncPlanParameters;

export const pymixType = {
    _parameters: {
        create: createParameters,
        deleteDuplicates: deleteParameters,
        deleteSong: deleteSongParameters,
        exportJob: rbExportParameters,
        import: importParameters,
        importProgress: importProgressParameters,
        isValidToken: isValidTokenParameters,
        login: loginParameters,
        matchTracks: matchTracksParameters,
        rbImport: rbImportParameters,
        storageCheck: storageCheckParameters,
        sync: syncParameters,
        syncPlan: syncPlanParameters,
        syncPlaylists: syncPlaylistsParameters,
    },
    _response: {
        beetsImportProgress,
        create,
        deleteDuplicates,
        deleteSong,
        error,
        exportJob,
        importJob,
        isValidToken,
        librarySize,
        login,
        matchTracks,
        rbImport,
        seratoImport,
        storageCheck,
        sync,
        syncPlan,
        syncPlaylists,
    },
};
