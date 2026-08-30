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
    FormatSelect,
    RekordboxImportSteps,
    SelectableList,
    SeratoWriteSummary,
    SyncFlow,
    SyncLoading,
    SyncResult,
    SyncSettingsButton,
    SyncSettingsModal,
    SyncSummary,
    TrackRow,
    useSelection,
    useSeratoCrates,
} from '/@/renderer/features/sync/components/shared';
import {
    type LibraryFormat,
    useCurrentServerId,
    useCurrentServerWithCredential,
    useLibraryFormat,
    useSetLibraryFormat,
} from '/@/renderer/store';
import { pymixType } from '/@/shared/api/pymix/pymix-types';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Modal } from '/@/shared/components/modal/modal';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
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
    // Same question, same slot, same memory as Download: this is the download
    // direction too, so a DJ who picked Serato there finds Serato here. External
    // Drive is desktop-only (the tab is hidden on web), so unlike Download there is
    // no web pin to apply -- both formats are always reachable.
    const format: LibraryFormat = useLibraryFormat('download') ?? 'rekordbox';
    const setLibraryFormat = useSetLibraryFormat();
    // Derived, not stored. Two independent tick boxes are how the two halves of one
    // question drifted apart in the first place.
    const includeRekordboxXml = format === 'rekordbox';
    const {
        reset: resetSeratoResult,
        result: seratoResult,
        selectFolder: handleSelectSeratoFolder,
        seratoFolder,
        showFolder: handleShowSeratoFolder,
        writeCrates,
    } = useSeratoCrates();
    const [xmlHelpOpened, xmlHelpHandlers] = useDisclosure(false);
    // Where this screen's folders live now — same cog, same modal, same place as
    // on Download, which is the screen this one is a variation of.
    const [settingsOpened, settingsHandlers] = useDisclosure(false);
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
        resetSeratoResult();
    }, [resetSeratoResult]);

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

            // Crates alone, with nothing to fetch: pymix rejects a download of no
            // tracks and no XML, and rightly -- the crates are written from tracks
            // already on disk. An empty musicRoot means "wherever the app keeps its
            // music", which the main process is the side that knows.
            if (format === 'serato' && plan.tracks.missing.length === 0) {
                await writeCrates(playlistIds, '');
                setDownloadResult({ tracksExported: 0 });
                setStep('done');
                return;
            }

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

            const downloaded = result as {
                musicPath?: string;
                tracksExported: number;
                xmlPath?: string;
            };
            setDownloadResult(downloaded);

            // The Serato half of the same errand the XML does for Rekordbox: the
            // tracks are now in the local library, and this is what brings them into
            // the DJ software. Written after the audio, never before -- a crate names
            // paths, so one written first names files that aren't there yet.
            //
            // Crates go into the *local* _Serato_ library, not onto the drive, and
            // that is not a shortcut. Serato stores a track path relative to the
            // volume its _Serato_ folder is on, so a crate on the USB pointing at
            // tracks in the app's music folder is not expressible; the main process
            // refuses that combination rather than write crates that open empty.
            // The Rekordbox path works the same way -- an XML you import into
            // Rekordbox, which then exports to the USB itself.
            if (format === 'serato') {
                await writeCrates(playlistIds, downloaded.musicPath ?? '');
            }
            setStep('done');
        } catch (err: any) {
            toast.error({ message: err?.message || 'Download failed' });
            setError(err?.message || 'Download failed');
            setStep('preview');
        }
    }, [
        format,
        includeRekordboxXml,
        plan,
        selectedPlaylists,
        server.fbToken,
        server.username,
        serverId,
        writeCrates,
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
                        See which tracks from your playlists aren&apos;t on the drive yet. The drive
                        is only read — anything missing is downloaded to your Sub-box music folder,
                        and your DJ software exports it to the drive from there.
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
                {seratoResult && (
                    <SeratoWriteSummary
                        onShowFolder={handleShowSeratoFolder}
                        result={seratoResult}
                    />
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
                    // A format always produces a file, so "nothing missing" is no
                    // longer a dead end -- re-writing the XML or the crates for a
                    // drive that already has every track is a real thing to want.
                    // The only blocker left is Serato with nowhere to write to.
                    disabled={format === 'serato' && !seratoFolder}
                    fullWidth
                    onClick={handleDownload}
                    size="md"
                    tooltip={{
                        label:
                            format === 'serato' && !seratoFolder
                                ? 'Choose your _Serato_ folder above to write the crates into.'
                                : `Download the missing tracks into your Sub-box library, ready to use, and write ${format === 'rekordbox' ? 'a Rekordbox XML' : 'your Serato crates'}.`,
                        multiline: true,
                        openDelay: 300,
                        w: 280,
                    }}
                    variant="filled"
                >
                    Download
                </Button>
            }
            headerAction={
                <>
                    <ActionIcon
                        aria-label="Help"
                        icon="info"
                        iconProps={{ size: 'md' }}
                        onClick={xmlHelpHandlers.open}
                        size="sm"
                        tooltip={{
                            label:
                                format === 'rekordbox'
                                    ? 'How to import the XML into Rekordbox'
                                    : 'How these crates reach your drive',
                        }}
                        variant="subtle"
                    />
                    <SyncSettingsButton onClick={settingsHandlers.open} />
                </>
            }
            onBack={handleBack}
            subtitle={
                <Text c="dimmed" size="xs" style={{ wordBreak: 'break-all' }}>
                    Drive: {drivePath}
                </Text>
            }
            title="Comparison Preview"
        >
            {/* The format question, in the same slot it occupies on Download: alone,
                unlabelled, with the folders it implies behind the cog. */}
            <FormatSelect onChange={(next) => setLibraryFormat('download', next)} value={format} />

            {format === 'serato' && !seratoFolder && (
                <Text c="yellow" size="xs">
                    Choose your _Serato_ folder under the cog to write crates.
                </Text>
            )}

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

            <SyncSettingsModal
                handlers={settingsHandlers}
                opened={settingsOpened}
                title="Download Settings"
            >
                {includeRekordboxXml && (
                    <DestinationPath
                        emptyLabel="Default download folder"
                        extra={
                            xmlDir ? (
                                <Button
                                    onClick={handleResetXmlDirectory}
                                    size="xs"
                                    variant="subtle"
                                >
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

                {/* Where the crates go. Not optional when Serato is the format: without
                    a folder there is nothing to write, and the screen behind this says
                    so rather than leaving the dead button unexplained. */}
                {format === 'serato' && (
                    <DestinationPath
                        emptyLabel="No _Serato_ folder found — choose one to write crates"
                        label="Serato Folder"
                        onChoose={handleSelectSeratoFolder}
                        path={seratoFolder}
                        tooltip="The _Serato_ folder your crates are written into. It has to be on the same drive as your music, so this is normally the one in your Music folder — not one on the USB."
                    />
                )}
            </SyncSettingsModal>

            {/* Both routes end the same way: the tracks land in the local library and
                the DJ software does the export to the drive. Subbox tops up what the
                drive is missing; it does not write the drive itself. */}
            <Modal
                handlers={xmlHelpHandlers}
                opened={xmlHelpOpened}
                size="lg"
                title={
                    format === 'rekordbox'
                        ? 'Importing the XML into Rekordbox'
                        : 'Getting these crates onto your drive'
                }
            >
                <Stack gap="lg">
                    {format === 'rekordbox' ? (
                        <>
                            <Text size="sm">
                                After downloading, follow these steps to bring the compared
                                playlists into your Rekordbox collection. Rekordbox matches tracks
                                by file path, so any you already have won&apos;t be duplicated.
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
                        </>
                    ) : (
                        <>
                            <Text size="sm">
                                The missing tracks are downloaded into your Sub-box library and the
                                crates are written into your Serato library on this computer —
                                pointing at those tracks, with their cues.
                            </Text>
                            <Stack gap="md">
                                <Stack gap="xs">
                                    <TextTitle order={5}>1. Restart Serato</TextTitle>
                                    <Text size="sm">
                                        Serato reads its crates at startup, so the new ones appear
                                        once you reopen it.
                                    </Text>
                                </Stack>
                                <Stack gap="xs">
                                    <TextTitle order={5}>2. Export to your drive</TextTitle>
                                    <Text size="sm">
                                        Drag the crates onto your USB in Serato, as you normally
                                        would. Serato copies the audio across and writes a library
                                        on the drive itself — which is why the crates are written
                                        here rather than straight onto the USB: a crate&apos;s track
                                        paths are stored relative to the drive it lives on.
                                    </Text>
                                </Stack>
                            </Stack>
                        </>
                    )}
                </Stack>
            </Modal>
        </SyncFlow>
    );
};
