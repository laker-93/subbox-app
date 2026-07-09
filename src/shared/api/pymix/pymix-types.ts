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
    // SUBBOX_ID read off the local file's tags, when present. Lets sync/plan match
    // this track exactly instead of falling back to fuzzy title/artist matching.
    subboxId: z.string().optional(),
    title: z.string(),
});

const syncParameters = z.object({
    tracks: z.array(track),
});

const matchTracksParameters = z.object({
    tracks: z.array(track),
});

const rbImportParameters = z.object({
    playlistNames: z.array(z.array(z.string())).nullable(),
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
    playlists: z.array(syncPlanPlaylist).nullable(),
});

const syncPlaylistsParameters = syncPlanParameters;

const syncTracksParameters = z.object({
    tracksToDownload: z.array(track),
});

// --- Wishlist types ---

const wishlistStatus = z.enum(['inbox', 'wishlist', 'downloaded', 'available', 'ignored']);

const wishlistItem = z.object({
    album: z.string().nullable().optional(),
    artist: z.string().nullable(),
    bandcamp_url: z.string().nullable().optional(),
    created_at: z.number().nullable().optional(),
    linked_subbox_id: z.string().nullable().optional(),
    metadata_source: z.enum(['auto', 'user']).optional(),
    raw_note: z.string().nullable().optional(),
    resolve_state: z.enum(['pending', 'resolved', 'nomatch']).optional(),
    soundcloud_url: z.string().nullable().optional(),
    status: wishlistStatus,
    title: z.string().nullable(),
    updated_at: z.number().nullable().optional(),
    user_id: z.string(),
    wishlist_id: z.string(),
    youtube_url: z.string().nullable().optional(),
    youtube_video_id: z.string().nullable().optional(),
});

const wishlistList = z.object({
    items: z.array(wishlistItem),
});

const wishlistItemResponse = z.object({
    item: wishlistItem,
});

const wishlistDeleteResponse = z.object({
    success: z.boolean(),
});

const youtubeMatch = z.object({
    confidence: z.number(),
    youtube_title: z.string(),
    youtube_url: z.string(),
    youtube_video_id: z.string(),
});

const matchYoutubeResponse = z.object({
    item: wishlistItem,
    matches: z.array(youtubeMatch),
});

const matchSource = z.enum(['structured', 'musicbrainz', 'string']);

const linkTrackMetadata = z.object({
    album: z.string().nullable().optional(),
    artist: z.string(),
    bandcamp_url: z.string().nullable().optional(),
    confidence: z.number().nullable().optional(),
    is_collection: z.literal(false),
    match_source: matchSource.optional(),
    soundcloud_url: z.string().nullable().optional(),
    source: z.enum(['youtube', 'bandcamp', 'soundcloud']),
    title: z.string(),
    youtube_url: z.string().nullable().optional(),
    youtube_video_id: z.string().nullable().optional(),
});

const musicBrainzMatch = z.object({
    album: z.string().nullable().optional(),
    artist: z.string(),
    score: z.number(),
    title: z.string(),
});

const matchMetadataResponse = z.object({
    match: musicBrainzMatch.nullable(),
});

const wishlistMatchMetadataParameters = z.object({
    artist: z.string().optional(),
    query: z.string().optional(),
    title: z.string().optional(),
});

const linkCollectionMetadata = z.object({
    is_collection: z.literal(true),
    source: z.enum(['youtube', 'bandcamp', 'soundcloud']),
    tracks: z.array(linkTrackMetadata),
});

const linkMetadata = z.discriminatedUnion('is_collection', [
    linkTrackMetadata,
    linkCollectionMetadata,
]);

const parseLinkResponse = z.object({
    metadata: linkMetadata,
});

const wishlistParseLinkParameters = z.object({
    url: z.string(),
});

const wishlistCreateParameters = z.object({
    album: z.string().optional(),
    artist: z.string().optional(),
    bandcamp_url: z.string().optional(),
    soundcloud_url: z.string().optional(),
    title: z.string().optional(),
    youtube_url: z.string().optional(),
    youtube_video_id: z.string().optional(),
});

const wishlistBulkCreateParameters = z.object({
    items: z.array(wishlistCreateParameters),
});

const wishlistBulkCreateResponse = z.object({
    items: z.array(wishlistItem),
});

const wishlistSetSheetParameters = z.object({
    sheet_id: z.string(),
});

const wishlistSetSheetResponse = z.object({
    success: z.boolean(),
});

const wishlistSheetStatusResponse = z.object({
    configured: z.boolean(),
    error: z.string().nullable(),
    sheet_url: z.string().nullable(),
    status: z.enum(['ok', 'error']).nullable(),
});

const wishlistUpdateParameters = z.object({
    album: z.string().optional(),
    artist: z.string().optional(),
    bandcamp_url: z.string().nullable().optional(),
    linked_subbox_id: z.string().optional(),
    status: wishlistStatus.optional(),
    title: z.string().optional(),
    youtube_url: z.string().nullable().optional(),
    youtube_video_id: z.string().nullable().optional(),
});

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
        syncTracks: syncTracksParameters,
        wishlistBulkCreate: wishlistBulkCreateParameters,
        wishlistCreate: wishlistCreateParameters,
        wishlistMatchMetadata: wishlistMatchMetadataParameters,
        wishlistParseLink: wishlistParseLinkParameters,
        wishlistSetSheet: wishlistSetSheetParameters,
        wishlistUpdate: wishlistUpdateParameters,
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
        matchMetadataResponse,
        matchTracks,
        matchYoutubeResponse,
        parseLinkResponse,
        rbImport,
        seratoImport,
        storageCheck,
        sync,
        syncPlan,
        syncPlaylists,
        syncTracks: syncPlaylists,
        wishlistBulkCreateResponse,
        wishlistDeleteResponse,
        wishlistItem,
        wishlistItemResponse,
        wishlistList,
        wishlistSetSheetResponse,
        wishlistSheetStatusResponse,
        youtubeMatch,
    },
};
