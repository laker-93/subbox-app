import { useCallback, useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import isElectron from 'is-electron';
import { z } from 'zod';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import { useCurrentServerId, useCurrentServerWithCredential } from '/@/renderer/store';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Center } from '/@/shared/components/center/center';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Group } from '/@/shared/components/group/group';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { toast } from '/@/shared/components/toast/toast';
import {
    Playlist,
    PlaylistListSort,
    SortOrder,
} from '/@/shared/types/domain-types';
import { pymixType } from '/@/shared/api/pymix/pymix-types';

type SyncPlanResponse = z.infer<typeof pymixType._response.syncPlan>;

type Step = 'select' | 'planning' | 'preview' | 'downloading' | 'done';

const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

type LocalTrack = { album?: string; artist: string; title: string };

export const SyncDownload = () => {
    const serverId = useCurrentServerId();
    const server = useCurrentServerWithCredential();

    const [step, setStep] = useState<Step>('select');
    const [selectedPlaylists, setSelectedPlaylists] = useState<Set<string>>(new Set());
    const [plan, setPlan] = useState<SyncPlanResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'missing' | 'existing' | 'conflicts' | 'metadata'>('missing');
    const [downloadResult, setDownloadResult] = useState<{ tracksExported: number } | null>(null);

    const getLocalTracks = useCallback(async (): Promise<LocalTrack[]> => {
        if (!isElectron()) return [];
        try {
            return await window.api.ipc.invoke('sync:get-local-tracks') as LocalTrack[];
        } catch {
            return [];
        }
    }, []);

    const playlistQuery = useSuspenseQuery(
        playlistsQueries.list({
            query: {
                sortBy: PlaylistListSort.NAME,
                sortOrder: SortOrder.ASC,
                startIndex: 0,
            },
            serverId: serverId || '',
        }),
    );

    const playlists: Playlist[] = playlistQuery.data?.items ?? [];

    const handleTogglePlaylist = useCallback((id: string) => {
        setSelectedPlaylists((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const handleSelectAll = useCallback(() => {
        setSelectedPlaylists(new Set(playlists.map((p) => p.id)));
    }, [playlists]);

    const handleSelectNone = useCallback(() => {
        setSelectedPlaylists(new Set());
    }, []);

    const handleGetPlan = useCallback(async () => {
        if (selectedPlaylists.size === 0) return;

        setStep('planning');
        setError(null);

        try {
            const localTracks = await getLocalTracks();

            const result = await PymixController.syncPlan({
                baseUrl: urlConfig.pymix,
                body: {
                    direction: 'download',
                    localTracks,
                    options: {
                        fuzzyMatch: true,
                        includeMetadata: true,
                    },
                    playlists: Array.from(selectedPlaylists).map((id) => ({
                        id,
                        source: 'subbox',
                    })),
                },
            });

            setPlan(result as SyncPlanResponse);
            setStep('preview');
        } catch (err: any) {
            setError(err?.message || 'Failed to get sync plan');
            setStep('select');
        }
    }, [getLocalTracks, selectedPlaylists]);

    const handleBack = useCallback(() => {
        setStep('select');
        setPlan(null);
        setError(null);
        setDownloadResult(null);
    }, []);

    const handleDownload = useCallback(async () => {
        setStep('downloading');
        setError(null);

        try {
            if (isElectron()) {
                const result = await window.api.ipc.invoke('sync:download-playlists', {
                    filebrowserToken: server.fbToken ?? '',
                    filebrowserUrl: urlConfig.filebrowser,
                    playlistIds: Array.from(selectedPlaylists),
                    pymixUrl: urlConfig.pymix,
                });
                setDownloadResult(result as { tracksExported: number });
                setStep('done');
            } else {
                // Web: call syncPlaylists to get zipPath, then trigger browser download
                const result = await PymixController.syncPlaylists({
                    baseUrl: urlConfig.pymix,
                    body: {
                        direction: 'download',
                        localTracks: [],
                        options: {
                            fuzzyMatch: true,
                            includeMetadata: true,
                        },
                        playlists: Array.from(selectedPlaylists).map((id) => ({
                            id,
                            source: 'subbox',
                        })),
                    },
                });

                if (!result.success) {
                    throw new Error(result.reason || 'Sync failed');
                }

                const zipFileName = result.zipPath.split('/').pop();
                const downloadUrl = `${urlConfig.filebrowser}/api/raw/downloads/${zipFileName}`;

                // Trigger browser download via hidden anchor
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = zipFileName || 'music.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                setDownloadResult({ tracksExported: result.nTracksExported });
                setStep('done');
            }
        } catch (err: any) {
            toast.error({ message: err?.message || 'Download failed' });
            setError(err?.message || 'Download failed');
            setStep('preview');
        }
    }, [selectedPlaylists, server.fbToken]);

    // ── Select playlists ───────────────────────────────────────────────────
    if (step === 'select') {
        const totalSelectedTracks = playlists
            .filter((p) => selectedPlaylists.has(p.id))
            .reduce((sum, p) => sum + (p.songCount ?? 0), 0);

        return (
            <Stack gap="md" p="xl" style={{ height: '100%', overflow: 'auto' }}>
                <Stack gap="xs">
                    <TextTitle order={3}>Download Playlists</TextTitle>
                    <Text c="dimmed" size="sm">
                        Select playlists from your cloud library to preview a download plan.
                    </Text>
                </Stack>

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

                <ScrollArea style={{ flex: 1 }}>
                    <Stack gap="xs">
                        {playlists.map((pl) => (
                            <Group
                                gap="md"
                                key={pl.id}
                                onClick={() => handleTogglePlaylist(pl.id)}
                                style={{
                                    borderRadius: 'var(--theme-radius-sm)',
                                    cursor: 'pointer',
                                    padding: 'var(--theme-spacing-xs) var(--theme-spacing-sm)',
                                }}
                            >
                                <Checkbox
                                    checked={selectedPlaylists.has(pl.id)}
                                    readOnly
                                    size="sm"
                                />
                                <Text fw={500} size="sm" style={{ flex: 1 }}>
                                    {pl.name}
                                </Text>
                                <Text c="dimmed" size="xs">
                                    {pl.songCount ?? 0} {(pl.songCount ?? 0) === 1 ? 'track' : 'tracks'}
                                </Text>
                            </Group>
                        ))}
                    </Stack>
                </ScrollArea>

                <Button
                    disabled={selectedPlaylists.size === 0}
                    fullWidth
                    onClick={handleGetPlan}
                    size="md"
                    variant="filled"
                >
                    Preview Download
                </Button>
            </Stack>
        );
    }

    // ── Planning (loading) ─────────────────────────────────────────────────
    if (step === 'planning') {
        return (
            <Center style={{ height: '100%' }}>
                <Stack align="center" gap="md">
                    <Spinner />
                    <Text c="dimmed" size="sm">
                        Generating sync plan...
                    </Text>
                </Stack>
            </Center>
        );
    }

    // ── Downloading ────────────────────────────────────────────────────────
    if (step === 'downloading') {
        return (
            <Center style={{ height: '100%' }}>
                <Stack align="center" gap="md">
                    <Spinner />
                    <Text c="dimmed" size="sm">
                        {isElectron()
                            ? 'Downloading and extracting tracks...'
                            : 'Preparing download...'}
                    </Text>
                </Stack>
            </Center>
        );
    }

    // ── Done ───────────────────────────────────────────────────────────────
    if (step === 'done') {
        return (
            <Center style={{ height: '100%' }}>
                <Stack align="center" gap="md">
                    <TextTitle order={3}>Download Complete</TextTitle>
                    <Text c="dimmed" size="sm">
                        {downloadResult
                            ? `${downloadResult.tracksExported} track${downloadResult.tracksExported === 1 ? '' : 's'} exported.`
                            : 'Download finished.'}
                    </Text>
                    <Button onClick={handleBack} size="md" variant="filled">
                        Start Over
                    </Button>
                </Stack>
            </Center>
        );
    }

    // ── Preview plan ───────────────────────────────────────────────────────
    if (!plan) return null;

    const { summary, tracks, metadata } = plan;

    const tabs = [
        { count: tracks.missing.length, key: 'missing' as const, label: 'Missing' },
        { count: tracks.existing.length, key: 'existing' as const, label: 'Already Present' },
        { count: tracks.conflicts.length, key: 'conflicts' as const, label: 'Conflicts' },
        { count: metadata.updates.length, key: 'metadata' as const, label: 'Metadata Updates' },
    ];

    return (
        <Stack gap="md" p="xl" style={{ height: '100%', overflow: 'hidden' }}>
            <Group justify="space-between">
                <TextTitle order={3}>Download Preview</TextTitle>
                <Button onClick={handleBack} size="sm" variant="subtle">
                    Back
                </Button>
            </Group>

            {/* Summary badges */}
            <Group gap="sm" wrap="wrap">
                <Badge color="blue" size="lg" variant="light">
                    {summary.playlists} {summary.playlists === 1 ? 'playlist' : 'playlists'}
                </Badge>
                <Badge color="blue" size="lg" variant="light">
                    {summary.tracksRequested} tracks requested
                </Badge>
                <Badge color="green" size="lg" variant="light">
                    {summary.tracksAlreadyPresent} already present
                </Badge>
                <Badge color="orange" size="lg" variant="light">
                    {summary.tracksMissing} to download
                </Badge>
                {summary.metadataUpdates > 0 && (
                    <Badge color="violet" size="lg" variant="light">
                        {summary.metadataUpdates} metadata updates
                    </Badge>
                )}
                <Badge color="cyan" size="lg" variant="light">
                    {formatBytes(summary.downloadSizeBytes)} download
                </Badge>
            </Group>

            {/* Tab buttons */}
            <Group gap="xs">
                {tabs.map((tab) => (
                    <Button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        size="xs"
                        variant={activeTab === tab.key ? 'filled' : 'subtle'}
                    >
                        {tab.label} ({tab.count})
                    </Button>
                ))}
            </Group>

            {/* Tab content */}
            <ScrollArea style={{ flex: 1 }}>
                {activeTab === 'missing' && (
                    <Stack gap="xs">
                        {tracks.missing.length === 0 ? (
                            <Text c="dimmed" size="sm">No missing tracks — everything is already present locally.</Text>
                        ) : (
                            tracks.missing.map((track, i) => (
                                <Group
                                    gap="md"
                                    key={`${track.artist}-${track.title}-${i}`}
                                    style={{
                                        borderRadius: 'var(--theme-radius-sm)',
                                        padding: 'var(--theme-spacing-xs) var(--theme-spacing-sm)',
                                    }}
                                >
                                    <Stack gap={2} style={{ flex: 1 }}>
                                        <Text fw={500} size="sm">{track.title}</Text>
                                        <Text c="dimmed" size="xs">
                                            {track.artist}
                                            {track.album ? ` · ${track.album}` : ''}
                                        </Text>
                                    </Stack>
                                    <Group gap="xs">
                                        {track.duration != null && (
                                            <Text c="dimmed" size="xs">{formatDuration(track.duration)}</Text>
                                        )}
                                        {track.fileSize != null && (
                                            <Text c="dimmed" size="xs">{formatBytes(track.fileSize)}</Text>
                                        )}
                                    </Group>
                                </Group>
                            ))
                        )}
                    </Stack>
                )}

                {activeTab === 'existing' && (
                    <Stack gap="xs">
                        {tracks.existing.length === 0 ? (
                            <Text c="dimmed" size="sm">No existing tracks found locally.</Text>
                        ) : (
                            tracks.existing.map((track, i) => (
                                <Group
                                    gap="md"
                                    key={`${track.artist}-${track.title}-${i}`}
                                    style={{
                                        borderRadius: 'var(--theme-radius-sm)',
                                        padding: 'var(--theme-spacing-xs) var(--theme-spacing-sm)',
                                    }}
                                >
                                    <Stack gap={2} style={{ flex: 1 }}>
                                        <Text fw={500} size="sm">{track.title}</Text>
                                        <Text c="dimmed" size="xs">{track.artist}{track.album ? ` · ${track.album}` : ''}</Text>
                                    </Stack>
                                    <Badge color="green" size="sm" variant="light">{track.status}</Badge>
                                </Group>
                            ))
                        )}
                    </Stack>
                )}

                {activeTab === 'conflicts' && (
                    <Stack gap="xs">
                        {tracks.conflicts.length === 0 ? (
                            <Text c="dimmed" size="sm">No conflicts found.</Text>
                        ) : (
                            tracks.conflicts.map((track, i) => (
                                <Group
                                    gap="md"
                                    key={`${track.artist}-${track.title}-${i}`}
                                    style={{
                                        borderRadius: 'var(--theme-radius-sm)',
                                        padding: 'var(--theme-spacing-xs) var(--theme-spacing-sm)',
                                    }}
                                >
                                    <Stack gap={2} style={{ flex: 1 }}>
                                        <Text fw={500} size="sm">{track.title}</Text>
                                        <Text c="dimmed" size="xs">{track.artist}{track.album ? ` · ${track.album}` : ''}</Text>
                                    </Stack>
                                    <Stack align="flex-end" gap={2}>
                                        <Badge color="red" size="sm" variant="light">{track.status}</Badge>
                                        {track.reason && <Text c="dimmed" size="xs">{track.reason}</Text>}
                                    </Stack>
                                </Group>
                            ))
                        )}
                    </Stack>
                )}

                {activeTab === 'metadata' && (
                    <Stack gap="xs">
                        {metadata.updates.length === 0 ? (
                            <Text c="dimmed" size="sm">No metadata updates needed.</Text>
                        ) : (
                            metadata.updates.map((update, i) => (
                                <Group
                                    gap="md"
                                    key={`${update.artist}-${update.title}-${i}`}
                                    style={{
                                        borderRadius: 'var(--theme-radius-sm)',
                                        padding: 'var(--theme-spacing-xs) var(--theme-spacing-sm)',
                                    }}
                                >
                                    <Stack gap={2} style={{ flex: 1 }}>
                                        <Text fw={500} size="sm">{update.title}</Text>
                                        <Text c="dimmed" size="xs">{update.artist}</Text>
                                    </Stack>
                                    <Group gap={4}>
                                        {update.fields.map((field) => (
                                            <Badge color="violet" key={field} size="xs" variant="light">
                                                {field}
                                            </Badge>
                                        ))}
                                    </Group>
                                </Group>
                            ))
                        )}
                    </Stack>
                )}
            </ScrollArea>

            {error && (
                <Text c="red" size="sm">
                    {error}
                </Text>
            )}

            <Button
                disabled={summary.tracksMissing === 0 && metadata.updates.length === 0}
                fullWidth
                onClick={handleDownload}
                size="md"
                variant="filled"
            >
                {isElectron() ? 'Download & Extract' : 'Download Zip'}
            </Button>
        </Stack>
    );
};
