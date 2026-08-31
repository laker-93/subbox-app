import isElectron from 'is-electron';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isUploadForbidden, PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { InviteLockedPanel } from '/@/renderer/features/invite/components/invite-locked-panel';
import {
    SelectableList,
    SyncFlow,
    SyncFlowFill,
    SyncLoading,
    SyncProgress,
    SyncResult,
    SyncStorageExceeded,
    SyncSummary,
    useSelection,
} from '/@/renderer/features/sync/components/shared';
import { useCurrentServerWithCredential } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { CopyButton } from '/@/shared/components/copy-button/copy-button';
import { Icon } from '/@/shared/components/icon/icon';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';

const ipc = isElectron() ? window.api.ipc : null;

type ImportPhase = 'applying_metadata' | 'complete' | 'importing_audio' | 'mapping_ids';

interface ImportProgress {
    in_progress: boolean;
    n_tracks_processed: number;
    n_tracks_to_process: number;
    percentage_complete: number;
    // Which pass of the import the server is on, and how far through it is. An
    // import is three passes, and only the first shows up in the track count the
    // percentage used to be derived from -- so the bar read a frozen 100% for the
    // whole tail (laker-93/pymix#51). Optional: a server predating that fix, or an
    // import job created before it, sends neither.
    phase?: ImportPhase | null;
    phase_n_processed?: number;
    phase_n_total?: number;
    reason: string;
    result: boolean;
    /**
     * What a *successful* job could not do. `reason` only reaches the client on a
     * failed job, so a job that finished but left something out has nowhere else to
     * say so (laker-93/pymix#136).
     */
    warnings?: null | string;
}

const IMPORT_PHASE_LABELS: Record<ImportPhase, string> = {
    applying_metadata: 'Applying cue points and metadata...',
    complete: 'Finishing up...',
    importing_audio: 'Importing into library...',
    mapping_ids: 'Linking tracks to your library...',
};

interface PlaylistPreview {
    name: string;
    path: string[];
    trackCount: number;
    trackKeys: string[];
}

type SyncStep =
    | 'done'
    | 'idle'
    | 'importing'
    | 'parsing'
    | 'preview'
    | 'storage-exceeded'
    | 'upload-forbidden'
    | 'uploading';

interface UploadProgress {
    activeTracks?: string[];
    currentTrack: string;
    phase: 'done' | 'error' | 'mapping-metadata' | 'matching' | 'uploading';
    total: number;
    uploaded: number;
}

/** The completion screen is a narrow column; beyond this the full list is in the
 *  main-process log rather than pushing the "Sync Another Library" button off-screen. */
const MAX_LISTED_DROPPED = 5;

interface SyncRekordboxProps {
    /**
     * The Rekordbox/Serato control, rendered on the first screen. Supplied by
     * `SyncUpload` rather than built here so both flows show the identical control in
     * the identical slot, and so switching it swaps this whole component out.
     */
    formatControl?: ReactNode;
}

function playlistKey(pl: PlaylistPreview): string {
    return [...pl.path, pl.name].join('/');
}

export const SyncRekordbox = ({ formatControl }: SyncRekordboxProps) => {
    const { t } = useTranslation();
    const currentServer = useCurrentServerWithCredential();

    const [step, setStep] = useState<SyncStep>('idle');
    const [xmlPath, setXmlPath] = useState<null | string>(null);
    const [playlists, setPlaylists] = useState<PlaylistPreview[]>([]);
    const {
        selectAll,
        selected: selectedPlaylists,
        selectNone: handleSelectNone,
        setSelected: setSelectedPlaylists,
        toggle: handleTogglePlaylist,
    } = useSelection();
    const [metadataOnly, setMetadataOnly] = useState(false);
    const [progress, setProgress] = useState<null | UploadProgress>(null);
    const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
    const [jobId, setJobId] = useState<null | string>(null);
    // `dropped` holds tracks the XML lists that could never be uploaded — their tags
    // leave nothing to match on. They are counted in neither totalTracksInXml nor the
    // preview badge, so the completion screen names them rather than letting them
    // vanish into a gap between two numbers.
    const [uploadResult, setUploadResult] = useState<null | {
        dropped?: Array<{ reason: string; trackName: string }>;
        failed?: Array<{ reason: string; trackName: string }>;
        skipped: number;
        totalTracksInXml?: number;
        uploaded: number;
    }>(null);
    const [error, setError] = useState<null | string>(null);
    const [storageInfo, setStorageInfo] = useState<null | {
        currentUsageBytes: number;
        maxStorageBytes: number;
        remainingBytes: number;
    }>(null);

    // Listen for upload progress events
    useEffect(() => {
        if (!ipc) return;
        const handler = (_event: any, prog: UploadProgress) => {
            setProgress(prog);
        };
        ipc.on('sync:upload-progress', handler);
        return () => {
            ipc.removeListener('sync:upload-progress', handler);
        };
    }, []);

    const handleSelectXml = useCallback(async () => {
        if (!ipc) return;
        try {
            const filePath = await ipc.invoke('open-file-selector', {
                filters: [{ extensions: ['xml'], name: 'Rekordbox XML' }],
                title: 'Select Rekordbox XML',
            });

            if (!filePath) return;

            setXmlPath(filePath);
            setStep('parsing');
            setError(null);

            const previews: PlaylistPreview[] = await ipc.invoke(
                'sync:parse-rekordbox-xml',
                filePath,
            );
            setPlaylists(previews);
            selectAll(previews.map((p) => playlistKey(p)));
            setStep('preview');
        } catch (err: any) {
            setError(err?.message || 'Failed to parse XML');
            setStep('idle');
        }
    }, [selectAll]);

    const handleSelectAll = useCallback(
        () => selectAll(playlists.map((p) => playlistKey(p))),
        [playlists, selectAll],
    );

    const handleUpload = useCallback(async () => {
        if (!ipc || !xmlPath || !currentServer) return;

        // In metadata-only mode with nothing selected, null tells the backend to process all tracks
        const selectedPlaylistPaths =
            metadataOnly && selectedPlaylists.size === 0
                ? null
                : playlists
                      .filter((p) => selectedPlaylists.has(playlistKey(p)))
                      .map((p) => [...p.path, p.name]);

        setStep('uploading');
        setError(null);
        setUploadResult(null);

        try {
            if (metadataOnly) {
                // XML-only path: upload XML file then trigger import without processing tracks
                await ipc.invoke('sync:upload-xml', {
                    filebrowserToken: currentServer.fbToken,
                    filebrowserUrl: urlConfig.filebrowser,
                    // serverId/username let the main process re-login for a fresh
                    // filebrowser token if this upload outlives the current one.
                    serverId: currentServer.id,
                    username: currentServer.username,
                    xmlPath,
                });

                setUploadResult({ dropped: [], failed: [], skipped: 0, uploaded: 0 });
            } else {
                // Pre-flight storage check (renderer-side, works for both Electron and web)
                try {
                    const storage = await PymixController.checkStorage({
                        baseUrl: urlConfig.pymix,
                        query: { uploadSizeBytes: 0 },
                    });

                    console.log('[storage-check] pre-flight response:', storage);

                    if (!storage.allowed) {
                        console.warn('[storage-check] pre-flight blocked:', {
                            allowed: storage.allowed,
                            currentUsageBytes: storage.currentUsageBytes,
                            maxStorageBytes: storage.maxStorageBytes,
                            reason: storage.reason,
                            remainingBytes: storage.remainingBytes,
                        });
                        setStorageInfo({
                            currentUsageBytes: storage.currentUsageBytes,
                            maxStorageBytes: storage.maxStorageBytes,
                            remainingBytes: storage.remainingBytes,
                        });
                        setStep('storage-exceeded');
                        return;
                    }
                } catch (storageErr) {
                    console.warn(
                        '[storage-check] pre-flight threw — proceeding anyway:',
                        storageErr,
                    );
                    // If the check fails, proceed anyway — the main process will do a precise check
                }

                const result = await ipc.invoke('sync:upload-from-xml', {
                    filebrowserToken: currentServer.fbToken,
                    filebrowserUrl: urlConfig.filebrowser,
                    playlistNames: playlists
                        .filter((p) => selectedPlaylists.has(playlistKey(p)))
                        .map((p) => p.name),
                    pymixUrl: urlConfig.pymix,
                    // serverId lets the main process re-login for a fresh pymix session
                    // cookie if this upload outlives the current one.
                    serverId: currentServer.id,
                    username: currentServer.username,
                    xmlPath,
                });
                console.log('Upload result:', result);
                setUploadResult(result);
            }

            // Trigger rekordbox import via pymix API
            try {
                const importResult = await PymixController.rbImport({
                    baseUrl: urlConfig.pymix,
                    body: {
                        playlistNames: selectedPlaylistPaths,
                    },
                });

                const jobId = importResult?.job_id;
                if (!jobId) {
                    const reason = importResult?.reason || 'Unknown error';
                    throw new Error(`Import failed: ${reason}`);
                }

                // No tracks to import does NOT mean nothing left to do: pymix runs the
                // playlist and metadata passes for a metadata-only import too, and this
                // used to return "Success" the moment the upload came back — before the
                // server had created a single playlist (laker-93/subbox-app#55). Poll the
                // job either way; it is the only thing that can tell us it finished.
                setJobId(jobId);
                setStep('importing');
                setImportProgress(null);
            } catch (importErr: any) {
                // A refused write is an account limit, not a failure — say so instead of
                // showing "Import Failed" over something that was never going to work.
                if (isUploadForbidden(importErr)) {
                    setStep('upload-forbidden');
                    return;
                }
                setError(importErr?.message || 'Import failed');
                setStep('done');
            }
        } catch (err: any) {
            if (isUploadForbidden(err)) {
                setStep('upload-forbidden');
                return;
            }

            const msg = err?.message || 'Upload failed';
            const storagePrefix = 'STORAGE_LIMIT_EXCEEDED:';
            const storagePrefixIdx = msg.indexOf(storagePrefix);
            if (storagePrefixIdx !== -1) {
                setError(msg.slice(storagePrefixIdx + storagePrefix.length));
                setStep('storage-exceeded');
            } else {
                setError(msg);
                setStep('preview');
            }
        }
    }, [currentServer, metadataOnly, playlists, selectedPlaylists, xmlPath]);

    // Poll import progress when in importing step
    useEffect(() => {
        if (step !== 'importing' || !jobId) return;

        let cancelled = false;

        const poll = async () => {
            while (!cancelled) {
                try {
                    const prog = await PymixController.importProgress({
                        baseUrl: urlConfig.pymix,
                        query: { job_id: jobId, public: false },
                    });

                    if (cancelled) break;
                    setImportProgress(prog as ImportProgress);

                    if (!prog.in_progress) {
                        setStep('done');
                        if (prog.result) {
                            toast.success({
                                // A metadata-only import lands no tracks, and
                                // "Imported 0 tracks" reads like a failure.
                                message:
                                    prog.n_tracks_processed > 0
                                        ? `Imported ${prog.n_tracks_processed} tracks`
                                        : 'Library updated from your Rekordbox XML',
                            });
                        } else {
                            setError(prog.reason || 'Import failed');
                        }
                        break;
                    }
                } catch (err: any) {
                    if (cancelled) break;
                    setError(err?.message || 'Failed to check import progress');
                    setStep('done');
                    break;
                }

                // Wait 3 seconds between polls
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
        };

        poll();

        return () => {
            cancelled = true;
        };
    }, [step, jobId]);

    const handleReset = useCallback(() => {
        setStep('idle');
        setXmlPath(null);
        setPlaylists([]);
        setSelectedPlaylists(new Set());
        setProgress(null);
        setImportProgress(null);
        setJobId(null);
        setUploadResult(null);
        setError(null);
        setStorageInfo(null);
        setMetadataOnly(false);
    }, [setSelectedPlaylists]);

    // Dedup across selected playlists by track key (same scheme as the upload-time
    // trackMap in main), since a track shared by multiple playlists must only count once.
    const totalSelectedTracks = new Set(
        playlists.filter((p) => selectedPlaylists.has(playlistKey(p))).flatMap((p) => p.trackKeys),
    ).size;

    // ── Idle: source selection ─────────────────────────────────────────────
    if (step === 'idle') {
        return (
            // The same shape as every other Sync screen: title top-left, the line
            // that says what this reads under it, the format control in the body,
            // and the primary button full-width at the bottom of the pane. It used
            // to be a 420px column floating in the middle of the page, which is why
            // Upload and Download read as two different products.
            <SyncFlow
                error={error}
                footer={
                    <Button
                        fullWidth
                        onClick={handleSelectXml}
                        size="md"
                        tooltip={{
                            label: t('page.sync.rekordbox.selectXmlTooltip', {
                                defaultValue:
                                    'In Rekordbox, go to File → Export Collection in xml format, then choose that .xml file here. Sub-box reads your playlists and tracks from it.',
                            }),
                            multiline: true,
                            openDelay: 300,
                            w: 300,
                        }}
                        variant="filled"
                    >
                        {/* No titleCase: it lowercases the acronym, and "Select Xml
                            File" across a full-width button is now the most
                            prominent thing on the screen. */}
                        {t('page.sync.rekordbox.selectXml', {
                            defaultValue: 'Select XML File',
                        })}
                    </Button>
                }
                subtitle={
                    <Text c="dimmed" size="sm">
                        {/* The how-to (File → Export Collection) is on the button's
                            tooltip, where it is wanted at the moment of clicking
                            rather than before it. */}
                        {t('page.sync.rekordbox.description', {
                            defaultValue:
                                'Sub-box reads a collection XML exported from Rekordbox: your playlists and tracks, cue points and all.',
                        })}
                    </Text>
                }
                title={t('page.sync.rekordbox.title', {
                    defaultValue: 'Sync from Rekordbox',
                    postProcess: 'titleCase',
                })}
            >
                {formatControl}
                <SyncFlowFill />
            </SyncFlow>
        );
    }

    // ── Parsing ────────────────────────────────────────────────────────────
    if (step === 'parsing') {
        return (
            <SyncLoading
                label={t('page.sync.rekordbox.parsing', {
                    defaultValue: 'Parsing Rekordbox XML...',
                })}
            />
        );
    }

    // ── Preview: playlist selection ────────────────────────────────────────
    if (step === 'preview') {
        return (
            <SyncFlow
                error={error}
                footer={
                    <Button
                        disabled={!metadataOnly && selectedPlaylists.size === 0}
                        fullWidth
                        onClick={handleUpload}
                        size="md"
                        style={{ flexShrink: 0 }}
                        tooltip={{
                            label: metadataOnly
                                ? 'Send the selected playlists’ track info to your library without uploading any audio files.'
                                : 'Upload the selected playlists and their audio files to your Sub-box cloud library, then import them so they appear in your collection.',
                            multiline: true,
                            openDelay: 300,
                            w: 300,
                        }}
                        variant="filled"
                    >
                        {/* One word in both modes. The tick box above is the record
                            of which mode this is; the button only has to be the way
                            out of the screen, and it used to restate the choice in
                            three more words that moved under the cursor. */}
                        {t('page.sync.rekordbox.upload', {
                            defaultValue: 'Upload',
                            postProcess: 'titleCase',
                        })}
                    </Button>
                }
                onBack={handleReset}
                subtitle={
                    <Text c="dimmed" size="sm">
                        {xmlPath}
                    </Text>
                }
                title={t('page.sync.rekordbox.previewTitle', {
                    defaultValue: 'Preview Changes',
                    postProcess: 'titleCase',
                })}
            >
                <SyncSummary
                    items={[
                        {
                            label: `${playlists.length} ${playlists.length === 1 ? 'playlist' : 'playlists'}`,
                        },
                        { label: `${selectedPlaylists.size} selected` },
                        { label: `${totalSelectedTracks} tracks` },
                    ]}
                />

                <SelectableList
                    items={playlists.map((pl) => ({
                        detail: `${pl.trackCount} ${pl.trackCount === 1 ? 'track' : 'tracks'}`,
                        id: playlistKey(pl),
                        label: pl.name,
                        prefix: pl.path.length > 0 ? `${pl.path.join(' / ')} / ` : undefined,
                    }))}
                    onSelectAll={handleSelectAll}
                    onSelectNone={handleSelectNone}
                    onToggle={handleTogglePlaylist}
                    options={
                        <Tooltip
                            label="Only update track info (cue points, ratings, tags) for music already in your library. No audio is uploaded."
                            multiline
                            openDelay={300}
                            position="right"
                            w={300}
                        >
                            <span style={{ width: 'fit-content' }}>
                                <Checkbox
                                    checked={metadataOnly}
                                    label="Import metadata only (no track uploads)"
                                    onChange={(e) => setMetadataOnly(e.currentTarget.checked)}
                                />
                            </span>
                        </Tooltip>
                    }
                    selected={selectedPlaylists}
                />
            </SyncFlow>
        );
    }

    // ── Uploading ──────────────────────────────────────────────────────────
    if (step === 'uploading') {
        const phaseLabel = progress
            ? {
                  done: 'Complete!',
                  error: 'Error',
                  importing: 'Starting import...',
                  'mapping-metadata': 'Mapping metadata...',
                  matching: 'Matching tracks with cloud library...',
                  uploading: `Uploading tracks (${Math.floor(progress.uploaded)}/${progress.total})...`,
              }[progress.phase]
            : 'Starting...';

        return (
            <SyncProgress
                activeTracks={progress?.activeTracks}
                currentTrack={progress?.currentTrack}
                phaseLabel={phaseLabel}
            />
        );
    }

    // ── Importing ──────────────────────────────────────────────────────────
    if (step === 'importing') {
        const pct = importProgress?.percentage_complete ?? 0;
        const processed = importProgress?.n_tracks_processed ?? 0;
        const total = importProgress?.n_tracks_to_process ?? 0;

        const phase = importProgress?.phase ?? 'importing_audio';
        const title = IMPORT_PHASE_LABELS[phase] ?? IMPORT_PHASE_LABELS.importing_audio;
        // The audio phase counts tracks landing in the library; the later passes
        // count their own work, so show whichever the current phase is about.
        const phaseTotal = importProgress?.phase_n_total ?? 0;
        const counts =
            phase === 'importing_audio' || phaseTotal === 0
                ? `${processed} / ${total} tracks`
                : `${importProgress?.phase_n_processed ?? 0} / ${phaseTotal} tracks`;
        // A metadata-only import has no tracks to land and hasn't reached a pass with
        // its own total yet, so "0 / 0 tracks" is all we'd have to say — show the
        // percentage on its own rather than a count that reads like nothing is happening.
        const hasCounts = total > 0 || phaseTotal > 0;

        return (
            <SyncProgress
                detail={
                    <>
                        <Text size="sm">
                            {hasCounts ? `${counts} (${Math.round(pct)}%)` : `${Math.round(pct)}%`}
                        </Text>
                        <Text c="dimmed" size="xs" ta="center">
                            This may take a while for large libraries.
                        </Text>
                    </>
                }
                phaseLabel={title}
            />
        );
    }

    // ── Upload refused (account can't write to a library) ──────────────────
    if (step === 'upload-forbidden') {
        return (
            <InviteLockedPanel
                description="Uploading a Rekordbox library writes to your collection, and this account can't. Your own Sub-box library imports your playlists, cue points and all."
                title="Rekordbox upload needs your own library"
            />
        );
    }

    // ── Storage Exceeded ───────────────────────────────────────────────────
    if (step === 'storage-exceeded') {
        return (
            <SyncStorageExceeded
                error={error}
                note={
                    <Text c="dimmed" size="sm" ta="center">
                        To get more storage, join our{' '}
                        <Text
                            c="blue"
                            component="a"
                            href={urlConfig.discord}
                            rel="noopener noreferrer"
                            target="_blank"
                        >
                            Discord community
                        </Text>{' '}
                        and request an upgrade from the Sub-box team.
                    </Text>
                }
                onBack={handleReset}
                storageInfo={storageInfo}
            />
        );
    }

    // ── Done (failed) ─────────────────────────────────────────────────────
    if (error) {
        // The user's actual question is "is my music in there?", and the answer
        // decides what they do next. A failed job keeps the phase it died in, so
        // a failure in one of the two passes that run *after* `beet import` means
        // the audio already landed and only metadata is missing — re-uploading
        // 1.2 GB would be the wrong reaction to that (laker-93/subbox-app#48).
        const failedPhase = importProgress?.phase;
        const tracksAreSafe = failedPhase === 'applying_metadata' || failedPhase === 'mapping_ids';

        const diagnostics = [
            `Rekordbox import failed${tracksAreSafe ? ' (after tracks were imported)' : ''}`,
            `reason: ${error}`,
            jobId ? `job: ${jobId}` : null,
            failedPhase ? `phase: ${failedPhase}` : null,
            uploadResult ? `uploaded: ${uploadResult.uploaded}` : null,
            importProgress ? `imported: ${importProgress.n_tracks_processed}` : null,
        ]
            .filter(Boolean)
            .join('\n');

        return (
            <SyncResult
                actionLabel={t('common.back', { defaultValue: 'Back', postProcess: 'titleCase' })}
                onAction={handleReset}
                secondaryAction={
                    <CopyButton timeout={2000} value={diagnostics}>
                        {({ copied, copy }) => (
                            <Button
                                fullWidth
                                leftSection={<Icon icon={copied ? 'check' : 'clipboardCopy'} />}
                                onClick={copy}
                                variant="subtle"
                            >
                                {copied ? 'Copied' : 'Copy details'}
                            </Button>
                        )}
                    </CopyButton>
                }
                status="warn"
                title={
                    tracksAreSafe
                        ? t('page.sync.rekordbox.importPartial', {
                              defaultValue: 'Imported, with problems',
                              postProcess: 'sentenceCase',
                          })
                        : t('page.sync.rekordbox.importFailed', {
                              defaultValue: 'Import Failed',
                              postProcess: 'titleCase',
                          })
                }
            >
                <Text size="sm" ta="center">
                    {tracksAreSafe
                        ? 'Your tracks were uploaded and are in your library, but some of the metadata from the XML (ratings, BPM, cue points) or some playlists could not be applied. There is no need to upload them again.'
                        : 'The import did not finish, so some or all of your tracks may not be in your library. Check the Tracks page before uploading again.'}
                </Text>
                {/* What actually landed. Whatever broke, these numbers are real,
                    and they are the difference between an error screen and one the
                    user can act on. */}
                {(uploadResult || importProgress) && (
                    <Stack align="center" gap={2}>
                        {uploadResult && (
                            <Text c="dimmed" size="sm">
                                {uploadResult.uploaded} tracks uploaded
                            </Text>
                        )}
                        {importProgress && (
                            <Text c="dimmed" size="sm">
                                {importProgress.n_tracks_processed} tracks imported into library
                            </Text>
                        )}
                    </Stack>
                )}
                <Text c="dimmed" size="xs" ta="center">
                    {error}
                </Text>
            </SyncResult>
        );
    }

    // ── Done ───────────────────────────────────────────────────────────────
    return (
        <SyncResult
            actionLabel={t('page.sync.rekordbox.syncAnother', {
                defaultValue: 'Sync Another Library',
                postProcess: 'titleCase',
            })}
            onAction={handleReset}
            status="success"
            title={t('page.sync.rekordbox.uploadComplete', {
                defaultValue: 'Upload Complete',
                postProcess: 'titleCase',
            })}
        >
            {uploadResult && (
                <Stack align="center" gap="xs">
                    {uploadResult.totalTracksInXml !== undefined && (
                        <Text c="dimmed" size="sm">
                            {uploadResult.totalTracksInXml} tracks found in XML
                        </Text>
                    )}
                    {/* Nothing uploaded and nothing landed in the library. This used
                        to key off `!importProgress`, which stopped meaning "nothing
                        was imported" once we started polling the metadata-only path
                        through to the end (#55); that path always has progress now. */}
                    {uploadResult.uploaded === 0 &&
                    (importProgress?.n_tracks_processed ?? 0) === 0 ? (
                        <Text c="dimmed" size="sm">
                            Everything is already up to date.
                        </Text>
                    ) : (
                        <>
                            <Text size="sm">{uploadResult.uploaded} tracks uploaded</Text>
                            {uploadResult.skipped > 0 && (
                                <Text c="dimmed" size="sm">
                                    {uploadResult.skipped} tracks skipped
                                    {uploadResult.failed && uploadResult.failed.length > 0
                                        ? ` (${uploadResult.failed.length} failed to upload, rest not found or already uploaded)`
                                        : ' (files not found)'}
                                </Text>
                            )}
                            {uploadResult.failed && uploadResult.failed.length > 0 && (
                                <Stack align="center" gap={2}>
                                    {uploadResult.failed.map((f) => (
                                        <Text c="dimmed" key={f.trackName} size="xs" ta="center">
                                            {f.trackName}: {f.reason}
                                        </Text>
                                    ))}
                                </Stack>
                            )}
                            {importProgress && (
                                <Text size="sm">
                                    {importProgress.n_tracks_processed} tracks imported into library
                                </Text>
                            )}
                        </>
                    )}
                    {/* A job can succeed and still not have done everything asked
                        of it. Nothing else on this screen would show that. */}
                    {importProgress?.warnings && (
                        <Text c="dimmed" size="sm" ta="center">
                            {importProgress.warnings}
                        </Text>
                    )}
                    {/* Outside the branch above: a run can upload nothing and still
                        have dropped tracks, and "everything is already up to date"
                        would be wrong without this qualifying it. */}
                    {uploadResult.dropped && uploadResult.dropped.length > 0 && (
                        <Stack align="center" gap={2}>
                            <Text c="dimmed" size="sm">
                                {uploadResult.dropped.length}{' '}
                                {uploadResult.dropped.length === 1 ? 'track' : 'tracks'} in the XML
                                could not be uploaded (missing or unusable title)
                            </Text>
                            {uploadResult.dropped.slice(0, MAX_LISTED_DROPPED).map((d) => (
                                <Text
                                    c="dimmed"
                                    // Main dedupes on name + reason, so the same
                                    // name can legitimately appear twice.
                                    key={`${d.trackName}:${d.reason}`}
                                    size="xs"
                                    ta="center"
                                >
                                    {d.trackName}: {d.reason}
                                </Text>
                            ))}
                            {uploadResult.dropped.length > MAX_LISTED_DROPPED && (
                                <Text c="dimmed" size="xs" ta="center">
                                    …and {uploadResult.dropped.length - MAX_LISTED_DROPPED} more
                                </Text>
                            )}
                        </Stack>
                    )}
                </Stack>
            )}
        </SyncResult>
    );
};
