import { useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import { useCurrentServerId, useCurrentServerWithCredential } from '/@/renderer/store';
import { pymixType } from '/@/shared/api/pymix/pymix-types';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Center } from '/@/shared/components/center/center';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Modal } from '/@/shared/components/modal/modal';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';
import { useDisclosure } from '/@/shared/hooks/use-disclosure';
import { Playlist, PlaylistListSort, SortOrder } from '/@/shared/types/domain-types';

type Step = 'done' | 'downloading' | 'planning' | 'preview' | 'scanning' | 'select';

const NOPLAYLIST_ID = 'NOPLAYLIST';

/** localSettings key holding the user-chosen folder for downloaded Rekordbox XML.
 *  Shared with sync-download.tsx so the app has one XML output setting. */
const XML_DIRECTORY_KEY = 'rekordbox_xml_directory';

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
    const [downloadResult, setDownloadResult] = useState<null | {
        musicPath?: string;
        tracksExported: number;
        xmlPath?: string;
    }>(null);
    const [includeRekordboxXml, setIncludeRekordboxXml] = useState(true);
    const [xmlHelpOpened, xmlHelpHandlers] = useDisclosure(false);
    // The folder the Rekordbox XML is saved to. `xmlDir` is the user's override
    // (persisted in localSettings); `defaultXmlDir` is where it lands otherwise.
    const [xmlDir, setXmlDir] = useState<null | string>(null);
    const [defaultXmlDir, setDefaultXmlDir] = useState<null | string>(null);

    // Load the persisted XML directory and the default fallback on mount.
    useEffect(() => {
        window.api.localSettings.get(XML_DIRECTORY_KEY).then((dir) => {
            if (typeof dir === 'string' && dir.length > 0) setXmlDir(dir);
        });
        window.api.ipc.invoke('sync:get-default-xml-directory').then((dir) => {
            if (typeof dir === 'string') setDefaultXmlDir(dir);
        });
    }, []);

    const handleSelectXmlDirectory = useCallback(async () => {
        const dir = await window.api.ipc.invoke('sync:select-xml-directory');
        if (dir) {
            setXmlDir(dir as string);
            window.api.localSettings.set(XML_DIRECTORY_KEY, dir);
        }
    }, []);

    const handleResetXmlDirectory = useCallback(() => {
        setXmlDir(null);
        window.api.localSettings.set(XML_DIRECTORY_KEY, '');
    }, []);

    const handleOpenMusicFolder = useCallback(() => {
        if (!downloadResult?.musicPath) return;
        window.api.ipc.invoke('sync:open-folder', downloadResult.musicPath);
    }, [downloadResult]);

    const handleRevealXml = useCallback(() => {
        if (!downloadResult?.xmlPath) return;
        window.api.ipc.invoke('sync:reveal-file', downloadResult.xmlPath);
    }, [downloadResult]);

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
            const selected = (await window.api.ipc.invoke('sync:select-external-drive')) as
                | null
                | string;
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
        setSelectedPlaylists(new Set([NOPLAYLIST_ID, ...playlists.map((p) => p.id)]));
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
            )) as Array<{
                album?: string;
                artist: string;
                fileExtension?: string;
                fromTag: boolean;
                title: string;
            }>;

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
            // NOPLAYLIST is a client-only virtual entry (tracks not in any
            // playlist) — pymix's rekordbox export only understands real
            // playlist ids, so it's dropped here. An empty list exports every
            // playlist, which also covers the "All server tracks" selection.
            const playlistIds = Array.from(selectedPlaylists).filter((id) => id !== NOPLAYLIST_ID);

            const result = await window.api.ipc.invoke('sync:download-missing-tracks', {
                filebrowserToken: server.fbToken ?? '',
                filebrowserUrl: urlConfig.filebrowser,
                includeRekordboxXml,
                playlistIds,
                pymixUrl: urlConfig.pymix,
                rekordboxXmlDir: xmlDir ?? '',
                // Let the main process silently re-login to filebrowser if its
                // token has expired by the time the download runs.
                serverId: serverId ?? undefined,
                tracksToDownload: plan.tracks.missing.map((t) => ({
                    album: t.album,
                    artist: t.artist,
                    fromTag: true,
                    title: t.title,
                })),
                username: server.username,
            });

            setDownloadResult(
                result as { musicPath?: string; tracksExported: number; xmlPath?: string },
            );
            setStep('done');
        } catch (err: any) {
            toast.error({ message: err?.message || 'Download failed' });
            setError(err?.message || 'Download failed');
            setStep('preview');
        }
    }, [
        includeRekordboxXml,
        plan,
        selectedPlaylists,
        server.fbToken,
        server.username,
        serverId,
        xmlDir,
    ]);

    // ── Select drive + playlists ──────────────────────────────────────────
    if (step === 'select') {
        const noPlaylistSelected = selectedPlaylists.has(NOPLAYLIST_ID);

        const countedPlaylists = allTracks
            ? playlists
            : playlists.filter((p) => selectedPlaylists.has(p.id));

        const totalSelectedTracks = countedPlaylists.reduce(
            (sum, p) => sum + (p.songCount ?? 0),
            0,
        );
        const tracksLabel =
            noPlaylistSelected && !allTracks
                ? `${totalSelectedTracks}+ tracks`
                : `${totalSelectedTracks} tracks`;

        return (
            <Stack gap="md" p="xl" style={{ height: '100%', overflow: 'auto' }}>
                <Stack gap="xs">
                    <TextTitle order={3}>External Drive Comparison</TextTitle>
                    <Text c="dimmed" size="sm">
                        Select a folder on an external drive, then choose playlists to compare
                        against. Missing tracks — those in your playlists but not on the drive —
                        will be shown as a preview. The drive folder is only used for this
                        comparison: downloaded tracks are saved to your Subbox library, the same
                        place regular playlist downloads go, ready to add to Rekordbox and export
                        back to the drive from there.
                    </Text>
                </Stack>

                {/* Drive picker */}
                <Stack gap="xs">
                    <Text fw={500} size="sm">
                        Root folder
                    </Text>
                    <Group gap="sm">
                        <Button
                            onClick={handleSelectDrive}
                            size="sm"
                            tooltip={{
                                label: 'Pick the root folder on your USB or external drive that you want to load music onto.',
                                multiline: true,
                                openDelay: 300,
                                w: 280,
                            }}
                            variant="default"
                        >
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
                            {tracksLabel}
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
                            variant={
                                !allTracks &&
                                selectedPlaylists.has(NOPLAYLIST_ID) &&
                                selectedPlaylists.size === playlists.length + 1
                                    ? 'filled'
                                    : 'subtle'
                            }
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
                        {/* NOPLAYLIST virtual entry */}
                        <Group
                            gap="md"
                            onClick={() => !allTracks && handleTogglePlaylist(NOPLAYLIST_ID)}
                            style={{
                                borderRadius: 'var(--theme-radius-sm)',
                                cursor: allTracks ? 'default' : 'pointer',
                                opacity: allTracks ? 0.4 : 1,
                                padding: 'var(--theme-spacing-xs) var(--theme-spacing-sm)',
                            }}
                        >
                            <Checkbox
                                checked={allTracks || selectedPlaylists.has(NOPLAYLIST_ID)}
                                readOnly
                                size="sm"
                            />
                            <Text fw={500} size="sm" style={{ flex: 1 }}>
                                NOPLAYLIST
                            </Text>
                            <Text c="dimmed" size="xs">
                                tracks not in any playlist
                            </Text>
                        </Group>

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
                    tooltip={{
                        label: 'Check which of the selected tracks are not yet on the drive. Nothing is downloaded until you confirm on the next screen.',
                        multiline: true,
                        openDelay: 300,
                        w: 280,
                    }}
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
                              } downloaded to your Subbox library.`
                            : 'Download finished.'}
                    </Text>
                    {(downloadResult?.musicPath || downloadResult?.xmlPath) && (
                        <Group gap="sm" justify="center" wrap="wrap">
                            {downloadResult?.musicPath && (
                                <Button
                                    leftSection={<Icon icon="folder" />}
                                    onClick={handleOpenMusicFolder}
                                    size="sm"
                                    tooltip={{
                                        label: 'Open the folder your music was downloaded to',
                                    }}
                                    variant="default"
                                >
                                    Show Music
                                </Button>
                            )}
                            {downloadResult?.xmlPath && (
                                <Button
                                    leftSection={<Icon icon="folder" />}
                                    onClick={handleRevealXml}
                                    size="sm"
                                    tooltip={{
                                        label: 'Reveal the downloaded Rekordbox XML in its folder',
                                    }}
                                    variant="default"
                                >
                                    Show Rekordbox XML
                                </Button>
                            )}
                        </Group>
                    )}
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

            <Group gap="xs" style={{ width: 'fit-content' }}>
                <Tooltip
                    label="Also create a Rekordbox XML alongside the downloaded tracks. Import that file into Rekordbox to bring these playlists into your collection without hunting through the app's music folder — click the info icon for step-by-step instructions."
                    multiline
                    openDelay={300}
                    position="top-start"
                    w={300}
                >
                    <Group
                        gap="md"
                        onClick={() => setIncludeRekordboxXml((v) => !v)}
                        style={{ cursor: 'pointer', width: 'fit-content' }}
                    >
                        <Checkbox
                            checked={includeRekordboxXml}
                            label="Include Rekordbox XML"
                            readOnly
                            size="sm"
                        />
                    </Group>
                </Tooltip>
                <ActionIcon
                    icon="info"
                    iconProps={{ size: 'md' }}
                    onClick={xmlHelpHandlers.open}
                    size="sm"
                    tooltip={{ label: 'How to import the XML into Rekordbox' }}
                    variant="subtle"
                />
            </Group>

            {includeRekordboxXml && (
                <Stack gap={4}>
                    <Group gap="sm">
                        <Button
                            onClick={handleSelectXmlDirectory}
                            size="xs"
                            tooltip={{
                                label: 'Choose the folder the Rekordbox XML is saved to when you download. By default it is saved alongside your downloaded tracks.',
                                multiline: true,
                                openDelay: 300,
                                w: 300,
                            }}
                            variant="subtle"
                        >
                            {xmlDir ? 'Change XML Folder' : 'Choose XML Folder'}
                        </Button>
                        {xmlDir && (
                            <Button onClick={handleResetXmlDirectory} size="xs" variant="subtle">
                                Reset to default
                            </Button>
                        )}
                    </Group>
                    <Text c="dimmed" size="xs" style={{ fontFamily: 'monospace' }}>
                        {xmlDir ?? defaultXmlDir ?? 'Default download folder'}
                    </Text>
                </Stack>
            )}

            <Modal
                handlers={xmlHelpHandlers}
                opened={xmlHelpOpened}
                size="lg"
                title="Importing the XML into Rekordbox"
            >
                <Stack gap="lg">
                    <Text size="sm">
                        After downloading, follow these steps to bring the compared playlists into
                        your Rekordbox collection — Rekordbox matches tracks by file path, so any
                        you already have won&apos;t be duplicated.
                    </Text>
                    <Stack gap="md">
                        <Stack gap="xs">
                            <TextTitle order={5}>1. Enable the XML View</TextTitle>
                            <Text size="sm">
                                Open Rekordbox, go to Preferences (File &gt; Preferences), click the
                                View tab, and ensure &quot;rekordbox xml&quot; is checked under the
                                Layout section.
                            </Text>
                        </Stack>
                        <Stack gap="xs">
                            <TextTitle order={5}>2. Link Your XML File</TextTitle>
                            <Text size="sm">
                                In the same Preferences window, navigate to the Advanced tab. Under
                                the Database section, find Imported Library and click the Browse
                                button to locate and select your .xml file.
                            </Text>
                        </Stack>
                        <Stack gap="xs">
                            <TextTitle order={5}>3. Import to Collection</TextTitle>
                            <Text size="sm">
                                Close the Preferences window. On the far left of your Rekordbox
                                screen, click the newly appeared rekordbox xml icon. Click the
                                little drop-down arrow/play button to refresh the file. Right-click
                                your desired playlists and click Import Playlist to bring them into
                                your primary Rekordbox collection.
                            </Text>
                        </Stack>
                        <Stack gap="xs">
                            <TextTitle order={5}>4. Export to your drive</TextTitle>
                            <Text size="sm">
                                From your primary Rekordbox collection, export the imported
                                playlists to your USB/external drive as you normally would.
                            </Text>
                        </Stack>
                    </Stack>
                </Stack>
            </Modal>

            {error && (
                <Text c="red" size="sm">
                    {error}
                </Text>
            )}

            <Button
                disabled={plan.tracks.missing.length === 0 && !includeRekordboxXml}
                fullWidth
                onClick={handleDownload}
                size="md"
                tooltip={{
                    label: 'Download the missing tracks into your Subbox library, ready to use (plus a Rekordbox XML if ticked above).',
                    multiline: true,
                    openDelay: 300,
                    w: 280,
                }}
                variant="filled"
            >
                Download Missing Tracks
            </Button>
        </Stack>
    );
};
