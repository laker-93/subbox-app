import { useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import { useCurrentServerId, useCurrentServerWithCredential } from '/@/renderer/store';
import { pymixType } from '/@/shared/api/pymix/pymix-types';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Center } from '/@/shared/components/center/center';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Group } from '/@/shared/components/group/group';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { Playlist, PlaylistListSort, SortOrder } from '/@/shared/types/domain-types';

type Step = 'downloading' | 'done' | 'planning' | 'preview' | 'scanning' | 'select';

type SyncPlanResponse = z.infer<typeof pymixType._response.syncPlan>;

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

export const SyncExternalDrive = () => {
    const serverId = useCurrentServerId();
    const server = useCurrentServerWithCredential();

    const [step, setStep] = useState<Step>('select');
    const [drivePath, setDrivePath] = useState<null | string>(null);
    const [selectedPlaylists, setSelectedPlaylists] = useState<Set<string>>(new Set());
    const [allTracks, setAllTracks] = useState(false);
    const [plan, setPlan] = useState<null | SyncPlanResponse>(null);
    const [error, setError] = useState<null | string>(null);
    const [activeTab, setActiveTab] = useState<'conflicts' | 'existing' | 'missing'>('missing');
    const [downloadResult, setDownloadResult] = useState<null | { tracksExported: number }>(null);

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

    const playlists: Playlist[] = useMemo(
        () => playlistQuery.data?.items ?? [],
        [playlistQuery.data?.items],
    );

    const handleSelectDrive = useCallback(async () => {
        try {
            const selected = (await window.api.ipc.invoke(
                'sync:select-external-drive',
            )) as null | string;
            if (selected) setDrivePath(selected);
        } catch {
            // user cancelled or dialog failed — no-op
        }
    }, []);

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
        setAllTracks(false);
        setSelectedPlaylists(new Set(playlists.map((p) => p.id)));
    }, [playlists]);

    const handleSelectNone = useCallback(() => {
        setAllTracks(false);
        setSelectedPlaylists(new Set());
    }, []);

    const handleSelectAllTracks = useCallback(() => {
        setAllTracks(true);
        setSelectedPlaylists(new Set());
    }, []);

    const handleCompare = useCallback(async () => {
        if (!drivePath || (!allTracks && selectedPlaylists.size === 0)) return;

        setStep('scanning');
        setError(null);

        try {
            const driveTracks = (await window.api.ipc.invoke(
                'sync:scan-external-drive',
                drivePath,
            )) as Array<{ album?: string; artist: string; fileExtension?: string; fromTag: boolean; title: string }>;

            setStep('planning');

            const result = await PymixController.syncPlan({
                baseUrl: urlConfig.pymix,
                body: {
                    direction: 'download',
                    localTracks: driveTracks,
                    options: {
                        fuzzyMatch: true,
                        includeMetadata: false,
                    },
                    playlists: allTracks
                        ? null
                        : Array.from(selectedPlaylists).map((id) => ({
                              id,
                              source: 'subbox',
                          })),
                },
            });

            setPlan(result as SyncPlanResponse);
            setStep('preview');
        } catch (err: any) {
            setError(err?.message || 'Comparison failed');
            setStep('select');
        }
    }, [drivePath, selectedPlaylists, allTracks]);

    const handleBack = useCallback(() => {
        setStep('select');
        setPlan(null);
        setError(null);
        setDownloadResult(null);
    }, []);

    const handleDownload = useCallback(async () => {
        if (!plan) return;
        setStep('downloading');
        setError(null);

        try {
            const result = await window.api.ipc.invoke('sync:download-missing-tracks', {
                filebrowserToken: server.fbToken ?? '',
                filebrowserUrl: urlConfig.filebrowser,
                pymixUrl: urlConfig.pymix,
                tracksToDownload: plan.tracks.missing.map((t) => ({
                    album: t.album,
                    artist: t.artist,
                    fromTag: true,
                    title: t.title,
                })),
            });

            setDownloadResult(result as { tracksExported: number });
            setStep('done');
        } catch (err: any) {
            toast.error({ message: err?.message || 'Download failed' });
            setError(err?.message || 'Download failed');
            setStep('preview');
        }
    }, [plan, server.fbToken]);

    // ── Select drive + playlists ──────────────────────────────────────────
    if (step === 'select') {
        const totalSelectedTracks = allTracks
            ? playlists.reduce((sum, p) => sum + (p.songCount ?? 0), 0)
            : playlists
                  .filter((p) => selectedPlaylists.has(p.id))
                  .reduce((sum, p) => sum + (p.songCount ?? 0), 0);

        return (
            <Stack gap="md" p="xl" style={{ height: '100%', overflow: 'auto' }}>
                <Stack gap="xs">
                    <TextTitle order={3}>External Drive Comparison</TextTitle>
                    <Text c="dimmed" size="sm">
                        Select a folder on an external drive, then choose playlists to compare
                        against. Missing tracks — those in your playlists but not on the drive —
                        will be shown as a preview.
                    </Text>
                </Stack>

                {/* Drive picker */}
                <Stack gap="xs">
                    <Text fw={500} size="sm">
                        Root folder
                    </Text>
                    <Group gap="sm">
                        <Button onClick={handleSelectDrive} size="sm" variant="default">
                            {drivePath ? 'Change Folder' : 'Select Folder'}
                        </Button>
                        {drivePath && (
                            <Text c="dimmed" size="xs" style={{ wordBreak: 'break-all' }}>
                                {drivePath}
                            </Text>
                        )}
                    </Group>
                </Stack>

                {/* Playlist selector */}
                <Stack gap="xs">
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
                        <Button
                            onClick={handleSelectAllTracks}
                            size="xs"
                            variant={allTracks ? 'filled' : 'subtle'}
                        >
                            All server tracks
                        </Button>
                        <Button
                            onClick={handleSelectAll}
                            size="xs"
                            variant={!allTracks && selectedPlaylists.size === playlists.length && playlists.length > 0 ? 'filled' : 'subtle'}
                        >
                            Select all
                        </Button>
                        <Button onClick={handleSelectNone} size="xs" variant="subtle">
                            Select none
                        </Button>
                    </Group>
                </Stack>

                <ScrollArea style={{ flex: 1 }}>
                    <Stack gap="xs">
                        {playlists.map((pl) => (
                            <Group
                                gap="md"
                                key={pl.id}
                                onClick={() => !allTracks && handleTogglePlaylist(pl.id)}
                                style={{
                                    borderRadius: 'var(--theme-radius-sm)',
                                    cursor: allTracks ? 'default' : 'pointer',
                                    opacity: allTracks ? 0.4 : 1,
                                    padding: 'var(--theme-spacing-xs) var(--theme-spacing-sm)',
                                }}
                            >
                                <Checkbox
                                    checked={allTracks || selectedPlaylists.has(pl.id)}
                                    readOnly
                                    size="sm"
                                />
                                <Text fw={500} size="sm" style={{ flex: 1 }}>
                                    {pl.name}
                                </Text>
                                <Text c="dimmed" size="xs">
                                    {pl.songCount ?? 0}{' '}
                                    {(pl.songCount ?? 0) === 1 ? 'track' : 'tracks'}
                                </Text>
                            </Group>
                        ))}
                    </Stack>
                </ScrollArea>

                {error && (
                    <Text c="red" size="sm">
                        {error}
                    </Text>
                )}

                <Button
                    disabled={!drivePath || (!allTracks && selectedPlaylists.size === 0)}
                    fullWidth
                    onClick={handleCompare}
                    size="md"
                    variant="filled"
                >
                    Compare
                </Button>
            </Stack>
        );
    }

    // ── Scanning / Planning (loading) ─────────────────────────────────────
    if (step === 'scanning' || step === 'planning') {
        return (
            <Center style={{ height: '100%' }}>
                <Stack align="center" gap="md">
                    <Spinner />
                    <Text c="dimmed" size="sm">
                        {step === 'scanning'
                            ? 'Scanning drive for audio tracks...'
                            : 'Comparing with server playlists...'}
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
                        Downloading and extracting missing tracks...
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
                            ? `${downloadResult.tracksExported} track${
                                  downloadResult.tracksExported === 1 ? '' : 's'
                              } downloaded.`
                            : 'Download finished.'}
                    </Text>
                    <Button onClick={handleBack} size="md" variant="filled">
                        Start Over
                    </Button>
                </Stack>
            </Center>
        );
    }

    // ── Preview ───────────────────────────────────────────────────────────
    if (!plan) return null;

    const { summary, tracks } = plan;

    const tabs = [
        { count: tracks.missing.length, key: 'missing' as const, label: 'Missing from Drive' },
        { count: tracks.existing.length, key: 'existing' as const, label: 'Already on Drive' },
        { count: tracks.conflicts.length, key: 'conflicts' as const, label: 'Conflicts' },
    ];

    return (
        <Stack gap="md" p="xl" style={{ height: '100%', overflow: 'hidden' }}>
            <Group justify="space-between">
                <TextTitle order={3}>Comparison Preview</TextTitle>
                <Button onClick={handleBack} size="sm" variant="subtle">
                    Back
                </Button>
            </Group>

            <Text c="dimmed" size="xs" style={{ wordBreak: 'break-all' }}>
                Drive: {drivePath}
            </Text>

            {/* Summary badges */}
            <Group gap="sm" wrap="wrap">
                <Badge color="blue" size="lg" variant="light">
                    {summary.playlists} {summary.playlists === 1 ? 'playlist' : 'playlists'}
                </Badge>
                <Badge color="blue" size="lg" variant="light">
                    {summary.tracksRequested} tracks requested
                </Badge>
                <Badge color="green" size="lg" variant="light">
                    {summary.tracksAlreadyPresent} already on drive
                </Badge>
                <Badge color="orange" size="lg" variant="light">
                    {summary.tracksMissing} missing from drive
                </Badge>
                {summary.downloadSizeBytes > 0 && (
                    <Badge color="cyan" size="lg" variant="light">
                        {formatBytes(summary.downloadSizeBytes)} missing
                    </Badge>
                )}
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
                            <Text c="dimmed" size="sm">
                                All tracks are present on the drive.
                            </Text>
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
                                        <Text fw={500} size="sm">
                                            {track.title}
                                        </Text>
                                        <Text c="dimmed" size="xs">
                                            {track.artist}
                                            {track.album ? ` · ${track.album}` : ''}
                                        </Text>
                                    </Stack>
                                    <Group gap="xs">
                                        {track.duration != null && (
                                            <Text c="dimmed" size="xs">
                                                {formatDuration(track.duration)}
                                            </Text>
                                        )}
                                        {track.fileSize != null && (
                                            <Text c="dimmed" size="xs">
                                                {formatBytes(track.fileSize)}
                                            </Text>
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
                            <Text c="dimmed" size="sm">
                                No matching tracks found on the drive.
                            </Text>
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
                                        <Text fw={500} size="sm">
                                            {track.title}
                                        </Text>
                                        <Text c="dimmed" size="xs">
                                            {track.artist}
                                            {track.album ? ` · ${track.album}` : ''}
                                        </Text>
                                    </Stack>
                                    <Badge color="green" size="sm" variant="light">
                                        {track.status}
                                    </Badge>
                                </Group>
                            ))
                        )}
                    </Stack>
                )}

                {activeTab === 'conflicts' && (
                    <Stack gap="xs">
                        {tracks.conflicts.length === 0 ? (
                            <Text c="dimmed" size="sm">
                                No conflicts found.
                            </Text>
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
                                        <Text fw={500} size="sm">
                                            {track.title}
                                        </Text>
                                        <Text c="dimmed" size="xs">
                                            {track.artist}
                                            {track.album ? ` · ${track.album}` : ''}
                                        </Text>
                                    </Stack>
                                    <Stack align="flex-end" gap={2}>
                                        <Badge color="red" size="sm" variant="light">
                                            {track.status}
                                        </Badge>
                                        {track.reason && (
                                            <Text c="dimmed" size="xs">
                                                {track.reason}
                                            </Text>
                                        )}
                                    </Stack>
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
                disabled={plan.tracks.missing.length === 0}
                fullWidth
                onClick={handleDownload}
                size="md"
                variant="filled"
            >
                Download Missing Tracks
            </Button>
        </Stack>
    );
};
