import isElectron from 'is-electron';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isUploadForbidden, PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { InviteLockedPanel } from '/@/renderer/features/invite/components/invite-locked-panel';
import {
    DestinationPath,
    PathText,
    SelectableList,
    SyncFlow,
    SyncFlowFill,
    SyncLoading,
    SyncProgress,
    SyncResult,
    SyncSettingsButton,
    SyncSettingsModal,
    SyncStorageExceeded,
    SyncSummary,
    useSelection,
} from '/@/renderer/features/sync/components/shared';
import {
    useCurrentServerWithCredential,
    useSeratoFolder,
    useSetSeratoFolder,
} from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { CopyButton } from '/@/shared/components/copy-button/copy-button';
import { Icon } from '/@/shared/components/icon/icon';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';
import { useDisclosure } from '/@/shared/hooks/use-disclosure';

const ipc = isElectron() ? window.api.ipc : null;

type ImportPhase = 'applying_metadata' | 'complete' | 'importing_audio' | 'mapping_ids';

interface ImportProgress {
    in_progress: boolean;
    n_tracks_processed: number;
    n_tracks_to_process: number;
    percentage_complete: number;
    phase?: ImportPhase | null;
    phase_n_processed?: number;
    phase_n_total?: number;
    reason: string;
    result: boolean;
    /** Set on a job that finished but left crate entries out — see the done screen. */
    warnings?: null | string;
}

const IMPORT_PHASE_LABELS: Record<ImportPhase, string> = {
    applying_metadata: 'Applying cue points and metadata...',
    complete: 'Finishing up...',
    importing_audio: 'Importing into library...',
    mapping_ids: 'Linking tracks to your library...',
};

interface CratePreview {
    files: string[];
    name: string;
    path: string[];
    trackCount: number;
    trackKeys: string[];
}

interface SeratoUploadProgress {
    activeTracks?: string[];
    currentTrack: string;
    phase: 'checking' | 'done' | 'error' | 'identifying' | 'mapping-metadata' | 'uploading';
    total: number;
    uploaded: number;
}

interface SeratoUploadResult {
    dropped?: Array<{ reason: string; trackName: string }>;
    failed?: Array<{ reason: string; trackName: string }>;
    skipped: number;
    totalTracksInCrates: number;
    trackIdentities: Array<{ crate_path: string; subbox_id: string }>;
    uploaded: number;
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

/** Beyond this the full list is in the main-process log rather than pushing the
 *  "Sync Another Library" button off a narrow column. */
const MAX_LISTED_DROPPED = 5;

interface SyncSeratoProps {
    /**
     * The Rekordbox/Serato control, rendered on the first screen. Supplied by
     * `SyncUpload` rather than built here so both flows show the identical control in
     * the identical slot, and so switching it swaps this whole component out.
     */
    formatControl?: ReactNode;
}

function crateKey(crate: CratePreview): string {
    return [...crate.path, crate.name].join(' / ');
}

export const SyncSerato = ({ formatControl }: SyncSeratoProps) => {
    const { t } = useTranslation();
    const currentServer = useCurrentServerWithCredential();

    const [step, setStep] = useState<SyncStep>('idle');
    // Persisted, so the folder found once is still there next session -- and is the
    // same value Download's crate writer uses.
    const seratoFolder = useSeratoFolder();
    const setSeratoFolder = useSetSeratoFolder();
    const [crates, setCrates] = useState<CratePreview[]>([]);
    const {
        selectAll,
        selected: selectedCrates,
        selectNone,
        setSelected: setSelectedCrates,
        toggle: handleToggleCrate,
    } = useSelection();
    const [cratesOnly, setCratesOnly] = useState(false);
    const [progress, setProgress] = useState<null | SeratoUploadProgress>(null);
    const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
    const [jobId, setJobId] = useState<null | string>(null);
    const [uploadResult, setUploadResult] = useState<null | SeratoUploadResult>(null);
    const [error, setError] = useState<null | string>(null);
    const [storageInfo, setStorageInfo] = useState<null | {
        currentUsageBytes: number;
        maxStorageBytes: number;
    }>(null);
    const [settingsOpened, settingsHandlers] = useDisclosure(false);

    useEffect(() => {
        if (!ipc) return;
        const handler = (_event: any, prog: SeratoUploadProgress) => setProgress(prog);
        ipc.on('sync:serato-progress', handler);
        return () => {
            ipc.removeListener('sync:serato-progress', handler);
        };
    }, []);

    const parseFolder = useCallback(
        async (folder: string) => {
            if (!ipc) return;
            setSeratoFolder(folder);
            setStep('parsing');
            setError(null);
            try {
                const previews: CratePreview[] = await ipc.invoke(
                    'sync:parse-serato-crates',
                    folder,
                );
                if (previews.length === 0) {
                    setError('No crates with tracks in them were found in that Serato library.');
                    setStep('idle');
                    return;
                }
                setCrates(previews);
                selectAll(previews.map(crateKey));
                setStep('preview');
            } catch (err: any) {
                setError(err?.message || 'Failed to read the Serato library');
                setStep('idle');
            }
        },
        [selectAll, setSeratoFolder],
    );

    // Offer the standard location straight away. Nearly every Serato user has their
    // library exactly there, and a preloaded folder turns the first screen from "go
    // find a hidden folder" into one button. Only when nothing is remembered: a user
    // who has already pointed us somewhere else must not be dragged back to the
    // default every time the screen mounts.
    useEffect(() => {
        if (!ipc || seratoFolder) return;
        ipc.invoke('sync:get-default-serato-folder')
            .then((folder: null | string) => {
                if (folder) setSeratoFolder(folder);
            })
            .catch(() => {
                // No default is not a problem — the user can still pick one.
            });
        // Mount-only: this is a fallback for an empty setting, not a reaction to it
        // changing. Re-running when the user picks a folder would be a no-op at best.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Choosing a folder and reading it are two things now, because the chooser
    // lives behind the cog and the read is the screen's one button. Picking a
    // folder in a settings modal and having the app immediately walk off into a
    // parse would be a modal that does something.
    const handleChooseFolder = useCallback(async () => {
        if (!ipc) return;
        try {
            const folder: null | string = await ipc.invoke('sync:select-serato-folder');
            if (!folder) return;
            setSeratoFolder(folder);
            setError(null);
        } catch (err: any) {
            setError(err?.message || 'Failed to open that folder');
        }
    }, [setSeratoFolder]);

    const handleReadLibrary = useCallback(async () => {
        if (seratoFolder) await parseFolder(seratoFolder);
    }, [parseFolder, seratoFolder]);

    const handleSelectAll = useCallback(() => selectAll(crates.map(crateKey)), [crates, selectAll]);

    const handleUpload = useCallback(async () => {
        if (!ipc || !seratoFolder || !currentServer) return;

        setStep('uploading');
        setError(null);
        setUploadResult(null);
        setProgress(null);

        try {
            // Ask before reading tags off a few thousand files. This is the cheap,
            // approximate check — the main process does an exact one once it knows
            // how many of those tracks the library is actually missing.
            if (!cratesOnly) {
                try {
                    const storage = await PymixController.checkStorage({
                        baseUrl: urlConfig.pymix,
                        query: { uploadSizeBytes: 0 },
                    });
                    if (!storage.allowed) {
                        setStorageInfo({
                            currentUsageBytes: storage.currentUsageBytes,
                            maxStorageBytes: storage.maxStorageBytes,
                        });
                        setStep('storage-exceeded');
                        return;
                    }
                } catch (storageErr) {
                    // The main process checks again with a real figure; don't block on this.
                    console.warn(
                        '[storage-check] pre-flight threw — proceeding anyway:',
                        storageErr,
                    );
                }
            }

            const result: SeratoUploadResult = await ipc.invoke('sync:upload-from-crates', {
                crateKeys: crates
                    .filter((c) => selectedCrates.has(crateKey(c)))
                    .map((c) => [...c.path, c.name]),
                cratesOnly,
                filebrowserToken: currentServer.fbToken,
                filebrowserUrl: urlConfig.filebrowser,
                pymixUrl: urlConfig.pymix,
                seratoFolder,
                // serverId/username let the main process re-login for a fresh
                // filebrowser token or pymix cookie if this outlives the current one.
                serverId: currentServer.id,
                username: currentServer.username,
            });
            setUploadResult(result);

            try {
                // The manifest goes with the import, not with the upload: it is what
                // tells pymix which subbox track each crate entry means, and it covers
                // tracks that were already in the library as well as ones just sent.
                const importResult = await PymixController.seratoImport({
                    baseUrl: urlConfig.pymix,
                    body: { track_identities: result.trackIdentities },
                });

                const newJobId = importResult?.job_id;
                if (!newJobId) {
                    throw new Error(`Import failed: ${importResult?.reason || 'Unknown error'}`);
                }
                setJobId(newJobId);
                setStep('importing');
                setImportProgress(null);
            } catch (importErr: any) {
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
            const idx = msg.indexOf(storagePrefix);
            if (idx !== -1) {
                setError(msg.slice(idx + storagePrefix.length));
                setStep('storage-exceeded');
            } else {
                setError(msg);
                setStep('preview');
            }
        }
    }, [crates, cratesOnly, currentServer, selectedCrates, seratoFolder]);

    // Poll import progress. Same contract as the Rekordbox flow: the POST only
    // starts a job, so the job is the only thing that can say it finished.
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
                                message:
                                    prog.n_tracks_processed > 0
                                        ? `Imported ${prog.n_tracks_processed} tracks`
                                        : 'Your crates are now playlists in Sub-box',
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
        setCrates([]);
        setSelectedCrates(new Set());
        setProgress(null);
        setImportProgress(null);
        setJobId(null);
        setUploadResult(null);
        setError(null);
        setStorageInfo(null);
        setCratesOnly(false);
    }, [setSelectedCrates]);

    // A track can sit in several crates; count it once, the way the upload will.
    const totalSelectedTracks = new Set(
        crates.filter((c) => selectedCrates.has(crateKey(c))).flatMap((c) => c.trackKeys),
    ).size;

    // ── Idle: pick the library ─────────────────────────────────────────────
    if (step === 'idle') {
        return (
            // Titled, top-left, one full-width button at the bottom — the same page
            // as the Rekordbox screen beside it and the Download screens it leads to.
            // The folder chooser is behind the cog: it is set once and then right
            // forever, and as a second full-width button under the first it read as
            // half the screen's purpose.
            <SyncFlow
                error={error}
                footer={
                    <Button
                        disabled={!seratoFolder}
                        fullWidth
                        onClick={handleReadLibrary}
                        size="md"
                        tooltip={{
                            label: seratoFolder
                                ? 'Read the crates in this Serato library. Nothing is uploaded until you choose what to send on the next screen.'
                                : 'Choose your _Serato_ folder under the cog first.',
                            multiline: true,
                            openDelay: 300,
                            w: 300,
                        }}
                        variant="filled"
                    >
                        {t('page.sync.serato.readLibrary', {
                            defaultValue: 'Read Library',
                            postProcess: 'titleCase',
                        })}
                    </Button>
                }
                headerAction={<SyncSettingsButton onClick={settingsHandlers.open} />}
                subtitle={
                    <Text c="dimmed" size="sm">
                        {t('page.sync.serato.description', {
                            defaultValue:
                                'Sub-box reads the crates in your Serato library — your playlists and tracks, hot cues and all.',
                        })}
                    </Text>
                }
                title={t('page.sync.serato.title', {
                    defaultValue: 'Sync from Serato',
                    postProcess: 'titleCase',
                })}
            >
                {formatControl}

                {/* The path stays on the screen even though its chooser doesn't.
                    Which library is about to be read is the one thing the user has
                    to be able to check before clicking, and the default is found for
                    them — so it is an answer to confirm, not a setting to go open. */}
                <PathText
                    placeholder="No Serato library found — choose your _Serato_ folder under the cog"
                    value={seratoFolder}
                />

                {/* A condition on reading the library, so it sits by the button it
                    applies to rather than in the line that explains the screen. */}
                <Text c="dimmed" size="xs">
                    {t('page.sync.serato.quitFirst', {
                        defaultValue:
                            'Quit Serato first — it rewrites its crate files when it closes.',
                    })}
                </Text>

                <SyncFlowFill />

                <SyncSettingsModal
                    handlers={settingsHandlers}
                    opened={settingsOpened}
                    title="Upload Settings"
                >
                    <DestinationPath
                        emptyLabel="No _Serato_ folder found — choose one to read your crates"
                        label="Serato Folder"
                        onChoose={handleChooseFolder}
                        path={seratoFolder}
                        tooltip="The _Serato_ folder your crates are read from. Normally inside your Music folder; if your library lives on an external drive, it is at the top level of that drive."
                    />
                </SyncSettingsModal>
            </SyncFlow>
        );
    }

    // ── Parsing ────────────────────────────────────────────────────────────
    if (step === 'parsing') {
        return (
            <SyncLoading
                label={t('page.sync.serato.parsing', { defaultValue: 'Reading your crates...' })}
            />
        );
    }

    // ── Preview: crate selection ───────────────────────────────────────────
    if (step === 'preview') {
        return (
            <SyncFlow
                error={error}
                footer={
                    <Button
                        disabled={selectedCrates.size === 0}
                        fullWidth
                        onClick={handleUpload}
                        size="md"
                        style={{ flexShrink: 0 }}
                        tooltip={{
                            label: cratesOnly
                                ? 'Recreate the selected crates as playlists using tracks already in your library.'
                                : 'Upload the tracks in the selected crates that are not in your library yet, then recreate the crates as playlists.',
                            multiline: true,
                            openDelay: 300,
                            w: 300,
                        }}
                        variant="filled"
                    >
                        {/* One word in both modes, like the Rekordbox flow beside it. */}
                        {t('page.sync.serato.upload', {
                            defaultValue: 'Upload',
                            postProcess: 'titleCase',
                        })}
                    </Button>
                }
                onBack={handleReset}
                subtitle={
                    <Text c="dimmed" size="sm">
                        {seratoFolder}
                    </Text>
                }
                title={t('page.sync.serato.previewTitle', {
                    defaultValue: 'Preview Changes',
                    postProcess: 'titleCase',
                })}
            >
                <SyncSummary
                    items={[
                        { label: `${crates.length} ${crates.length === 1 ? 'crate' : 'crates'}` },
                        { label: `${selectedCrates.size} selected` },
                        { label: `${totalSelectedTracks} tracks` },
                    ]}
                />

                <SelectableList
                    items={crates.map((crate) => ({
                        detail: `${crate.trackCount} ${crate.trackCount === 1 ? 'track' : 'tracks'}`,
                        id: crateKey(crate),
                        label: crate.name,
                        prefix: crate.path.length > 0 ? `${crate.path.join(' / ')} / ` : undefined,
                    }))}
                    onSelectAll={handleSelectAll}
                    onSelectNone={selectNone}
                    onToggle={handleToggleCrate}
                    options={
                        <Tooltip
                            label="Rebuild the playlists from your crates without uploading any audio. Tracks you don't already have are left out."
                            multiline
                            openDelay={300}
                            position="right"
                            w={300}
                        >
                            <span style={{ width: 'fit-content' }}>
                                <Checkbox
                                    checked={cratesOnly}
                                    label="Playlists only (no track uploads)"
                                    onChange={(e) => setCratesOnly(e.currentTarget.checked)}
                                />
                            </span>
                        </Tooltip>
                    }
                    selected={selectedCrates}
                />
            </SyncFlow>
        );
    }

    // ── Uploading ──────────────────────────────────────────────────────────
    if (step === 'uploading') {
        const phaseLabel = progress
            ? {
                  checking: 'Checking what your library already has...',
                  done: 'Complete!',
                  error: 'Error',
                  identifying: `Identifying tracks (${progress.total})...`,
                  'mapping-metadata': 'Mapping metadata...',
                  uploading: `Uploading tracks (${Math.floor(progress.uploaded)}/${progress.total})...`,
              }[progress.phase]
            : 'Reading your crates...';

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
        const phaseTotal = importProgress?.phase_n_total ?? 0;
        const counts =
            phase === 'importing_audio' || phaseTotal === 0
                ? `${processed} / ${total} tracks`
                : `${importProgress?.phase_n_processed ?? 0} / ${phaseTotal} tracks`;
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
                description="Importing a Serato library writes to your collection, and this account can't. Your own Sub-box library imports your crates, hot cues and all."
                title="Serato import needs your own library"
            />
        );
    }

    // ── Storage exceeded ───────────────────────────────────────────────────
    if (step === 'storage-exceeded') {
        return (
            <SyncStorageExceeded
                error={error}
                note={
                    <Text c="dimmed" size="sm" ta="center">
                        You can still tick “Playlists only” to rebuild your crates from the tracks
                        already in your library.
                    </Text>
                }
                onBack={handleReset}
                storageInfo={storageInfo}
            />
        );
    }

    // ── Done (failed) ─────────────────────────────────────────────────────
    if (error) {
        // A job that died after the audio pass means the tracks are in the library and
        // only the playlists or metadata are missing — re-uploading would be the wrong
        // reaction to that.
        const failedPhase = importProgress?.phase;
        const tracksAreSafe = failedPhase === 'applying_metadata' || failedPhase === 'mapping_ids';

        const diagnostics = [
            `Serato import failed${tracksAreSafe ? ' (after tracks were imported)' : ''}`,
            `reason: ${error}`,
            jobId ? `job: ${jobId}` : null,
            failedPhase ? `phase: ${failedPhase}` : null,
            uploadResult ? `uploaded: ${uploadResult.uploaded}` : null,
            uploadResult ? `identified: ${uploadResult.trackIdentities.length}` : null,
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
                title={tracksAreSafe ? 'Imported, with problems' : 'Import Failed'}
            >
                <Text size="sm" ta="center">
                    {tracksAreSafe
                        ? 'Your tracks were uploaded and are in your library, but some playlists or cue points could not be applied. There is no need to upload them again.'
                        : 'The import did not finish, so some or all of your tracks may not be in your library. Check the Tracks page before uploading again.'}
                </Text>
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
    const dropped = uploadResult?.dropped ?? [];

    return (
        <SyncResult
            actionLabel={t('page.sync.serato.syncAnother', {
                defaultValue: 'Sync Another Library',
                postProcess: 'titleCase',
            })}
            maw={420}
            onAction={handleReset}
            status="success"
            title={t('page.sync.serato.importComplete', {
                defaultValue: 'Import Complete',
                postProcess: 'titleCase',
            })}
        >
            {uploadResult && (
                <Stack align="center" gap="xs">
                    <Text c="dimmed" size="sm">
                        {uploadResult.totalTracksInCrates} tracks in the crates you selected
                    </Text>
                    {uploadResult.uploaded > 0 && (
                        <Text size="sm">{uploadResult.uploaded} tracks uploaded</Text>
                    )}
                    {uploadResult.uploaded === 0 && (
                        <Text c="dimmed" size="sm">
                            Everything was already in your library.
                        </Text>
                    )}
                    {importProgress && importProgress.n_tracks_processed > 0 && (
                        <Text size="sm">
                            {importProgress.n_tracks_processed} tracks imported into library
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
                    {/* The server's own account of what it left out. A crate can
                        name a track that is in no state to be placed in a playlist,
                        and the job still succeeds — so this is the only place the
                        shortfall is ever explained. */}
                    {importProgress?.warnings && (
                        <Text c="dimmed" size="sm" ta="center">
                            {importProgress.warnings}
                        </Text>
                    )}
                    {dropped.length > 0 && (
                        <Stack align="center" gap={2}>
                            <Text c="dimmed" size="sm" ta="center">
                                {dropped.length} {dropped.length === 1 ? 'track' : 'tracks'} in your
                                crates could not be read from this computer
                            </Text>
                            {dropped.slice(0, MAX_LISTED_DROPPED).map((d) => (
                                <Text
                                    c="dimmed"
                                    key={`${d.trackName}:${d.reason}`}
                                    size="xs"
                                    ta="center"
                                >
                                    {d.trackName}: {d.reason}
                                </Text>
                            ))}
                            {dropped.length > MAX_LISTED_DROPPED && (
                                <Text c="dimmed" size="xs" ta="center">
                                    …and {dropped.length - MAX_LISTED_DROPPED} more
                                </Text>
                            )}
                        </Stack>
                    )}
                </Stack>
            )}
        </SyncResult>
    );
};
