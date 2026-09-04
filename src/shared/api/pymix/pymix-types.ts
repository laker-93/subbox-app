import { z } from 'zod';

const error = z.string();

const create = z.null();
const login = z.null();
const sync = z.null();
const download = z.any();

const syncPlaylists = z.object({
    // The one file to fetch from /sync/download — either the tracks zip (with the
    // Rekordbox XML inside it, when asked for) or the XML on its own. Optional
    // because a pymix that predates it doesn't send it; callers fall back to
    // deriving the name from zipPath.
    downloadFilename: z.string().nullish(),
    nTracksExported: z.number(),
    reason: z.string(),
    success: z.boolean(),
    xmlIncluded: z.boolean().nullish(),
    // Null for a metadata-only export: there is no zip in that case.
    zipPath: z.string().nullish(),
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

const deleteSongResult = z.object({
    reason: z.string(),
    subbox_id: z.string(),
    success: z.boolean(),
});

const deleteSong = z.object({
    results: z.array(deleteSongResult),
    success: z.boolean(),
    username: z.string(),
});

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
    // Which of the import's three passes the server is on, and that pass's own
    // n/total (laker-93/pymix#51). Optional so an older pymix — or a job row
    // created before its migration — still parses.
    phase: z.string().nullish(),
    phase_n_processed: z.number().optional(),
    phase_n_total: z.number().optional(),
    reason: z.string(),
    result: z.boolean(),
    // Set on a job that *succeeded* but did not do everything asked of it — a
    // Serato import whose crates named tracks that are not in the library. `reason`
    // only reaches the client on a failed job, so a partial success routed through
    // it would say nothing at all.
    warnings: z.string().nullish(),
});

const librarySize = z.object({
    reason: z.string(),
    success: z.boolean(),
    total_size_bytes: z.number(),
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
    // Optional because pymix does not send it: /sync/plan builds each update from
    // the missing track's title and artist alone and never says which fields would
    // change. This contract isn't validated at runtime (see pymixApiClient — the
    // axios body is passed straight through), so declaring it required didn't make
    // it appear; it just let the renderer call .map() on undefined and crash the
    // Metadata Updates tab. Render it defensively until pymix computes real fields.
    fields: z.array(z.string()).optional(),
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

/**
 * Which subbox track each crate entry refers to.
 *
 * A `.crate` file stores an absolute path on the user's machine and nothing else,
 * and pymix never sees their files — so the client reads SUBBOX_ID off each one
 * and sends the mapping. `crate_path` must be the path exactly as the crate
 * stores it, because that is the key pymix looks the entry up by.
 */
const seratoCue = z.object({
    end_ms: z.number().nullish(),
    index: z.number(),
    name: z.string(),
    start_ms: z.number(),
    type: z.enum(['cue', 'loop']),
});

/**
 * One beat-grid anchor. Serato-shaped in both directions: every anchor but the
 * last carries `beats_till_next`, the last carries `bpm`. pymix converts a
 * Rekordbox-sourced grid — where every anchor has its own tempo — before
 * sending, so this side never does that arithmetic.
 */
const seratoBeatgridMarker = z.object({
    beats_till_next: z.number().nullish(),
    bpm: z.number().nullish(),
    position_ms: z.number(),
});

const seratoImportParameters = z.object({
    track_identities: z.array(
        z.object({
            /**
             * The cues as read off the user's own file. pymix can only read its
             * copy, which is frozen at whatever was uploaded — so for a track the
             * library already has, every cue set in Serato since is invisible to
             * it. Absent means "we couldn't read them, use your copy"; an empty
             * array means "we read them and there are none", which pymix leaves
             * alone rather than treating as a deletion.
             */
            /**
             * The beat grid, read the same three ways `cues` is. One wrinkle of
             * its own: a file Serato has analysed but not gridded carries the
             * frame with zero anchors in it, so an empty array is what a
             * *present* frame decodes to as often as it is what a missing
             * encoder produces. Frame presence is not evidence of a grid.
             */
            beatgrid: z.array(seratoBeatgridMarker).optional(),
            crate_path: z.string(),
            cues: z.array(seratoCue).optional(),
            subbox_id: z.string(),
        }),
    ),
});

/**
 * The playlists to write as Serato crates, and what goes in them.
 *
 * pymix used to write the `.crate` files itself, against a `user_root` this
 * client sent it — a prediction about a filesystem the server has never seen,
 * and a wrong one produces crates that parse perfectly and resolve nothing. So
 * it returns the structure and the main process writes the files against the
 * paths the download actually landed on.
 */
const seratoExportParameters = z.object({
    /** Empty for every playlist. */
    playlistIds: z.array(z.string()),
});

const seratoExport = z.object({
    crates: z.array(
        z.object({
            display_name: z.string(),
            /** Root first. One `.crate` file per level — that is how Serato spells a folder. */
            path_components: z.array(z.string()),
            tracks: z.array(
                z.object({
                    album: z.string(),
                    artist: z.string(),
                    beatgrid: z.array(seratoBeatgridMarker),
                    /** What the conversion to Serato's shape could not carry —
                     *  a time signature, a beat-of-bar, a rounded span. To show,
                     *  not to act on. */
                    beatgrid_notes: z.array(z.string()),
                    cues: z.array(seratoCue),
                    rating: z.number(),
                    /** Inside the download, under `music/`. Join onto the music folder. */
                    relative_path: z.string(),
                    subbox_id: z.string().nullish(),
                    title: z.string(),
                }),
            ),
        }),
    ),
    n_crates: z.number(),
    n_tracks: z.number(),
    reason: z.string(),
    success: z.boolean(),
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

// Not a server parameter — pymix ignores it. Every user's download is the same url
// (/sync/download/music.zip), so a CDN in front of pymix will happily hand back a
// stale, or another session's, file: Cloudflare was caching it for 4h in prod
// (laker-93/pymix#119). A value that changes per request keeps this client correct
// whatever sits in front of, or ships in, the server.
const downloadParameters = z.object({
    cache_bust: z.string(),
});

/**
 * Beta-invite capture. The one pymix write that carries no session — the caller is a
 * prospective user with no account. `dj_software_other` is only meaningful alongside
 * `other`; the server drops it otherwise.
 */
const inviteRequestParameters = z.object({
    dj_software: z.enum(['rekordbox', 'serato', 'other']),
    dj_software_other: z.string().optional(),
    email: z.string(),
});

const inviteRequest = z.object({
    status: z.string(),
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

// What to put in the single file pymix prepares. The client always asks for one
// download: a browser only reliably saves one file per user gesture, so a second
// programmatic download is dropped with no error at all.
const syncPlaylistsParameters = syncPlanParameters.extend({
    // Include subbox_rb_export.xml — in the zip alongside the tracks, or as the
    // whole download when includeTracks is false.
    includeRekordboxXml: z.boolean().optional(),
    // False for a metadata-only (XML) download.
    includeTracks: z.boolean().optional(),
    // Where the user will keep the tracks, so the XML's Locations resolve.
    user_root: z.string().optional(),
});

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
        download: downloadParameters,
        exportJob: rbExportParameters,
        import: importParameters,
        importProgress: importProgressParameters,
        inviteRequest: inviteRequestParameters,
        isValidToken: isValidTokenParameters,
        login: loginParameters,
        matchTracks: matchTracksParameters,
        rbImport: rbImportParameters,
        seratoExport: seratoExportParameters,
        seratoImport: seratoImportParameters,
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
        download,
        error,
        exportJob,
        importJob,
        inviteRequest,
        isValidToken,
        librarySize,
        login,
        matchMetadataResponse,
        matchTracks,
        matchYoutubeResponse,
        parseLinkResponse,
        seratoExport,
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
