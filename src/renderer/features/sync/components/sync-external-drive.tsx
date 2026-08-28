import { useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import {
    DestinationPath,
    formatBytes,
    formatDuration,
    RekordboxImportSteps,
    SelectableList,
    SyncFlow,
    SyncLoading,
    SyncResult,
    SyncSummary,
    TrackRow,
    useSelection,
} from '/@/renderer/features/sync/components/shared';
import { useCurrentServerId, useCurrentServerWithCredential } from '/@/renderer/store';
import { pymixType } from '/@/shared/api/pymix/pymix-types';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Modal } from '/@/shared/components/modal/modal';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
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

export const SyncExternalDrive = () => {
    const serverId = useCurrentServerId();
    const server = useCurrentServerWithCredential();

    const [step, setStep] = useState<Step>('select');
    const [drivePath, setDrivePath] = useState<null | string>(null);
    const {
        selectAll,
        selected: selectedPlaylists,
        selectNone,
        toggle: handleTogglePlaylist,
    } = useSelection();
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

    const handleSelectAll = useCallback(() => {
        setAllTracks(false);
        selectAll([NOPLAYLIST_ID, ...playlists.map((p) => p.id)]);
    }, [playlists, selectAll]);

    const handleSelectNone = useCallback(() => {
        setAllTracks(false);
        selectNone();
    }, [selectNone]);

    const handleSelectAllTracks = useCallback(() => {
        setAllTracks(true);
        selectNone();
    }, [selectNone]);

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
                        against. You get a preview of the tracks in those playlists that aren&apos;t
                        on the drive. The drive folder is only read for this comparison: downloads
                        are saved to your Sub-box music folder, ready to add to Rekordbox and export
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

                {/* Playlist selector. NOPLAYLIST is a client-only virtual entry for
                    tracks in no playlist at all, so it rides in the list as an item
                    rather than as a control beside it. */}
                <SyncSummary
                    items={[
                        {
                            label: `${playlists.length} ${playlists.length === 1 ? 'playlist' : 'playlists'}`,
                        },
                        { label: `${selectedPlaylists.size} selected` },
                        { label: tracksLabel },
                    ]}
                />

                <SelectableList
                    items={[
                        {
                            detail: 'tracks not in any playlist',
                            id: NOPLAYLIST_ID,
                            label: 'NOPLAYLIST',
                        },
                        ...playlists.map((pl) => ({
                            detail: `${pl.songCount ?? 0} ${(pl.songCount ?? 0) === 1 ? 'track' : 'tracks'}`,
                            id: pl.id,
                            label: pl.name,
                        })),
                    ]}
                    onSelectAll={handleSelectAll}
                    onSelectNone={handleSelectNone}
                    onToggle={handleTogglePlaylist}
                    overriddenAll={allTracks}
                    scroll="area"
                    selected={selectedPlaylists}
                    toolbar={
                        <>
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
                        </>
                    }
                />

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
            <SyncLoading
                label={
                    step === 'scanning'
                        ? 'Scanning drive for audio tracks...'
                        : 'Comparing with server playlists...'
                }
            />
        );
    }

    // ── Downloading ────────────────────────────────────────────────────────
    if (step === 'downloading') {
        return <SyncLoading label="Downloading and extracting missing tracks..." />;
    }

    // ── Done ───────────────────────────────────────────────────────────────
    if (step === 'done') {
        return (
            <SyncResult
                action={
                    <Button onClick={handleBack} size="md" variant="filled">
                        Start Over
                    </Button>
                }
                title="Download Complete"
            >
                <Text c="dimmed" size="sm">
                    {downloadResult
                        ? `${downloadResult.tracksExported} track${
                              downloadResult.tracksExported === 1 ? '' : 's'
                          } downloaded to your Sub-box library.`
                        : 'Download finished.'}
                </Text>
                {(downloadResult?.musicPath || downloadResult?.xmlPath) && (
                    <Group gap="sm" justify="center" wrap="wrap">
                        {downloadResult?.musicPath && (
                            <Button
                                leftSection={<Icon icon="folder" />}
                                onClick={handleOpenMusicFolder}
                                size="sm"
                                tooltip={{ label: 'Open the folder your music was downloaded to' }}
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
            </SyncResult>
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
        <SyncFlow
            error={error}
            footer={
                <Button
                    disabled={plan.tracks.missing.length === 0 && !includeRekordboxXml}
                    fullWidth
                    onClick={handleDownload}
                    size="md"
                    tooltip={{
                        label: 'Download the missing tracks into your Sub-box library, ready to use (plus a Rekordbox XML if ticked above).',
                        multiline: true,
                        openDelay: 300,
                        w: 280,
                    }}
                    variant="filled"
                >
                    Download Missing Tracks
                </Button>
            }
            onBack={handleBack}
            subtitle={
                <Text c="dimmed" size="xs" style={{ wordBreak: 'break-all' }}>
                    Drive: {drivePath}
                </Text>
            }
            title="Comparison Preview"
        >
            <SyncSummary
                items={[
                    {
                        color: 'blue',
                        label: `${summary.playlists} ${summary.playlists === 1 ? 'playlist' : 'playlists'}`,
                    },
                    { color: 'blue', label: `${summary.tracksRequested} tracks requested` },
                    { color: 'green', label: `${summary.tracksAlreadyPresent} already on drive` },
                    { color: 'orange', label: `${summary.tracksMissing} missing from drive` },
                    ...(summary.downloadSizeBytes > 0
                        ? [
                              {
                                  color: 'cyan',
                                  label: `${formatBytes(summary.downloadSizeBytes)} missing`,
                              },
                          ]
                        : []),
                ]}
            />

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
                                <TrackRow
                                    album={track.album}
                                    artist={track.artist}
                                    detail={
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
                                    }
                                    key={`${track.artist}-${track.title}-${i}`}
                                    title={track.title}
                                />
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
                                <TrackRow
                                    album={track.album}
                                    artist={track.artist}
                                    detail={
                                        <Badge color="green" size="sm" variant="light">
                                            {track.status}
                                        </Badge>
                                    }
                                    key={`${track.artist}-${track.title}-${i}`}
                                    title={track.title}
                                />
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
                                <TrackRow
                                    album={track.album}
                                    artist={track.artist}
                                    detail={
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
                                    }
                                    key={`${track.artist}-${track.title}-${i}`}
                                    title={track.title}
                                />
                            ))
                        )}
                    </Stack>
                )}
            </ScrollArea>

            <Group gap="xs" style={{ width: 'fit-content' }}>
                <Tooltip
                    label="Also create a Rekordbox XML alongside the downloaded tracks, to bring these playlists into your collection. Click the info icon for the steps."
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
                <DestinationPath
                    emptyLabel="Default download folder"
                    extra={
                        xmlDir ? (
                            <Button onClick={handleResetXmlDirectory} size="xs" variant="subtle">
                                Reset to default
                            </Button>
                        ) : undefined
                    }
                    label="XML Folder"
                    onChoose={handleSelectXmlDirectory}
                    path={xmlDir ?? defaultXmlDir}
                    tooltip="Where the Rekordbox XML is saved. By default it goes alongside your downloaded tracks."
                />
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
                        your Rekordbox collection. Rekordbox matches tracks by file path, so any you
                        already have won&apos;t be duplicated.
                    </Text>
                    <Stack gap="md">
                        <RekordboxImportSteps />
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
        </SyncFlow>
    );
};
