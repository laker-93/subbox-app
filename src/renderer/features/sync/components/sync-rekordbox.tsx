import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import isElectron from 'is-electron';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { useCurrentServerWithCredential } from '/@/renderer/store';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Center } from '/@/shared/components/center/center';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { toast } from '/@/shared/components/toast/toast';

const ipc = isElectron() ? window.api.ipc : null;

function playlistKey(pl: PlaylistPreview): string {
    return [...pl.path, pl.name].join('/');
}

interface PlaylistPreview {
    name: string;
    path: string[];
    trackCount: number;
}

interface UploadProgress {
    currentTrack: string;
    phase: 'matching' | 'uploading' | 'mapping-metadata' | 'done' | 'error';
    total: number;
    uploaded: number;
}

interface ImportProgress {
    in_progress: boolean;
    n_tracks_processed: number;
    n_tracks_to_process: number;
    percentage_complete: number;
    reason: string;
    result: boolean;
}

type SyncStep = 'idle' | 'parsing' | 'preview' | 'uploading' | 'importing' | 'done' | 'storage-exceeded';

export const SyncRekordbox = () => {
    const { t } = useTranslation();
    const currentServer = useCurrentServerWithCredential();

    const [step, setStep] = useState<SyncStep>('idle');
    const [xmlPath, setXmlPath] = useState<string | null>(null);
    const [playlists, setPlaylists] = useState<PlaylistPreview[]>([]);
    const [selectedPlaylists, setSelectedPlaylists] = useState<Set<string>>(new Set());
    const [progress, setProgress] = useState<UploadProgress | null>(null);
    const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
    const [jobId, setJobId] = useState<string | null>(null);
    const [uploadResult, setUploadResult] = useState<{ skipped: number; uploaded: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [storageInfo, setStorageInfo] = useState<{
        currentUsageBytes: number;
        maxStorageBytes: number;
        remainingBytes: number;
    } | null>(null);

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

            const previews: PlaylistPreview[] = await ipc.invoke('sync:parse-rekordbox-xml', filePath);
            setPlaylists(previews);
            setSelectedPlaylists(new Set(previews.map((p) => playlistKey(p))));
            setStep('preview');
        } catch (err: any) {
            setError(err?.message || 'Failed to parse XML');
            setStep('idle');
        }
    }, []);

    const handleTogglePlaylist = useCallback((key: string) => {
        setSelectedPlaylists((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }, []);

    const handleSelectAll = useCallback(() => {
        setSelectedPlaylists(new Set(playlists.map((p) => playlistKey(p))));
    }, [playlists]);

    const handleSelectNone = useCallback(() => {
        setSelectedPlaylists(new Set());
    }, []);

    const handleUpload = useCallback(async () => {
        if (!ipc || !xmlPath || !currentServer) return;

        // Pre-flight storage check (renderer-side, works for both Electron and web)
        try {
            const storage = await PymixController.checkStorage({
                baseUrl: urlConfig.pymix,
                query: { uploadSizeBytes: 0 },
            });

            if (!storage.allowed) {
                setStorageInfo({
                    currentUsageBytes: storage.currentUsageBytes,
                    maxStorageBytes: storage.maxStorageBytes,
                    remainingBytes: storage.remainingBytes,
                });
                setStep('storage-exceeded');
                return;
            }
        } catch {
            // If the check fails, proceed anyway — the main process will do a precise check
        }

        setStep('uploading');
        setError(null);
        setUploadResult(null);

        try {
            const selectedPlaylistPaths = playlists
                .filter((p) => selectedPlaylists.has(playlistKey(p)))
                .map((p) => [...p.path, p.name]);

            const result = await ipc.invoke('sync:upload-from-xml', {
                filebrowserToken: currentServer.fbToken,
                filebrowserUrl: urlConfig.filebrowser,
                playlistNames: playlists
                    .filter((p) => selectedPlaylists.has(playlistKey(p)))
                    .map((p) => p.name),
                pymixUrl: urlConfig.pymix,
                username: currentServer.username,
                xmlPath,
            });
            console.log('Upload result:', result);

            setUploadResult(result);

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

                setJobId(jobId);
                setStep('importing');
                setImportProgress(null);
            } catch (importErr: any) {
                setError(importErr?.message || 'Import failed');
                setStep('done');
            }
        } catch (err: any) {
            const msg = err?.message || 'Upload failed';
            if (msg.startsWith('STORAGE_LIMIT_EXCEEDED:')) {
                setError(msg.slice('STORAGE_LIMIT_EXCEEDED:'.length));
                setStep('storage-exceeded');
            } else {
                setError(msg);
                setStep('preview');
            }
        }
    }, [xmlPath, currentServer, selectedPlaylists]);

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
                        toast.success({ message: `Imported ${prog.n_tracks_processed} tracks` });
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
    }, []);

    const totalSelectedTracks = playlists
        .filter((p) => selectedPlaylists.has(playlistKey(p)))
        .reduce((sum, p) => sum + p.trackCount, 0);

    // ── Idle: source selection ─────────────────────────────────────────────
    if (step === 'idle') {
        return (
            <Center style={{ height: '100%' }}>
                <Stack align="center" gap="lg" maw={400}>
                    <Icon icon="disc" size="3rem" />
                    <TextTitle order={3}>
                        {t('page.sync.rekordbox.title', {
                            defaultValue: 'Sync from Rekordbox',
                            postProcess: 'titleCase',
                        })}
                    </TextTitle>
                    <Text c="dimmed" size="sm" ta="center">
                        {t('page.sync.rekordbox.description', {
                            defaultValue: 'Select your Rekordbox XML export file to preview and upload playlists to your Subbox cloud library.',
                        })}
                    </Text>
                    {error && (
                        <Text c="red" size="sm">
                            {error}
                        </Text>
                    )}
                    <Button fullWidth onClick={handleSelectXml} variant="filled">
                        {t('page.sync.rekordbox.selectXml', {
                            defaultValue: 'Select XML File',
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
                        {t('page.sync.rekordbox.parsing', {
                            defaultValue: 'Parsing Rekordbox XML...',
                        })}
                    </Text>
                </Stack>
            </Center>
        );
    }

    // ── Preview: playlist selection ────────────────────────────────────────
    if (step === 'preview') {
        return (
            <Stack gap="md" p="xl" style={{ height: '100%', overflow: 'auto' }}>
                <Group justify="space-between">
                    <TextTitle order={3}>
                        {t('page.sync.rekordbox.previewTitle', {
                            defaultValue: 'Preview Changes',
                            postProcess: 'titleCase',
                        })}
                    </TextTitle>
                    <Button onClick={handleReset} size="sm" variant="subtle">
                        {t('common.back', { defaultValue: 'Back', postProcess: 'titleCase' })}
                    </Button>
                </Group>

                <Text c="dimmed" size="sm">
                    {xmlPath}
                </Text>

                {error && (
                    <Text c="red" size="sm">
                        {error}
                    </Text>
                )}

                <Group gap="md">
                    <Badge size="lg" variant="light">
                        {playlists.length} {playlists.length === 1 ? 'playlist' : 'playlists'}
                    </Badge>
                    <Badge size="lg" variant="light">
                        {selectedPlaylists.size} selected
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

                <Stack gap="xs">
                    {playlists.map((pl) => {
                        const key = playlistKey(pl);
                        return (
                        <Group
                            gap="md"
                            key={key}
                            style={{
                                borderRadius: 'var(--theme-radius-sm)',
                                cursor: 'pointer',
                                padding: 'var(--theme-spacing-xs) var(--theme-spacing-sm)',
                            }}
                            onClick={() => handleTogglePlaylist(key)}
                        >
                            <Checkbox
                                checked={selectedPlaylists.has(key)}
                                readOnly
                                size="sm"
                            />
                            <Stack gap={2} style={{ flex: 1 }}>
                                <Text size="sm" fw={500}>
                                    {pl.path.length > 0 && (
                                        <Text c="dimmed" component="span" size="xs">
                                            {pl.path.join(' / ')} /{' '}
                                        </Text>
                                    )}
                                    {pl.name}
                                </Text>
                            </Stack>
                            <Text c="dimmed" size="xs">
                                {pl.trackCount} {pl.trackCount === 1 ? 'track' : 'tracks'}
                            </Text>
                        </Group>
                        );
                    })}
                </Stack>

                <Button
                    disabled={selectedPlaylists.size === 0}
                    fullWidth
                    onClick={handleUpload}
                    size="md"
                    variant="filled"
                >
                    {t('page.sync.rekordbox.uploadSelected', {
                        defaultValue: 'Upload Selected Playlists',
                        postProcess: 'titleCase',
                    })}
                </Button>
            </Stack>
        );
    }

    // ── Uploading ──────────────────────────────────────────────────────────
    if (step === 'uploading') {
        const phaseLabel = progress
            ? {
                  'done': 'Complete!',
                  'error': 'Error',
                  'importing': 'Starting import...',
                  'mapping-metadata': 'Mapping metadata...',
                  'matching': 'Matching tracks with cloud library...',
                  'uploading': `Uploading tracks (${progress.uploaded}/${progress.total})...`,
              }[progress.phase]
            : 'Starting...';

        return (
            <Center style={{ height: '100%' }}>
                <Stack align="center" gap="md" maw={400}>
                    <Spinner />
                    <TextTitle order={4}>{phaseLabel}</TextTitle>
                    {progress?.currentTrack && (
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

        return (
            <Center style={{ height: '100%' }}>
                <Stack align="center" gap="md" maw={400}>
                    <Spinner />
                    <TextTitle order={4}>
                        Importing into library...
                    </TextTitle>
                    <Text size="sm">
                        {processed} / {total} tracks ({Math.round(pct)}%)
                    </Text>
                    <Text c="dimmed" size="xs" ta="center">
                        This may take a while for large libraries.
                    </Text>
                </Stack>
            </Center>
        );
    }

    // ── Storage Exceeded ───────────────────────────────────────────────────
    if (step === 'storage-exceeded') {
        const currentMB = storageInfo ? Math.round(storageInfo.currentUsageBytes / (1024 * 1024)) : null;
        const maxMB = storageInfo ? Math.round(storageInfo.maxStorageBytes / (1024 * 1024)) : null;

        return (
            <Center style={{ height: '100%' }}>
                <Stack align="center" gap="md" maw={400}>
                    <Icon color="warn" icon="error" size="3rem" />
                    <TextTitle order={3}>
                        {t('page.sync.rekordbox.storageLimitTitle', {
                            defaultValue: 'Storage Limit Reached',
                            postProcess: 'titleCase',
                        })}
                    </TextTitle>
                    <Text c="dimmed" size="sm" ta="center">
                        {error || t('page.sync.rekordbox.storageLimitDescription', {
                            defaultValue: 'Your upload would exceed your storage limit. To continue uploading, request more storage from the Subbox team.',
                        })}
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
                        {t('page.sync.rekordbox.requestStorage', {
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

    // ── Done ───────────────────────────────────────────────────────────────
    return (
        <Center style={{ height: '100%' }}>
            <Stack align="center" gap="md" maw={400}>
                <Icon color="success" icon="success" size="3rem" />
                <TextTitle order={3}>
                    {t('page.sync.rekordbox.uploadComplete', {
                        defaultValue: 'Upload Complete',
                        postProcess: 'titleCase',
                    })}
                </TextTitle>
                {uploadResult && (
                    <Stack align="center" gap="xs">
                        <Text size="sm">
                            {uploadResult.uploaded} tracks uploaded
                        </Text>
                        {uploadResult.skipped > 0 && (
                            <Text c="dimmed" size="sm">
                                {uploadResult.skipped} tracks skipped (files not found)
                            </Text>
                        )}
                        {importProgress && (
                            <Text size="sm">
                                {importProgress.n_tracks_processed} tracks imported into library
                            </Text>
                        )}
                    </Stack>
                )}
                <Button fullWidth onClick={handleReset} variant="filled">
                    {t('page.sync.rekordbox.syncAnother', {
                        defaultValue: 'Sync Another Library',
                        postProcess: 'titleCase',
                    })}
                </Button>
            </Stack>
        </Center>
    );
};
