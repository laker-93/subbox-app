import { useSuspenseQuery } from '@tanstack/react-query';
import isElectron from 'is-electron';
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
import { TextInput } from '/@/shared/components/text-input/text-input';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';
import { useDisclosure } from '/@/shared/hooks/use-disclosure';
import { Playlist, PlaylistListSort, SortOrder } from '/@/shared/types/domain-types';

const ipc = isElectron() ? window.api.ipc : null;
const localSettings = isElectron() ? window.api.localSettings : null;

/** localSettings key holding the user-chosen folder for downloaded Rekordbox XML. */
const XML_DIRECTORY_KEY = 'rekordbox_xml_directory';

// The web build can't ask the OS where a download landed or where the user later
// extracts it — no browser exposes that path to a page (same reason Sync -> Upload
// (Rekordbox) is desktop-only). The Rekordbox XML's track Locations are only useful
// if they match wherever the user actually unzips music.zip, so ask them and persist
// the answer in localStorage (there's no window.api.localSettings on web) rather than
// silently sending pymix an empty user_root, which produced an XML that looked fine
// but couldn't resolve a single track (see laker-93/pymix#66 follow-up).
const WEB_EXTRACT_PATH_KEY = 'sync_web_extract_path';

type Step = 'done' | 'downloading' | 'planning' | 'preview' | 'select';

type SyncPlanResponse = z.infer<typeof pymixType._response.syncPlan>;

// The web build has no filesystem access, so a download has to happen inside the
// browser: fetch the file through pymix (which streams it back using the caller's
// own pymix session — see issue #66, where fetching straight from filebrowser
// required a filebrowser credential the `demo` account doesn't have for
// demoadmin's files) as a blob, then trigger the save from an object URL instead
// of the raw URL (a plain <a href> to a cross-origin URL can't carry the session
// cookie needed to authenticate the request).
const downloadFileFromPymix = async (pymixBaseUrl: string, filename: string): Promise<void> => {
    const blob = (await PymixController.downloadFile({
        baseUrl: pymixBaseUrl,
        filename,
        responseType: 'blob',
    })) as Blob;

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
};

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

type LocalTrack = {
    album?: string;
    artist: string;
    fileExtension?: string;
    fromTag: boolean;
    subboxId?: string;
    title: string;
};

export const SyncDownload = () => {
    const serverId = useCurrentServerId();
    const server = useCurrentServerWithCredential();

    const [step, setStep] = useState<Step>('select');
    const [selectedPlaylists, setSelectedPlaylists] = useState<Set<string>>(new Set());
    const [plan, setPlan] = useState<null | SyncPlanResponse>(null);
    const [error, setError] = useState<null | string>(null);
    const [activeTab, setActiveTab] = useState<'conflicts' | 'existing' | 'metadata' | 'missing'>(
        'missing',
    );
    const [downloadResult, setDownloadResult] = useState<null | {
        musicPath?: string;
        tracksExported: number;
        xmlPath?: string;
    }>(null);
    const [includeRekordboxXml, setIncludeRekordboxXml] = useState(true);
    const [xmlHelpOpened, xmlHelpHandlers] = useDisclosure(false);
    const [rekordboxHelpOpened, rekordboxHelpHandlers] = useDisclosure(false);
    // The folder the Rekordbox XML is saved to. `xmlDir` is the user's override
    // (persisted in localSettings); `defaultXmlDir` is where it lands otherwise.
    const [xmlDir, setXmlDir] = useState<null | string>(null);
    const [defaultXmlDir, setDefaultXmlDir] = useState<null | string>(null);
    // Web only: where the user says they'll extract music.zip, sent as the Rekordbox
    // XML's user_root so its track Locations point somewhere real.
    const [webExtractPath, setWebExtractPath] = useState('');

    // Load the persisted XML directory and the default fallback on mount (desktop only).
    useEffect(() => {
        if (!localSettings || !ipc) return;
        localSettings.get(XML_DIRECTORY_KEY).then((dir) => {
            if (typeof dir === 'string' && dir.length > 0) setXmlDir(dir);
        });
        ipc.invoke('sync:get-default-xml-directory').then((dir) => {
            if (typeof dir === 'string') setDefaultXmlDir(dir);
        });
    }, []);

    // Load the persisted extraction path on mount (web only).
    useEffect(() => {
        if (isElectron()) return;
        const saved = localStorage.getItem(WEB_EXTRACT_PATH_KEY);
        if (saved) setWebExtractPath(saved);
    }, []);

    const handleWebExtractPathChange = useCallback((value: string) => {
        setWebExtractPath(value);
        localStorage.setItem(WEB_EXTRACT_PATH_KEY, value);
    }, []);

    const handleSelectXmlDirectory = useCallback(async () => {
        if (!ipc || !localSettings) return;
        const dir = await ipc.invoke('sync:select-xml-directory');
        if (dir) {
            setXmlDir(dir);
            localSettings.set(XML_DIRECTORY_KEY, dir);
        }
    }, []);

    const handleResetXmlDirectory = useCallback(() => {
        if (!localSettings) return;
        setXmlDir(null);
        localSettings.set(XML_DIRECTORY_KEY, '');
    }, []);

    const handleOpenMusicFolder = useCallback(() => {
        if (!ipc || !downloadResult?.musicPath) return;
        ipc.invoke('sync:open-folder', downloadResult.musicPath);
    }, [downloadResult?.musicPath]);

    const handleRevealXml = useCallback(() => {
        if (!ipc || !downloadResult?.xmlPath) return;
        ipc.invoke('sync:reveal-file', downloadResult.xmlPath);
    }, [downloadResult?.xmlPath]);

    const getLocalTracks = useCallback(async (): Promise<LocalTrack[]> => {
        if (!isElectron()) return [];
        try {
            return (await window.api.ipc.invoke('sync:get-local-tracks')) as LocalTrack[];
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

    const playlists: Playlist[] = useMemo(
        () => playlistQuery.data?.items ?? [],
        [playlistQuery.data?.items],
    );

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
                console.log(
                    '[Subbox] Download (Electron) - selectedPlaylists:',
                    Array.from(selectedPlaylists),
                    'includeRekordboxXml:',
                    includeRekordboxXml,
                );
                const result = await window.api.ipc.invoke('sync:download-playlists', {
                    filebrowserToken: server.fbToken ?? '',
                    filebrowserUrl: urlConfig.filebrowser,
                    includeRekordboxXml,
                    playlistIds: Array.from(selectedPlaylists),
                    pymixUrl: urlConfig.pymix,
                    rekordboxXmlDir: xmlDir ?? '',
                    // Let the main process silently re-login to filebrowser if its
                    // token has expired by the time the download runs.
                    serverId: serverId ?? undefined,
                    username: server.username,
                });
                setDownloadResult(
                    result as { musicPath?: string; tracksExported: number; xmlPath?: string },
                );
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

                // pymix's zipPath omits the .zip extension (the actual file on disk
                // is "music.zip") — the Electron main-process download path already
                // accounts for this (path.basename(zipPath) + '.zip'); mirror it here.
                const zipFileName = `${result.zipPath.split('/').pop()}.zip`;
                await downloadFileFromPymix(urlConfig.pymix, zipFileName);

                // Optionally export and download Rekordbox XML
                if (includeRekordboxXml) {
                    console.log(
                        '[Subbox] rbDownload (web) - playlistIds:',
                        Array.from(selectedPlaylists),
                    );
                    await PymixController.rbDownload({
                        baseUrl: urlConfig.pymix,
                        body: {
                            playlistIds: Array.from(selectedPlaylists),
                            user_root: webExtractPath.trim(),
                        },
                    });

                    await downloadFileFromPymix(urlConfig.pymix, 'subbox_rb_export.xml');
                }

                setDownloadResult({ tracksExported: result.nTracksExported });
                setStep('done');
            }
        } catch (err: any) {
            toast.error({ message: err?.message || 'Download failed' });
            setError(err?.message || 'Download failed');
            setStep('preview');
        }
    }, [
        includeRekordboxXml,
        selectedPlaylists,
        server.fbToken,
        server.username,
        serverId,
        webExtractPath,
        xmlDir,
    ]);

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
                        Select playlists from your cloud library to preview a download plan. This
                        lets you sync from Subbox back into your DJ software — download the tracks
                        plus a Rekordbox XML and import your playlists straight into Rekordbox.
                    </Text>
                    <Group gap="xs">
                        <Button
                            leftSection={<Icon icon="info" />}
                            onClick={rekordboxHelpHandlers.open}
                            size="xs"
                            variant="default"
                        >
                            Sync to Rekordbox
                        </Button>
                    </Group>
                </Stack>

                {error && (
                    <Text c="red" size="sm">
                        {error}
                    </Text>
                )}

                <Modal
                    handlers={rekordboxHelpHandlers}
                    opened={rekordboxHelpOpened}
                    size="lg"
                    title="Syncing from Subbox to Rekordbox"
                >
                    <Stack gap="lg">
                        <Text size="sm">
                            Move your Subbox playlists back into Rekordbox by downloading the tracks
                            with a Rekordbox XML, then importing that XML into your collection.
                        </Text>
                        <Stack gap="md">
                            <Stack gap="xs">
                                <TextTitle order={5}>1. Select your playlists</TextTitle>
                                <Text size="sm">
                                    Tick the playlists from your Subbox cloud library that you want
                                    to bring into Rekordbox, then click Preview Download to see the
                                    plan.
                                </Text>
                            </Stack>
                            <Stack gap="xs">
                                <TextTitle order={5}>2. Download with the Rekordbox XML</TextTitle>
                                <Text size="sm">
                                    On the preview screen, make sure &quot;Include Rekordbox
                                    XML&quot; is ticked and click Download. This saves the tracks to
                                    your device along with a .xml file describing the playlists.
                                </Text>
                            </Stack>
                            <Stack gap="xs">
                                <TextTitle order={5}>3. Enable the XML View</TextTitle>
                                <Text size="sm">
                                    Open Rekordbox, go to Preferences (File &gt; Preferences), click
                                    the View tab, and ensure &quot;rekordbox xml&quot; is checked
                                    under the Layout section.
                                </Text>
                            </Stack>
                            <Stack gap="xs">
                                <TextTitle order={5}>4. Link your XML file</TextTitle>
                                <Text size="sm">
                                    In the same Preferences window, navigate to the Advanced tab.
                                    Under the Database section, find Imported Library and click the
                                    Browse button to locate and select your .xml file.
                                </Text>
                            </Stack>
                            <Stack gap="xs">
                                <TextTitle order={5}>5. Import to your collection</TextTitle>
                                <Text size="sm">
                                    Close the Preferences window. On the far left of your Rekordbox
                                    screen, click the newly appeared rekordbox xml icon. Click the
                                    little drop-down arrow/play button to refresh the file.
                                    Right-click your desired playlists and click Import Playlist to
                                    bring them into your primary Rekordbox collection.
                                </Text>
                            </Stack>
                        </Stack>
                    </Stack>
                </Modal>

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
                                    {pl.songCount ?? 0}{' '}
                                    {(pl.songCount ?? 0) === 1 ? 'track' : 'tracks'}
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
                    tooltip={{
                        label: 'See exactly what will be downloaded — which tracks are missing locally, which you already have, and the total download size — before anything is saved.',
                        multiline: true,
                        openDelay: 300,
                        w: 300,
                    }}
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
                    {isElectron() && (downloadResult?.musicPath || downloadResult?.xmlPath) && (
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

    // ── Preview plan ───────────────────────────────────────────────────────
    if (!plan) return null;

    const { metadata, summary, tracks } = plan;

    const tabs = [
        { count: tracks.missing.length, key: 'missing' as const, label: 'Missing' },
        { count: tracks.existing.length, key: 'existing' as const, label: 'Already Present' },
        { count: tracks.conflicts.length, key: 'conflicts' as const, label: 'Conflicts' },
        { count: metadata.updates.length, key: 'metadata' as const, label: 'Metadata Updates' },
    ];

    return (
        <Stack gap="md" p="xl" style={{ height: '100%', overflow: 'hidden' }}>
            <Group justify="space-between">
                <Group gap="xs">
                    <TextTitle order={3}>Download Preview</TextTitle>
                    <ActionIcon
                        icon="info"
                        iconProps={{ size: 'md' }}
                        onClick={xmlHelpHandlers.open}
                        size="sm"
                        tooltip={{ label: 'How to import the XML into Rekordbox' }}
                        variant="subtle"
                    />
                </Group>
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
                            <Text c="dimmed" size="sm">
                                No missing tracks — everything is already present locally.
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
                                No existing tracks found locally.
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

                {activeTab === 'metadata' && (
                    <Stack gap="xs">
                        {metadata.updates.length === 0 ? (
                            <Text c="dimmed" size="sm">
                                No metadata updates needed.
                            </Text>
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
                                        <Text fw={500} size="sm">
                                            {update.title}
                                        </Text>
                                        <Text c="dimmed" size="xs">
                                            {update.artist}
                                        </Text>
                                    </Stack>
                                    <Group gap={4}>
                                        {update.fields.map((field) => (
                                            <Badge
                                                color="violet"
                                                key={field}
                                                size="xs"
                                                variant="light"
                                            >
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

            <Group gap="xs" style={{ width: 'fit-content' }}>
                <Tooltip
                    label="Also create a Rekordbox XML alongside the tracks. Import that file into Rekordbox to recreate these playlists there — click the info icon for step-by-step instructions."
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

            {/* Where the Rekordbox XML is saved (desktop only) */}
            {isElectron() && includeRekordboxXml && (
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

            {/* Where the tracks will end up (web only) — the browser can't tell us
                this, so the Rekordbox XML's track locations depend on the user
                telling us where they'll extract music.zip. */}
            {!isElectron() && includeRekordboxXml && (
                <TextInput
                    description="Rekordbox needs this to find the tracks — the XML won't link them if it doesn't match where you actually unzip music.zip."
                    label="Folder you'll extract music.zip into"
                    onChange={(e) => handleWebExtractPathChange(e.currentTarget.value)}
                    placeholder="e.g. /Users/you/Music or C:\Users\you\Music"
                    value={webExtractPath}
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
                        After downloading, follow these steps to bring the exported playlists into
                        your Rekordbox collection.
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
                    </Stack>
                </Stack>
            </Modal>

            {error && (
                <Text c="red" size="sm">
                    {error}
                </Text>
            )}

            <Button
                disabled={
                    (summary.tracksMissing === 0 &&
                        metadata.updates.length === 0 &&
                        !includeRekordboxXml) ||
                    (!isElectron() && includeRekordboxXml && webExtractPath.trim().length === 0)
                }
                fullWidth
                onClick={handleDownload}
                size="md"
                tooltip={{
                    label: isElectron()
                        ? 'Download the missing tracks and save them into your local music folder, ready to use (plus a Rekordbox XML if ticked above).'
                        : 'Download the selected tracks as a zip file (plus a Rekordbox XML if ticked above) to this device.',
                    multiline: true,
                    openDelay: 300,
                    w: 300,
                }}
                variant="filled"
            >
                {isElectron() ? 'Download & Extract' : 'Download Zip'}
            </Button>
        </Stack>
    );
};
