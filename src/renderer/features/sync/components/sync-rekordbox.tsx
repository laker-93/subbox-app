import isElectron from 'is-electron';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { urlConfig } from '/@/renderer/config/url-config';
import { InviteLockedPanel } from '/@/renderer/features/invite/components/invite-locked-panel';
import {
    IMPORT_PHASE_LABELS,
    JobOutcome,
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
import {
    clearUploadRun,
    startRekordboxUpload,
    useUploadRun,
} from '/@/renderer/features/sync/store/upload-run-store';
import { useCurrentServerWithCredential } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { CopyButton } from '/@/shared/components/copy-button/copy-button';
import { Icon } from '/@/shared/components/icon/icon';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';

const ipc = isElectron() ? window.api.ipc : null;

interface PlaylistPreview {
    name: string;
    path: string[];
    trackCount: number;
    trackKeys: string[];
}

/** The screens before a run exists. Once one starts, the run store owns the step. */
type PreRunStep = 'idle' | 'parsing' | 'preview';

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

// JSON rather than a '/' join: names are the raw Rekordbox names and may contain '/',
// which would let folder "A" > playlist "B" and a top-level playlist "A/B" share a key.
function playlistKey(pl: PlaylistPreview): string {
    return JSON.stringify([...pl.path, pl.name]);
}

export const SyncRekordbox = ({ formatControl }: SyncRekordboxProps) => {
    const { t } = useTranslation();
    const currentServer = useCurrentServerWithCredential();
    const serverId = currentServer?.id;

    // The upload itself, once started, lives in the run store so that it survives the
    // user leaving this screen (#195). Everything below it is the run's; everything
    // local here is the XML and the selection that come before one.
    const anyRun = useUploadRun(serverId);
    const run = anyRun?.format === 'rekordbox' ? anyRun : null;

    const [localStep, setLocalStep] = useState<PreRunStep>('idle');
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
    const [localError, setLocalError] = useState<null | string>(null);

    // An upload that threw before anything was imported ends the run, and its error
    // goes back on the preview screen to be retried from there. If this component was
    // remounted since, the XML is no longer loaded, so it lands on the first screen.
    const hasPreview = playlists.length > 0;
    useEffect(() => {
        if (run?.step !== 'upload-error') return;
        setLocalError(run.error);
        setLocalStep(hasPreview ? 'preview' : 'idle');
        clearUploadRun();
    }, [hasPreview, run]);

    const step = run && run.step !== 'upload-error' ? run.step : localStep;
    const error = run ? run.error : localError;
    const progress = run?.progress ?? null;
    const importProgress = run?.importProgress ?? null;
    const jobId = run?.jobId ?? null;
    const uploadResult = run?.uploadResult ?? null;
    const storageInfo = run?.storageInfo ?? null;

    const handleSelectXml = useCallback(async () => {
        if (!ipc) return;
        try {
            const filePath = await ipc.invoke('open-file-selector', {
                filters: [{ extensions: ['xml'], name: 'Rekordbox XML' }],
                title: 'Select Rekordbox XML',
            });

            if (!filePath) return;

            setXmlPath(filePath);
            setLocalStep('parsing');
            setLocalError(null);

            const previews: PlaylistPreview[] = await ipc.invoke(
                'sync:parse-rekordbox-xml',
                filePath,
            );
            setPlaylists(previews);
            selectAll(previews.map((p) => playlistKey(p)));
            setLocalStep('preview');
        } catch (err: any) {
            setLocalError(err?.message || 'Failed to parse XML');
            setLocalStep('idle');
        }
    }, [selectAll]);

    const handleSelectAll = useCallback(
        () => selectAll(playlists.map((p) => playlistKey(p))),
        [playlists, selectAll],
    );

    const handleUpload = useCallback(() => {
        if (!xmlPath || !currentServer) return;
        setLocalError(null);
        startRekordboxUpload(
            {
                metadataOnly,
                playlistNames: playlists
                    .filter((p) => selectedPlaylists.has(playlistKey(p)))
                    .map((p) => p.name),
                // In metadata-only mode with nothing selected, null tells the backend
                // to process all tracks.
                selectedPlaylistPaths:
                    metadataOnly && selectedPlaylists.size === 0
                        ? null
                        : playlists
                              .filter((p) => selectedPlaylists.has(playlistKey(p)))
                              .map((p) => [...p.path, p.name]),
                xmlPath,
            },
            currentServer,
        );
    }, [currentServer, metadataOnly, playlists, selectedPlaylists, xmlPath]);

    // The run carries what it was started with, so a retry doesn't need the preview
    // to still be loaded: the user may have left and come back since.
    const handleRetry = useCallback(() => {
        if (!run || !currentServer) return;
        startRekordboxUpload(run.request, currentServer);
    }, [currentServer, run]);

    // The metadata-only path imports what the tagging recorded, so it is how a run
    // whose tagging failed is finished, without sending the audio again.
    const handleFinishImport = useCallback(() => {
        if (!run || !currentServer) return;
        startRekordboxUpload({ ...run.request, metadataOnly: true }, currentServer);
    }, [currentServer, run]);

    const handleBackToPreview = useCallback(() => {
        clearUploadRun();
        setLocalStep(hasPreview ? 'preview' : 'idle');
    }, [hasPreview]);

    const handleReset = useCallback(() => {
        clearUploadRun();
        setLocalStep('idle');
        setXmlPath(null);
        setPlaylists([]);
        setSelectedPlaylists(new Set());
        setLocalError(null);
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
                  'mapping-metadata': progress.total
                      ? `Tagging tracks (${progress.uploaded}/${progress.total})...`
                      : 'Tagging tracks...',
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

    // ── Upload failed (nothing uploaded, import not started) ───────────────
    if (step === 'upload-failed' && uploadResult) {
        const failed = uploadResult.failed ?? [];
        const diagnostics = [
            'Rekordbox upload failed (import not started)',
            `failed: ${failed.length}`,
            ...failed.map((f) => `${f.trackName}: ${f.reason}`),
        ].join('\n');

        return (
            <SyncResult
                actionLabel={t('common.retry', { defaultValue: 'Retry', postProcess: 'titleCase' })}
                onAction={handleRetry}
                secondaryAction={
                    <Stack gap="xs">
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
                        {/* Back to the playlist list, not the start: the XML is still
                            loaded and the selection is what the user will retry. */}
                        <Button fullWidth onClick={handleBackToPreview} variant="default">
                            {t('common.back', { defaultValue: 'Back', postProcess: 'titleCase' })}
                        </Button>
                    </Stack>
                }
                status="warn"
                title={t('page.sync.rekordbox.uploadFailed', {
                    defaultValue: 'Upload Failed',
                    postProcess: 'titleCase',
                })}
            >
                <Text size="sm" ta="center">
                    None of the {failed.length} {failed.length === 1 ? 'track' : 'tracks'} could be
                    uploaded, so nothing was imported and your library has not changed.
                </Text>
                <Stack align="center" gap={2}>
                    {failed.slice(0, MAX_LISTED_DROPPED).map((f) => (
                        <Text c="dimmed" key={`${f.trackName}:${f.reason}`} size="xs" ta="center">
                            {f.trackName}: {f.reason}
                        </Text>
                    ))}
                    {failed.length > MAX_LISTED_DROPPED && (
                        <Text c="dimmed" size="xs" ta="center">
                            …and {failed.length - MAX_LISTED_DROPPED} more
                        </Text>
                    )}
                </Stack>
            </SyncResult>
        );
    }

    // ── Tagging failed (tracks uploaded, import not started) ───────────────
    if (step === 'tagging-failed') {
        return (
            <SyncResult
                actionLabel="Finish Import"
                onAction={handleFinishImport}
                secondaryAction={
                    <Stack gap="xs">
                        <CopyButton
                            timeout={2000}
                            value={`Rekordbox upload: tagging failed (import not started)\n${error ?? ''}`}
                        >
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
                        <Button fullWidth onClick={handleBackToPreview} variant="default">
                            {t('common.back', { defaultValue: 'Back', postProcess: 'titleCase' })}
                        </Button>
                    </Stack>
                }
                status="warn"
                title="Tagging Failed"
            >
                <Text size="sm" ta="center">
                    Your tracks were uploaded, but the server couldn&apos;t finish preparing them
                    for import: {error}
                </Text>
                <Text c="dimmed" size="xs" ta="center">
                    Finish Import brings in what was prepared without uploading anything again.
                </Text>
            </SyncResult>
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
            // How far each pass got before it broke. This is the difference
            // between "the metadata pass died having done nothing" and "it did
            // four of five", and it is the first thing to ask of a bug report.
            ...(importProgress?.phases ?? []).map(
                (p) =>
                    `${p.phase}: ${p.ok} ok, ${p.skipped} skipped, ${p.failed} failed of ${p.total}`,
            ),
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
                {/* A failed job still did whatever it did before it broke, and
                    that is what decides whether to re-upload or just retry. */}
                <JobOutcome progress={importProgress} source="Rekordbox" />
                <Text c="dimmed" size="xs" ta="center">
                    {error}
                </Text>
            </SyncResult>
        );
    }

    // ── Done ───────────────────────────────────────────────────────────────
    // `skipped` counts upload failures too; split them out, because a failed upload
    // is a track (and its playlist entries) missing for a reason a retry can fix, and
    // a skip is a track that was not found locally or was already uploaded.
    const failedUploads = uploadResult?.failed ?? [];
    const otherSkipped = (uploadResult?.skipped ?? 0) - failedUploads.length;

    return (
        <SyncResult
            actionLabel={t('page.sync.rekordbox.syncAnother', {
                defaultValue: 'Sync Another Library',
                postProcess: 'titleCase',
            })}
            onAction={handleReset}
            status={failedUploads.length > 0 ? 'warn' : 'success'}
            title={
                failedUploads.length > 0
                    ? t('page.sync.rekordbox.uploadPartial', {
                          defaultValue: 'Uploaded, with problems',
                          postProcess: 'sentenceCase',
                      })
                    : t('page.sync.rekordbox.uploadComplete', {
                          defaultValue: 'Upload Complete',
                          postProcess: 'titleCase',
                      })
            }
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
                            {otherSkipped > 0 && (
                                <Text c="dimmed" size="sm">
                                    {otherSkipped} tracks skipped (file not found, or already
                                    uploaded)
                                </Text>
                            )}
                            {failedUploads.length > 0 && (
                                <Stack align="center" gap={2}>
                                    <Text size="sm" ta="center">
                                        {failedUploads.length}{' '}
                                        {failedUploads.length === 1 ? 'track' : 'tracks'} failed to
                                        upload. They are not in your library, so the playlists that
                                        contain them are missing those entries. Upload again to
                                        retry them.
                                    </Text>
                                    {failedUploads.slice(0, MAX_LISTED_DROPPED).map((f) => (
                                        <Text
                                            c="dimmed"
                                            key={`${f.trackName}:${f.reason}`}
                                            size="xs"
                                            ta="center"
                                        >
                                            {f.trackName}: {f.reason}
                                        </Text>
                                    ))}
                                    {failedUploads.length > MAX_LISTED_DROPPED && (
                                        <Text c="dimmed" size="xs" ta="center">
                                            …and {failedUploads.length - MAX_LISTED_DROPPED} more
                                        </Text>
                                    )}
                                </Stack>
                            )}
                            {importProgress && (
                                <Text size="sm">
                                    {importProgress.n_tracks_processed} tracks imported into library
                                </Text>
                            )}
                        </>
                    )}
                    {/* What the server says it did, and what it could not do.
                        "0 tracks uploaded, 0 tracks imported" is true of a
                        re-import that rewrote the metadata on every track, and
                        this is the only line on the screen that says so (#50). */}
                    <JobOutcome progress={importProgress} source="Rekordbox" />
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
