import isElectron from 'is-electron';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isUploadForbidden, PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { InviteLockedPanel } from '/@/renderer/features/invite/components/invite-locked-panel';
import { useCurrentServerWithCredential } from '/@/renderer/store';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Center } from '/@/shared/components/center/center';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { CopyButton } from '/@/shared/components/copy-button/copy-button';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
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

function crateKey(crate: CratePreview): string {
    return [...crate.path, crate.name].join(' / ');
}

export const SyncSerato = () => {
    const { t } = useTranslation();
    const currentServer = useCurrentServerWithCredential();

    const [step, setStep] = useState<SyncStep>('idle');
    const [seratoFolder, setSeratoFolder] = useState<null | string>(null);
    const [crates, setCrates] = useState<CratePreview[]>([]);
    const [selectedCrates, setSelectedCrates] = useState<Set<string>>(new Set());
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

    useEffect(() => {
        if (!ipc) return;
        const handler = (_event: any, prog: SeratoUploadProgress) => setProgress(prog);
        ipc.on('sync:serato-progress', handler);
        return () => {
            ipc.removeListener('sync:serato-progress', handler);
        };
    }, []);

    const parseFolder = useCallback(async (folder: string) => {
        if (!ipc) return;
        setSeratoFolder(folder);
        setStep('parsing');
        setError(null);
        try {
            const previews: CratePreview[] = await ipc.invoke('sync:parse-serato-crates', folder);
            if (previews.length === 0) {
                setError('No crates with tracks in them were found in that Serato library.');
                setStep('idle');
                return;
            }
            setCrates(previews);
            setSelectedCrates(new Set(previews.map(crateKey)));
            setStep('preview');
        } catch (err: any) {
            setError(err?.message || 'Failed to read the Serato library');
            setStep('idle');
        }
    }, []);

    // Offer the standard location straight away. Nearly every Serato user has their
    // library exactly there, and a preloaded folder turns the first screen from "go
    // find a hidden folder" into one button.
    useEffect(() => {
        if (!ipc) return;
        ipc.invoke('sync:get-default-serato-folder')
            .then((folder: null | string) => {
                if (folder) setSeratoFolder(folder);
            })
            .catch(() => {
                // No default is not a problem — the user can still pick one.
            });
    }, []);

    const handleSelectFolder = useCallback(async () => {
        if (!ipc) return;
        try {
            const folder: null | string = await ipc.invoke('sync:select-serato-folder');
            if (!folder) return;
            await parseFolder(folder);
        } catch (err: any) {
            setError(err?.message || 'Failed to open that folder');
            setStep('idle');
        }
    }, [parseFolder]);

    const handleUseDefaultFolder = useCallback(async () => {
        if (seratoFolder) await parseFolder(seratoFolder);
    }, [parseFolder, seratoFolder]);

    const handleToggleCrate = useCallback((key: string) => {
        setSelectedCrates((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    const handleSelectAll = useCallback(() => {
        setSelectedCrates(new Set(crates.map(crateKey)));
    }, [crates]);

    const handleSelectNone = useCallback(() => setSelectedCrates(new Set()), []);

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
    }, []);

    // A track can sit in several crates; count it once, the way the upload will.
    const totalSelectedTracks = new Set(
        crates.filter((c) => selectedCrates.has(crateKey(c))).flatMap((c) => c.trackKeys),
    ).size;

    // ── Idle: pick the library ─────────────────────────────────────────────
    if (step === 'idle') {
        return (
            <Center style={{ height: '100%' }}>
                <Stack align="center" gap="lg" maw={420}>
                    <Icon icon="disc" size="3rem" />
                    <TextTitle order={3}>
                        {t('page.sync.serato.title', {
                            defaultValue: 'Sync from Serato',
                            postProcess: 'titleCase',
                        })}
                    </TextTitle>
                    <Text c="dimmed" size="sm" ta="center">
                        {t('page.sync.serato.description', {
                            defaultValue:
                                'Sub-box reads your crates straight out of your Serato library and turns them into playlists, with your hot cues and loops. Quit Serato first — it rewrites its crate files when it closes.',
                        })}
                    </Text>
                    {error && (
                        <Text c="red" size="sm" ta="center">
                            {error}
                        </Text>
                    )}
                    {seratoFolder && (
                        <Stack align="center" gap="xs" w="100%">
                            <Text c="dimmed" size="xs" ta="center">
                                {seratoFolder}
                            </Text>
                            <Button fullWidth onClick={handleUseDefaultFolder} variant="filled">
                                {t('page.sync.serato.useDefault', {
                                    defaultValue: 'Read This Serato Library',
                                    postProcess: 'titleCase',
                                })}
                            </Button>
                        </Stack>
                    )}
                    <Button
                        fullWidth
                        onClick={handleSelectFolder}
                        tooltip={{
                            label: 'Pick your _Serato_ folder. It is normally inside your Music folder; if your library lives on an external drive, it is at the top level of that drive.',
                            multiline: true,
                            openDelay: 300,
                            w: 300,
                        }}
                        variant={seratoFolder ? 'subtle' : 'filled'}
                    >
                        {t('page.sync.serato.selectFolder', {
                            defaultValue: seratoFolder
                                ? 'Choose a Different Folder'
                                : 'Select Serato Folder',
                            postProcess: 'titleCase',
                        })}
                    </Button>
                </Stack>
            </Center>
        );
    }

    // ── Parsing ────────────────────────────────────────────────────────────
    if (step === 'parsing') {
        return (
            <Center style={{ height: '100%' }}>
                <Stack align="center" gap="md">
                    <Spinner />
                    <Text c="dimmed" size="sm">
                        {t('page.sync.serato.parsing', { defaultValue: 'Reading your crates...' })}
                    </Text>
                </Stack>
            </Center>
        );
    }

    // ── Preview: crate selection ───────────────────────────────────────────
    if (step === 'preview') {
        return (
            <Stack gap="md" p="xl" style={{ height: '100%', overflow: 'hidden' }}>
                <Group justify="space-between">
                    <TextTitle order={3}>
                        {t('page.sync.serato.previewTitle', {
                            defaultValue: 'Preview Changes',
                            postProcess: 'titleCase',
                        })}
                    </TextTitle>
                    <Button onClick={handleReset} size="sm" variant="subtle">
                        {t('common.back', { defaultValue: 'Back', postProcess: 'titleCase' })}
                    </Button>
                </Group>

                <Text c="dimmed" size="sm">
                    {seratoFolder}
                </Text>

                {error && (
                    <Text c="red" size="sm">
                        {error}
                    </Text>
                )}

                <Group gap="md">
                    <Badge size="lg" variant="light">
                        {crates.length} {crates.length === 1 ? 'crate' : 'crates'}
                    </Badge>
                    <Badge size="lg" variant="light">
                        {selectedCrates.size} selected
                    </Badge>
                    <Badge size="lg" variant="light">
                        {totalSelectedTracks} tracks
                    </Badge>
                </Group>

                <Group gap="xs">
                    <Button onClick={handleSelectAll} size="xs" variant="subtle">
                        Select all
                    </Button>
                    <Button onClick={handleSelectNone} size="xs" variant="subtle">
                        Select none
                    </Button>
                </Group>

                <Tooltip
                    label="Rebuild the playlists from your crates without uploading any audio. Tracks already in your library keep their place; anything else is left out."
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

                <Stack gap="xs" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                    {crates.map((crate) => {
                        const key = crateKey(crate);
                        return (
                            <Group
                                gap="md"
                                key={key}
                                onClick={() => handleToggleCrate(key)}
                                style={{
                                    borderRadius: 'var(--theme-radius-sm)',
                                    cursor: 'pointer',
                                    padding: 'var(--theme-spacing-xs) var(--theme-spacing-sm)',
                                }}
                            >
                                <Checkbox checked={selectedCrates.has(key)} readOnly size="sm" />
                                <Stack gap={2} style={{ flex: 1 }}>
                                    <Text fw={500} size="sm">
                                        {crate.path.length > 0 && (
                                            <Text c="dimmed" component="span" size="xs">
                                                {crate.path.join(' / ')} /{' '}
                                            </Text>
                                        )}
                                        {crate.name}
                                    </Text>
                                </Stack>
                                <Text c="dimmed" size="xs">
                                    {crate.trackCount} {crate.trackCount === 1 ? 'track' : 'tracks'}
                                </Text>
                            </Group>
                        );
                    })}
                </Stack>

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
                    {cratesOnly
                        ? t('page.sync.serato.importCratesOnly', {
                              defaultValue: 'Import Playlists Only',
                              postProcess: 'titleCase',
                          })
                        : t('page.sync.serato.uploadSelected', {
                              defaultValue: 'Upload Selected Crates',
                              postProcess: 'titleCase',
                          })}
                </Button>
            </Stack>
        );
    }

    // ── Uploading ──────────────────────────────────────────────────────────
    if (step === 'uploading') {
        const activeTracks = progress?.activeTracks ?? [];
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
            <Center style={{ height: '100%' }}>
                <Stack align="center" gap="md" maw={400}>
                    <Spinner />
                    <TextTitle order={4}>{phaseLabel}</TextTitle>
                    {activeTracks.map((track, idx) => (
                        <Text c="dimmed" key={`${idx}-${track}`} size="sm" ta="center">
                            {track}
                        </Text>
                    ))}
                    {activeTracks.length === 0 && progress?.currentTrack && (
                        <Text c="dimmed" size="sm" ta="center">
                            {progress.currentTrack}
                        </Text>
                    )}
                </Stack>
            </Center>
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
            <Center style={{ height: '100%' }}>
                <Stack align="center" gap="md" maw={400}>
                    <Spinner />
                    <TextTitle order={4}>{title}</TextTitle>
                    <Text size="sm">
                        {hasCounts ? `${counts} (${Math.round(pct)}%)` : `${Math.round(pct)}%`}
                    </Text>
                    <Text c="dimmed" size="xs" ta="center">
                        This may take a while for large libraries.
                    </Text>
                </Stack>
            </Center>
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
        const currentMB = storageInfo
            ? Math.round(storageInfo.currentUsageBytes / (1024 * 1024))
            : null;
        const maxMB = storageInfo ? Math.round(storageInfo.maxStorageBytes / (1024 * 1024)) : null;

        return (
            <Center style={{ height: '100%' }}>
                <Stack align="center" gap="md" maw={400}>
                    <Icon color="warn" icon="error" size="3rem" />
                    <TextTitle order={3}>
                        {t('page.sync.serato.storageLimitTitle', {
                            defaultValue: 'Storage Limit Reached',
                            postProcess: 'titleCase',
                        })}
                    </TextTitle>
                    <Text c="dimmed" size="sm" ta="center">
                        {error || 'Your upload would exceed your storage limit.'}
                    </Text>
                    <Text c="dimmed" size="sm" ta="center">
                        You can still tick “Playlists only” to rebuild your crates from the tracks
                        already in your library.
                    </Text>
                    {currentMB !== null && maxMB !== null && (
                        <Text size="sm" ta="center">
                            Current usage: {currentMB} MB / {maxMB} MB
                        </Text>
                    )}
                    <Button
                        component="a"
                        fullWidth
                        href={urlConfig.discord}
                        rel="noopener noreferrer"
                        target="_blank"
                        variant="filled"
                    >
                        {t('page.sync.serato.requestStorage', {
                            defaultValue: 'Request More Storage',
                            postProcess: 'titleCase',
                        })}
                    </Button>
                    <Button fullWidth onClick={handleReset} variant="subtle">
                        {t('common.back', { defaultValue: 'Back', postProcess: 'titleCase' })}
                    </Button>
                </Stack>
            </Center>
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
            <Center style={{ height: '100%' }}>
                <Stack align="center" gap="md" maw={400}>
                    <Icon color="warn" icon="error" size="3rem" />
                    <TextTitle order={3}>
                        {tracksAreSafe ? 'Imported, with problems' : 'Import Failed'}
                    </TextTitle>
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
                    <Button fullWidth onClick={handleReset} variant="filled">
                        {t('common.back', { defaultValue: 'Back', postProcess: 'titleCase' })}
                    </Button>
                </Stack>
            </Center>
        );
    }

    // ── Done ───────────────────────────────────────────────────────────────
    const dropped = uploadResult?.dropped ?? [];

    return (
        <Center style={{ height: '100%' }}>
            <Stack align="center" gap="md" maw={420}>
                <Icon color="success" icon="success" size="3rem" />
                <TextTitle order={3}>
                    {t('page.sync.serato.importComplete', {
                        defaultValue: 'Import Complete',
                        postProcess: 'titleCase',
                    })}
                </TextTitle>
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
                                    {dropped.length} {dropped.length === 1 ? 'track' : 'tracks'} in
                                    your crates could not be read from this computer
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
                <Button fullWidth onClick={handleReset} variant="filled">
                    {t('page.sync.serato.syncAnother', {
                        defaultValue: 'Sync Another Library',
                        postProcess: 'titleCase',
                    })}
                </Button>
            </Stack>
        </Center>
    );
};
