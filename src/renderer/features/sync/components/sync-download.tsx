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

/**
 * The folder the export zip nests every track under. The zip's only top-level
 * entry, so extracting it into <folder> puts the tracks at <folder>/music/... —
 * which is what the XML's user_root has to be, not <folder> itself.
 *
 * Desktop gets this right for free: it sends getMusicPath() (= appPath/music) and
 * unzips into appPath. On web all we're told is the extraction folder, so the
 * `music` segment has to be added here — omitting it was the original bug, and it
 * fails silently, producing an XML whose every Location is one level too shallow.
 */
const ZIP_MUSIC_DIR = 'music';

/** localSettings key holding the user-chosen _Serato_ folder to write crates into. */
const SERATO_FOLDER_KEY = 'serato_folder';

/**
 * Turn the folder the user says they'll extract music.zip into, into the folder
 * the tracks will actually be in.
 *
 * Deliberately does NOT skip appending when the path already ends in `music` —
 * a user whose extraction folder is genuinely named `music` would then get a
 * wrong answer with no way to override it. The UI shows the resulting path
 * instead, so a mismatch is visible before the download.
 */
const musicRootFromExtractPath = (extractPath: string): string => {
    const trimmed = extractPath.trim();
    if (trimmed.length === 0) return '';
    // Windows paths use \, everything else /. Take the cue from what was typed;
    // a bare "C:" gets \ too, since a drive letter is only ever Windows.
    const separator = trimmed.includes('\\') || /^[a-z]:$/i.test(trimmed) ? '\\' : '/';
    return `${trimmed.replace(/[/\\]+$/, '')}${separator}${ZIP_MUSIC_DIR}`;
};

/**
 * What writing the Serato crates did, as the main process reports it.
 *
 * Mirrors SeratoExportResult in src/main/features/core/sync/serato.ts. The counts
 * that are *not* successes matter most here: a crate whose name had to change and
 * a track that wasn't on disk both change what the user finds in Serato, and both
 * are silent unless this screen says so.
 */
type SeratoWriteResult = {
    backupFolder: null | string;
    cratesWritten: number;
    cues: {
        alreadyCued: number;
        failed: Array<{ reason: string; trackName: string }>;
        unsupported: number;
        written: number;
    };
    missing: string[];
    renamed: Array<{ from: string; to: string }>;
    seratoFolder: string;
    tracksWritten: number;
};

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

/**
 * The name of the single file to fetch from pymix.
 *
 * pymix says which file it prepared; the zipPath fallback is for a server that
 * predates it, whose zipPath omits the .zip the file on disk actually has.
 */
const resolveDownloadFilename = (
    downloadFilename: null | string | undefined,
    zipPath: null | string | undefined,
): string => {
    if (downloadFilename) return downloadFilename;
    if (zipPath) return `${zipPath.split('/').pop()}.zip`;
    throw new Error('Sync did not return a file to download');
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
    // No 'conflicts' tab: pymix initialises tracks.conflicts as an empty list and
    // never appends to it, so it could only ever render "No conflicts found."
    const [activeTab, setActiveTab] = useState<'existing' | 'metadata' | 'missing'>('missing');
    const [downloadResult, setDownloadResult] = useState<null | {
        musicPath?: string;
        tracksExported: number;
        xmlPath?: string;
    }>(null);
    const [includeRekordboxXml, setIncludeRekordboxXml] = useState(true);
    // Serato crates are written on this machine, into the user's own library, so
    // this is desktop-only and off unless asked for — unlike the Rekordbox XML,
    // which is a new file in a folder of its own.
    const [includeSeratoCrates, setIncludeSeratoCrates] = useState(false);
    const [seratoFolder, setSeratoFolder] = useState<null | string>(null);
    const [seratoResult, setSeratoResult] = useState<null | SeratoWriteResult>(null);
    // Untick to take the Rekordbox XML on its own — for playlists whose audio the
    // user already has, where all they need is the metadata to import.
    const [includeTracks, setIncludeTracks] = useState(true);
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
        // The user's override wins; otherwise offer ~/Music/_Serato_ if it exists.
        // A null default is why the checkbox can't just assume a folder.
        localSettings.get(SERATO_FOLDER_KEY).then(async (dir) => {
            if (typeof dir === 'string' && dir.length > 0) {
                setSeratoFolder(dir);
                return;
            }
            const found = await ipc!.invoke('sync:get-default-serato-folder');
            if (typeof found === 'string') setSeratoFolder(found);
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

    const handleSelectSeratoFolder = useCallback(async () => {
        if (!ipc || !localSettings) return;
        try {
            const dir = await ipc.invoke('sync:select-serato-folder');
            if (dir) {
                setSeratoFolder(dir);
                localSettings.set(SERATO_FOLDER_KEY, dir);
            }
        } catch (err: any) {
            toast.error({ message: err?.message || 'Could not use that folder' });
        }
    }, []);

    const handleShowSeratoFolder = useCallback(() => {
        if (!ipc || !seratoResult?.seratoFolder) return;
        ipc.invoke('sync:open-folder', seratoResult.seratoFolder);
    }, [seratoResult?.seratoFolder]);

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
        setSeratoResult(null);
    }, []);

    /**
     * Ask pymix for the crate structure and write it into the user's Serato
     * library. Runs *after* the audio: a crate stores absolute paths, so writing
     * one before the files are there produces a crate full of missing tracks.
     * An empty musicRoot means "wherever the app keeps its music" — the main
     * process is the side that knows.
     */
    const writeSeratoCrates = useCallback(
        async (musicRoot: string) => {
            if (!includeSeratoCrates || !seratoFolder) return;
            const structure = await PymixController.seratoExport({
                baseUrl: urlConfig.pymix,
                body: { playlistIds: Array.from(selectedPlaylists) },
            });
            if (!structure.success) {
                throw new Error(structure.reason || 'Could not build the Serato export');
            }
            const written = (await window.api.ipc.invoke('sync:write-serato-crates', {
                crates: structure.crates,
                musicRoot,
                seratoFolder,
            })) as SeratoWriteResult;
            setSeratoResult(written);
        },
        [includeSeratoCrates, selectedPlaylists, seratoFolder],
    );

    const handleDownload = useCallback(async () => {
        setStep('downloading');
        setError(null);

        try {
            if (isElectron()) {
                // Crates alone: nothing to fetch, so nothing is fetched. pymix
                // would reject a download with neither tracks nor XML in it, and
                // rightly — the crates are written from tracks already on disk.
                if (!includeTracks && !includeRekordboxXml) {
                    await writeSeratoCrates('');
                    setDownloadResult({ tracksExported: 0 });
                    setStep('done');
                    return;
                }
                console.log(
                    '[Subbox] Download (Electron) - selectedPlaylists:',
                    Array.from(selectedPlaylists),
                    'includeTracks:',
                    includeTracks,
                    'includeRekordboxXml:',
                    includeRekordboxXml,
                );
                const result = await window.api.ipc.invoke('sync:download-playlists', {
                    filebrowserToken: server.fbToken ?? '',
                    filebrowserUrl: urlConfig.filebrowser,
                    includeRekordboxXml,
                    includeTracks,
                    playlistIds: Array.from(selectedPlaylists),
                    pymixUrl: urlConfig.pymix,
                    rekordboxXmlDir: xmlDir ?? '',
                    // Let the main process silently re-login to filebrowser if its
                    // token has expired by the time the download runs.
                    serverId: serverId ?? undefined,
                    username: server.username,
                });
                const downloaded = result as {
                    musicPath?: string;
                    tracksExported: number;
                    xmlPath?: string;
                };
                setDownloadResult(downloaded);

                // Serato crates are written after the audio, and only after: a
                // crate points at absolute paths, so writing one before the files
                // are there produces a crate full of missing tracks. This is the
                // reason the crate writing lives on the client at all — pymix
                // could only ever guess at these paths.
                await writeSeratoCrates(downloaded.musicPath ?? '');
                setStep('done');
            } else {
                // Web: one file, whatever the user asked for — the tracks zip with
                // the Rekordbox XML inside it, or the XML on its own. It has to be
                // one: a browser only reliably saves a single download per user
                // gesture, and the second was being dropped with no error, which is
                // how the XML went missing from every web download (pymix#118).
                const result = await PymixController.syncPlaylists({
                    baseUrl: urlConfig.pymix,
                    body: {
                        direction: 'download',
                        includeRekordboxXml,
                        includeTracks,
                        localTracks: [],
                        options: {
                            fuzzyMatch: true,
                            includeMetadata: true,
                        },
                        playlists: Array.from(selectedPlaylists).map((id) => ({
                            id,
                            source: 'subbox',
                        })),
                        // Only the zip nests tracks under music/. A metadata-only
                        // download ships no audio, so the path the user gave is
                        // already where their tracks are — appending would break it.
                        user_root: includeTracks
                            ? musicRootFromExtractPath(webExtractPath)
                            : webExtractPath.trim(),
                    },
                });

                if (!result.success) {
                    throw new Error(result.reason || 'Sync failed');
                }

                // A server that predates this ignores what we asked for and just
                // zips tracks, so say so rather than handing over a zip that's
                // missing the XML the user ticked (which is the bug this fixes).
                if (includeRekordboxXml && !result.xmlIncluded) {
                    throw new Error(
                        'This server is too old to include the Rekordbox XML in the download. Update pymix, or untick Include Rekordbox XML to download the tracks alone.',
                    );
                }

                await downloadFileFromPymix(
                    urlConfig.pymix,
                    resolveDownloadFilename(result.downloadFilename, result.zipPath),
                );

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
        includeTracks,
        selectedPlaylists,
        server.fbToken,
        server.username,
        serverId,
        webExtractPath,
        writeSeratoCrates,
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
                        Select playlists from your cloud library to preview a download plan.
                        Download the tracks with a Rekordbox XML, or write them straight into your
                        Serato library as crates.
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
                    title="Syncing from Sub-box to Rekordbox"
                >
                    <Stack gap="lg">
                        <Text size="sm">
                            Move your Sub-box playlists back into Rekordbox by downloading the
                            tracks with a Rekordbox XML, then importing that XML into your
                            collection.
                        </Text>
                        <Stack gap="md">
                            <Stack gap="xs">
                                <TextTitle order={5}>1. Select your playlists</TextTitle>
                                <Text size="sm">
                                    Tick the playlists from your Sub-box cloud library that you want
                                    to bring into Rekordbox, then click Preview Download to see the
                                    plan.
                                </Text>
                            </Stack>
                            <Stack gap="xs">
                                <TextTitle order={5}>2. Download with the Rekordbox XML</TextTitle>
                                <Text size="sm">
                                    {isElectron()
                                        ? 'On the preview screen, make sure "Include Rekordbox XML" is ticked and click Download. This saves the tracks to your music folder and the .xml describing the playlists to your chosen XML folder.'
                                        : `On the preview screen, make sure "Include Rekordbox XML" is ticked, enter the folder you'll extract into, and click Download. You get one zip containing a single music folder, with subbox_rb_export.xml inside it. If you already have these tracks, untick "Include tracks" to download just the .xml.`}
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
                        label: isElectron()
                            ? 'Before anything is saved, see which tracks are missing locally, which you already have, and the total download size.'
                            : 'Before anything is saved, see every track that goes in the zip and the total download size.',
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
                        {!includeTracks
                            ? 'Preparing your Rekordbox XML...'
                            : isElectron()
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
                        {!includeTracks
                            ? 'Rekordbox XML downloaded. No audio files, as requested.'
                            : downloadResult
                              ? `${downloadResult.tracksExported} track${downloadResult.tracksExported === 1 ? '' : 's'} exported${
                                    includeRekordboxXml
                                        ? isElectron()
                                            ? ', with a Rekordbox XML saved alongside them'
                                            : ", with subbox_rb_export.xml inside the zip's music folder"
                                        : ''
                                }.`
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
                    {seratoResult && (
                        <Stack align="center" gap={4}>
                            <Text size="sm">
                                {`${seratoResult.cratesWritten} Serato crate${seratoResult.cratesWritten === 1 ? '' : 's'} written with ${seratoResult.tracksWritten} track${seratoResult.tracksWritten === 1 ? '' : 's'}.`}
                            </Text>
                            {seratoResult.cues.written > 0 && (
                                <Text c="dimmed" size="xs">
                                    {`Cues written into ${seratoResult.cues.written} track${seratoResult.cues.written === 1 ? '' : 's'}.`}
                                </Text>
                            )}
                            {/* Not a failure, and worth saying out loud: subbox
                                deliberately never overwrites cues you already have. */}
                            {seratoResult.cues.alreadyCued > 0 && (
                                <Text c="dimmed" size="xs">
                                    {`${seratoResult.cues.alreadyCued} track${seratoResult.cues.alreadyCued === 1 ? ' already had' : 's already had'} cues in Serato and ${seratoResult.cues.alreadyCued === 1 ? 'was' : 'were'} left untouched.`}
                                </Text>
                            )}
                            {seratoResult.renamed.length > 0 && (
                                <Text c="yellow" size="xs">
                                    {`Renamed to fit a filename: ${seratoResult.renamed
                                        .map((r) => `${r.from} → ${r.to}`)
                                        .join(', ')}`}
                                </Text>
                            )}
                            {seratoResult.missing.length > 0 && (
                                <Text c="yellow" size="xs">
                                    {`${seratoResult.missing.length} track${seratoResult.missing.length === 1 ? ' was' : 's were'} not on disk and left out of the crates.`}
                                </Text>
                            )}
                            {seratoResult.backupFolder && (
                                <Text c="dimmed" size="xs">
                                    {`Crates that were replaced were backed up to ${seratoResult.backupFolder}`}
                                </Text>
                            )}
                            <Text c="dimmed" size="xs">
                                Restart Serato to see them.
                            </Text>
                            <Button
                                leftSection={<Icon icon="folder" />}
                                onClick={handleShowSeratoFolder}
                                size="xs"
                                variant="default"
                            >
                                Show Serato Folder
                            </Button>
                        </Stack>
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

    // The web build can't read the user's disk, so it asks /sync/plan for a plan with
    // an empty localTracks list. pymix then has nothing to match server tracks
    // against, which fixes the whole classification: `existing` is always empty,
    // `tracksAlreadyPresent` is always 0, and `missing` is always every requested
    // track — so "N to download" only restates "N requested", and the Already Present
    // tab can only ever say "no existing tracks found locally".
    //
    // The plan is still worth fetching on web for its server-side file sizes (the
    // download-size badge is the one number a browser user actually needs before
    // pulling a zip), but it describes the zip's contents rather than a diff. So on
    // web this screen is a manifest: no tabs, no diff badges, just what's in the file.
    const isWeb = !isElectron();

    const writingSeratoCrates = includeSeratoCrates && Boolean(seratoFolder);

    // One button, whose wording follows what the tick boxes below put in the file.
    const downloadButtonLabel = !includeTracks
        ? includeRekordboxXml
            ? 'Download Rekordbox XML'
            : 'Write Serato Crates'
        : isElectron()
          ? 'Download & Extract'
          : 'Download Zip';
    const downloadButtonTooltip = !includeTracks
        ? includeRekordboxXml
            ? 'Download just the Rekordbox XML for these playlists, with no audio files.'
            : 'Write these playlists into your Serato library, pointing at tracks you already have.'
        : isElectron()
          ? 'Save the missing tracks into your local music folder, plus a Rekordbox XML if ticked above.'
          : 'Download the selected tracks as one zip, with a Rekordbox XML inside if ticked above.';

    const tabs = [
        { count: tracks.missing.length, key: 'missing' as const, label: 'Missing' },
        { count: tracks.existing.length, key: 'existing' as const, label: 'Already Present' },
        { count: metadata.updates.length, key: 'metadata' as const, label: 'Metadata Updates' },
    ];

    // Shared by both layouts: the desktop plan's "Missing" tab and the web manifest
    // are the same list of tracks, described differently.
    const missingTrackList = (
        <Stack gap="xs">
            {tracks.missing.length === 0 ? (
                <Text c="dimmed" size="sm">
                    {isWeb
                        ? 'These playlists have no tracks to download.'
                        : 'No missing tracks. Everything is already present locally.'}
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
    );

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

            {/* Summary badges. The already-present / to-download / metadata-updates
                counts are a diff against the local library, which only exists on
                desktop — on web they are fixed at 0 / everything / a copy of the
                missing list, so they're left out rather than shown as noise. */}
            <Group gap="sm" wrap="wrap">
                <Badge color="blue" size="lg" variant="light">
                    {summary.playlists} {summary.playlists === 1 ? 'playlist' : 'playlists'}
                </Badge>
                <Badge color="blue" size="lg" variant="light">
                    {summary.tracksRequested}{' '}
                    {isWeb
                        ? summary.tracksRequested === 1
                            ? 'track'
                            : 'tracks'
                        : 'tracks requested'}
                </Badge>
                {!isWeb && (
                    <>
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
                    </>
                )}
                <Badge color="cyan" size="lg" variant="light">
                    {formatBytes(summary.downloadSizeBytes)} download
                </Badge>
            </Group>

            {/* Tab buttons (desktop only — on web there is only one non-empty list) */}
            {isWeb ? (
                <Text c="dimmed" size="sm">
                    {includeTracks
                        ? 'Tracks in this download'
                        : 'Tracks covered by the Rekordbox XML'}
                </Text>
            ) : (
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
            )}

            {/* Tab content (web renders the one list on its own) */}
            <ScrollArea style={{ flex: 1 }}>
                {isWeb && missingTrackList}

                {!isWeb && activeTab === 'missing' && missingTrackList}

                {!isWeb && activeTab === 'existing' && (
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

                {!isWeb && activeTab === 'metadata' && (
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
                                    {/* pymix doesn't populate `fields` today, so this
                                        renders nothing — it used to throw on
                                        undefined.map and take the whole preview
                                        screen down the moment this tab was opened. */}
                                    {update.fields && update.fields.length > 0 && (
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
                                    )}
                                </Group>
                            ))
                        )}
                    </Stack>
                )}
            </ScrollArea>

            {/* What goes in the download. Both ticked is one file containing both —
                these choose its contents, not how many downloads there are. */}
            <Group gap="xs" style={{ width: 'fit-content' }}>
                <Tooltip
                    label="Download the audio files. Untick to take only the Rekordbox XML, for when you already have these tracks."
                    multiline
                    openDelay={300}
                    position="top-start"
                    w={300}
                >
                    {/* The Checkbox owns its own change. A readOnly box inside a
                        clickable wrapper looks equivalent but isn't: clicking the label
                        text fired the wrapper's handler twice — once for the label, once
                        for the click a label forwards to its input — so the tick never
                        moved for anyone who aimed at the words. */}
                    <Group gap="md" style={{ width: 'fit-content' }}>
                        <Checkbox
                            checked={includeTracks}
                            label="Include tracks"
                            onChange={(event) => setIncludeTracks(event.currentTarget.checked)}
                            size="sm"
                        />
                    </Group>
                </Tooltip>
            </Group>

            <Group gap="xs" style={{ width: 'fit-content' }}>
                <Tooltip
                    label="Include a Rekordbox XML in the same download, to recreate these playlists in Rekordbox. Click the info icon for the steps."
                    multiline
                    openDelay={300}
                    position="top-start"
                    w={300}
                >
                    <Group gap="md" style={{ width: 'fit-content' }}>
                        <Checkbox
                            checked={includeRekordboxXml}
                            label="Include Rekordbox XML"
                            onChange={(event) =>
                                setIncludeRekordboxXml(event.currentTarget.checked)
                            }
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

            {/* Serato crates. Desktop only: they are written straight into the
                user's own _Serato_ folder, against the paths the download just
                landed on, which a browser can neither know nor reach. */}
            {isElectron() && (
                <Stack gap={4}>
                    <Group gap="xs" style={{ width: 'fit-content' }}>
                        <Tooltip
                            label="Write these playlists into your Serato library as crates, pointing at the tracks downloaded here. Anything replaced is backed up first."
                            multiline
                            openDelay={300}
                            position="top-start"
                            w={300}
                        >
                            <Group gap="md" style={{ width: 'fit-content' }}>
                                <Checkbox
                                    checked={includeSeratoCrates}
                                    disabled={!seratoFolder}
                                    label="Write Serato crates"
                                    onChange={(event) =>
                                        setIncludeSeratoCrates(event.currentTarget.checked)
                                    }
                                    size="sm"
                                />
                            </Group>
                        </Tooltip>
                        <Button onClick={handleSelectSeratoFolder} size="xs" variant="subtle">
                            {seratoFolder ? 'Change Serato Folder' : 'Choose Serato Folder'}
                        </Button>
                    </Group>
                    <Text c="dimmed" size="xs" style={{ fontFamily: 'monospace' }}>
                        {seratoFolder ?? 'No _Serato_ folder found — choose one to enable this'}
                    </Text>
                </Stack>
            )}

            {/* Where the Rekordbox XML is saved (desktop only) */}
            {isElectron() && includeRekordboxXml && (
                <Stack gap={4}>
                    <Group gap="sm">
                        <Button
                            onClick={handleSelectXmlDirectory}
                            size="xs"
                            tooltip={{
                                label: 'Where the Rekordbox XML is saved. By default it goes alongside your downloaded tracks.',
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
                telling us where the audio is (or will be). */}
            {!isElectron() && includeRekordboxXml && (
                <Stack gap="xs">
                    <TextInput
                        description={
                            includeTracks
                                ? 'Rekordbox needs this to find the tracks. The zip contains a single music folder; extract it here so that folder sits directly inside.'
                                : 'Rekordbox needs this to find the tracks, so it must match where the audio actually is.'
                        }
                        label={
                            includeTracks
                                ? "Folder you'll extract music.zip into"
                                : 'Folder your tracks are in'
                        }
                        onChange={(e) => handleWebExtractPathChange(e.currentTarget.value)}
                        placeholder={
                            includeTracks
                                ? 'e.g. /Users/you/Desktop or C:\\Users\\you\\Desktop'
                                : 'e.g. /Users/you/Music or C:\\Users\\you\\Music'
                        }
                        value={webExtractPath}
                    />
                    {/* The `music` segment is added for the user, so show the result:
                        it's the only way to catch an unzipper that added a wrapper
                        folder of its own (macOS Archive Utility does this for a
                        multi-entry zip; Windows' Extract All always does) before the
                        XML is built against a path that doesn't exist. */}
                    {includeTracks && webExtractPath.trim().length > 0 && (
                        <Text c="dimmed" size="xs">
                            Tracks must end up in{' '}
                            <Text component="span" size="xs" style={{ fontFamily: 'monospace' }}>
                                {musicRootFromExtractPath(webExtractPath)}
                            </Text>
                            . Check this after extracting. If your unzipper added an extra folder,
                            move the music folder here or the XML won&apos;t find the tracks.
                        </Text>
                    )}
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
                    // Nothing ticked, so there'd be nothing to do. Serato crates
                    // count: they can be written for tracks that are already here,
                    // which is how you refresh a crate without re-downloading.
                    (!includeTracks && !includeRekordboxXml && !writingSeratoCrates) ||
                    // Tracks asked for, but there are none to fetch and nothing else either.
                    (includeTracks &&
                        summary.tracksMissing === 0 &&
                        metadata.updates.length === 0 &&
                        !includeRekordboxXml &&
                        !writingSeratoCrates) ||
                    (!isElectron() && includeRekordboxXml && webExtractPath.trim().length === 0)
                }
                fullWidth
                onClick={handleDownload}
                size="md"
                tooltip={{
                    label: downloadButtonTooltip,
                    multiline: true,
                    openDelay: 300,
                    w: 300,
                }}
                variant="filled"
            >
                {downloadButtonLabel}
            </Button>
        </Stack>
    );
};
