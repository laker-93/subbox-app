import { useSuspenseQuery } from '@tanstack/react-query';
import isElectron from 'is-electron';
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
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Modal } from '/@/shared/components/modal/modal';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
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
    const {
        selectAll,
        selected: selectedPlaylists,
        selectNone: handleSelectNone,
        toggle: handleTogglePlaylist,
    } = useSelection();
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
    // Which format this export is for. Remembered across sessions, per direction,
    // so a DJ is never asked twice for something that is close to an identity
    // property. Falls back to Rekordbox only if the store somehow holds nothing.
    const storedFormat = useLibraryFormat('download');
    const setLibraryFormat = useSetLibraryFormat();
    // Web can never write crates, so it is pinned to Rekordbox regardless of what
    // is stored. Not belt-and-braces: the control disables the Serato segment, but
    // the *stored* value outlives the build it was chosen in, and a web session
    // that inherited 'serato' would send pymix a download with neither tracks nor
    // XML in it and be refused for a reason no screen could explain.
    const format: LibraryFormat = isElectron() ? (storedFormat ?? 'rekordbox') : 'rekordbox';
    // The §2.4 exception: the radio makes XML and crates exclusive, but writing
    // both in one pass is a real capability and nothing here should lose it. A
    // checkbox for the exception, a radio for the decision.
    const [alsoWriteSeratoCrates, setAlsoWriteSeratoCrates] = useState(false);
    // The folder, the picker, the write and its result -- shared with External Drive,
    // which ends the same way this does. The folder itself is one persisted setting,
    // so the user browses for their _Serato_ library once rather than once per flow.
    const {
        reset: resetSeratoResult,
        result: seratoResult,
        selectFolder: handleSelectSeratoFolder,
        seratoFolder,
        showFolder: handleShowSeratoFolder,
        writeCrates,
    } = useSeratoCrates();
    // What the export contains, not which format it is in: the audio as well as the
    // playlist file, or the playlist file on its own. "I already have these tracks,
    // just give me the XML" is a common enough workflow to stay on the primary
    // column rather than move into an options disclosure.
    const [includeTracks, setIncludeTracks] = useState(true);

    // The two flags the rest of this component still works in. Derived rather than
    // stored: they are two views of one question now, and keeping them as separate
    // state is how they drifted into being askable independently in the first place.
    const includeRekordboxXml = format === 'rekordbox';
    const includeSeratoCrates = format === 'serato' || alsoWriteSeratoCrates;
    const [xmlHelpOpened, xmlHelpHandlers] = useDisclosure(false);
    const [rekordboxHelpOpened, rekordboxHelpHandlers] = useDisclosure(false);
    // Everything that changes what Download does, behind the cog. On screen they
    // were four labelled controls and four lines of prose above a track list that
    // is the actual reason anyone opens this screen.
    const [settingsOpened, settingsHandlers] = useDisclosure(false);
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

    const handleSelectAll = useCallback(
        () => selectAll(playlists.map((p) => p.id)),
        [playlists, selectAll],
    );

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
        resetSeratoResult();
    }, [resetSeratoResult]);

    /** This screen's crate write: its own "should I" rule, its own playlist ids. */
    const writeSeratoCrates = useCallback(
        async (musicRoot: string) => {
            if (!includeSeratoCrates) return;
            await writeCrates(Array.from(selectedPlaylists), musicRoot);
        },
        [includeSeratoCrates, selectedPlaylists, writeCrates],
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
                // missing the XML the user asked for (which is the bug this fixes).
                //
                // This used to add "or untick Include Rekordbox XML to download the
                // tracks alone". There is no such tick box now: on web the format is
                // pinned to Rekordbox, so every web download carries the XML. That
                // costs the tracks-without-XML case, which is a real if narrow loss
                // -- see the note in the commit. Updating pymix is the actual fix
                // either way; the untick was only ever a way round a stale server.
                if (includeRekordboxXml && !result.xmlIncluded) {
                    throw new Error(
                        'This server is too old to include the Rekordbox XML in the download. Update pymix and try again.',
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
                <Group gap="xs">
                    <TextTitle order={3}>Download Playlists</TextTitle>
                    <ActionIcon
                        aria-label="Help"
                        icon="info"
                        iconProps={{ size: 'md' }}
                        onClick={rekordboxHelpHandlers.open}
                        size="sm"
                        tooltip={{ label: 'How to sync from Sub-box to Rekordbox' }}
                        variant="subtle"
                    />
                </Group>

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
                                        ? 'On the preview screen, set Format to Rekordbox and click Download. The tracks go to your music folder and the .xml to your XML folder. Already have the tracks? Set Include to "XML only" under the cog.'
                                        : `On the preview screen, set Format to Rekordbox, put the folder you'll extract into under the cog, and click Download. You get one zip with a single music folder in it, holding subbox_rb_export.xml. Already have the tracks? Set Include to "XML only".`}
                                </Text>
                            </Stack>
                            <RekordboxImportSteps startAt={3} />
                        </Stack>
                    </Stack>
                </Modal>

                <SyncSummary
                    items={[
                        {
                            label: `${playlists.length} ${playlists.length === 1 ? 'playlist' : 'playlists'}`,
                        },
                        { label: `${selectedPlaylists.size} selected` },
                        { label: `${totalSelectedTracks} tracks` },
                    ]}
                />

                <SelectableList
                    items={playlists.map((pl) => ({
                        detail: `${pl.songCount ?? 0} ${(pl.songCount ?? 0) === 1 ? 'track' : 'tracks'}`,
                        id: pl.id,
                        label: pl.name,
                    }))}
                    onSelectAll={handleSelectAll}
                    onSelectNone={handleSelectNone}
                    onToggle={handleTogglePlaylist}
                    scroll="area"
                    selected={selectedPlaylists}
                />

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
        return <SyncLoading label="Generating sync plan..." />;
    }

    // ── Downloading ────────────────────────────────────────────────────────
    if (step === 'downloading') {
        return (
            <SyncLoading
                label={
                    !includeTracks
                        ? 'Preparing your Rekordbox XML...'
                        : isElectron()
                          ? 'Downloading and extracting tracks...'
                          : 'Preparing download...'
                }
            />
        );
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
                /* Nothing was fetched in the crates-only case, so don't call it a
                   download — the sentence underneath would contradict it. */
                title={
                    !includeTracks && !includeRekordboxXml ? 'Crates Written' : 'Download Complete'
                }
            >
                <Text c="dimmed" size="sm">
                    {!includeTracks
                        ? includeRekordboxXml
                            ? 'Rekordbox XML downloaded. No audio files, as requested.'
                            : 'Serato crates written from the tracks you already have. Nothing was downloaded.'
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
                    <SeratoWriteSummary
                        onShowFolder={handleShowSeratoFolder}
                        result={seratoResult}
                    />
                )}
            </SyncResult>
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

    // One button, one word, whatever the settings say. It used to rename itself
    // four ways -- "Download & Extract", "Write Serato Crates" -- which made the
    // button a second, worse copy of the controls above it: the same choice stated
    // twice, and the button moving under the cursor every time one of them changed.
    // What it does in detail is on its tooltip, and on the screen it lands on.
    const downloadButtonTooltip = !includeTracks
        ? includeRekordboxXml
            ? 'Download just the Rekordbox XML for these playlists, with no audio files.'
            : 'Write these playlists into your Serato library, pointing at tracks you already have.'
        : isElectron()
          ? includeRekordboxXml
              ? `Save the missing tracks into your local music folder, with a Rekordbox XML${writingSeratoCrates ? ' and Serato crates' : ''}.`
              : 'Save the missing tracks into your local music folder, then write these playlists into your Serato library as crates.'
          : 'Download the selected tracks as one zip, with the Rekordbox XML inside it.';

    // The one thing the settings modal must not be allowed to hide: a setting that
    // isn't set yet, with the button dead because of it. Shown on the screen, next
    // to the control it sends you to.
    const blockedReason =
        !isElectron() && includeRekordboxXml && webExtractPath.trim().length === 0
            ? "Set the folder you'll extract into, under the cog."
            : isElectron() && includeSeratoCrates && !seratoFolder
              ? 'Choose your _Serato_ folder under the cog to write crates.'
              : null;

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
    );

    return (
        <SyncFlow
            error={error}
            footer={
                <Button
                    disabled={
                        // Both remaining clauses are now Serato-only: under Rekordbox
                        // there is always an XML to write, so there is always
                        // something to do. Serato with no folder chosen is the one
                        // way to reach this screen with nothing to produce.
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
                        tooltip={{ label: 'How to import the XML into Rekordbox' }}
                        variant="subtle"
                    />
                    <SyncSettingsButton onClick={settingsHandlers.open} />
                </>
            }
            onBack={handleBack}
            title="Download Preview"
        >
            {/* The only control left on the screen. Format is the one question a DJ
                answers with their own software's name, so it stays in the open;
                everything else -- what to include, where it lands -- is behind the
                cog, because it is either already right or set once and forgotten. */}
            <Group align="center" gap="sm" wrap="wrap">
                <FormatSelect
                    onChange={(next) => setLibraryFormat('download', next)}
                    value={format}
                />
                {/* Only when it isn't the default, so the screen stays quiet in the
                    case that needs no explaining. */}
                {!includeTracks && (
                    <Badge color="gray" size="sm" variant="light">
                        {includeRekordboxXml ? 'XML only' : 'Crates only'}
                    </Badge>
                )}
            </Group>

            {blockedReason && (
                <Text c="yellow" size="xs">
                    {blockedReason}
                </Text>
            )}

            {/* Summary badges. The already-present / to-download / metadata-updates
                counts are a diff against the local library, which only exists on
                desktop — on web they are fixed at 0 / everything / a copy of the
                missing list, so they're left out rather than shown as noise. */}
            <SyncSummary
                items={[
                    {
                        color: 'blue',
                        label: `${summary.playlists} ${summary.playlists === 1 ? 'playlist' : 'playlists'}`,
                    },
                    {
                        color: 'blue',
                        label: isWeb
                            ? `${summary.tracksRequested} ${summary.tracksRequested === 1 ? 'track' : 'tracks'}`
                            : `${summary.tracksRequested} tracks requested`,
                    },
                    ...(isWeb
                        ? []
                        : [
                              {
                                  color: 'green',
                                  label: `${summary.tracksAlreadyPresent} already present`,
                              },
                              { color: 'orange', label: `${summary.tracksMissing} to download` },
                              ...(summary.metadataUpdates > 0
                                  ? [
                                        {
                                            color: 'violet',
                                            label: `${summary.metadataUpdates} metadata updates`,
                                        },
                                    ]
                                  : []),
                          ]),
                    {
                        color: 'cyan',
                        label: `${formatBytes(summary.downloadSizeBytes)} download`,
                    },
                ]}
            />

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

                {!isWeb && activeTab === 'metadata' && (
                    <Stack gap="xs">
                        {metadata.updates.length === 0 ? (
                            <Text c="dimmed" size="sm">
                                No metadata updates needed.
                            </Text>
                        ) : (
                            metadata.updates.map((update, i) => (
                                <TrackRow
                                    artist={update.artist}
                                    /* pymix doesn't populate `fields` today, so this
                                       renders nothing — it used to throw on
                                       undefined.map and take the whole preview screen
                                       down the moment this tab was opened. */
                                    detail={
                                        update.fields && update.fields.length > 0 ? (
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
                                        ) : undefined
                                    }
                                    key={`${update.artist}-${update.title}-${i}`}
                                    title={update.title}
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
                {/* What comes out, rather than what format it is in. "I already have
                    these tracks, just give me the XML" is a real workflow, but it is
                    not the one anybody is in by default. */}
                <Stack gap="xs">
                    <Text fw={500} size="sm">
                        Include
                    </Text>
                    <SegmentedControl
                        data={[
                            {
                                label: format === 'rekordbox' ? 'Tracks + XML' : 'Tracks + crates',
                                value: 'tracks',
                            },
                            {
                                label: format === 'rekordbox' ? 'XML only' : 'Crates only',
                                value: 'file-only',
                            },
                        ]}
                        onChange={(next) => setIncludeTracks(next === 'tracks')}
                        value={includeTracks ? 'tracks' : 'file-only'}
                        w="fit-content"
                    />
                </Stack>

                {/* The one combination the format control can't express. Rekordbox-only:
                    under Serato the crates are already the output, so "also write
                    crates" would be asking for what is already happening. Desktop only
                    -- crates are written into the user's own _Serato_ folder against
                    the paths the download just landed on, which a browser can neither
                    know nor reach. */}
                {isElectron() && format === 'rekordbox' && (
                    <Stack gap="xs">
                        <Tooltip
                            label="Write these playlists into your Serato library as crates as well as the XML, pointing at the tracks downloaded here. Anything replaced is backed up first."
                            multiline
                            openDelay={300}
                            position="top-start"
                            w={300}
                        >
                            <span style={{ width: 'fit-content' }}>
                                <Checkbox
                                    checked={alsoWriteSeratoCrates}
                                    disabled={!seratoFolder}
                                    label="Also write Serato crates"
                                    onChange={(event) =>
                                        setAlsoWriteSeratoCrates(event.currentTarget.checked)
                                    }
                                    size="sm"
                                />
                            </span>
                        </Tooltip>
                        <DestinationPath
                            emptyLabel="No _Serato_ folder found — choose one to enable this"
                            label="Serato Folder"
                            onChoose={handleSelectSeratoFolder}
                            path={seratoFolder}
                            tooltip="The _Serato_ folder your crates are written into. Normally inside your Music folder; on an external drive it is at the top level."
                        />
                    </Stack>
                )}

                {/* Where the crates go, when Serato is the format. Not optional here:
                    without a folder there is nothing to write, and the Download button
                    says so on the screen behind this. */}
                {isElectron() && format === 'serato' && (
                    <DestinationPath
                        emptyLabel="No _Serato_ folder found — choose one to write crates"
                        label="Serato Folder"
                        onChoose={handleSelectSeratoFolder}
                        path={seratoFolder}
                        tooltip="The _Serato_ folder your crates are written into. Normally inside your Music folder; on an external drive it is at the top level."
                    />
                )}

                {/* Where the Rekordbox XML is saved (desktop only) */}
                {isElectron() && includeRekordboxXml && (
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

                {/* Where the tracks will end up (web only) — the browser can't tell us
                    this, so the Rekordbox XML's track locations depend on the user
                    telling us where the audio is (or will be). */}
                {!isElectron() && includeRekordboxXml && (
                    <Stack gap="xs">
                        <TextInput
                            description={
                                includeTracks
                                    ? 'The zip holds a single music folder; extract it here so that folder sits directly inside.'
                                    : 'Must match where the audio actually is, or Rekordbox won’t find it.'
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
                                <Text
                                    component="span"
                                    size="xs"
                                    style={{ fontFamily: 'monospace' }}
                                >
                                    {musicRootFromExtractPath(webExtractPath)}
                                </Text>
                                . If your unzipper added an extra folder, move the music folder
                                here.
                            </Text>
                        )}
                    </Stack>
                )}
            </SyncSettingsModal>

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
                        <RekordboxImportSteps />
                    </Stack>
                </Stack>
            </Modal>
        </SyncFlow>
    );
};
