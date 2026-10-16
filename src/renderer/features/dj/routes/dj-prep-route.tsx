import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';

import styles from './dj-prep-route.module.css';

import { api } from '/@/renderer/api';
import { queryKeys } from '/@/renderer/api/query-keys';
import { PageHeader } from '/@/renderer/components/page-header/page-header';
import { useIsDemoSession } from '/@/renderer/config/demo-config';
import { DjWaveform, DjWaveformEditing } from '/@/renderer/features/dj/components/dj-waveform';
import { KeptEdits, PrepHistory } from '/@/renderer/features/dj/components/prep-history';
import {
    PrepCues,
    PrepEditing,
    PrepGrid,
    PrepLoops,
    PrepMemoryCues,
} from '/@/renderer/features/dj/components/prep-panels';
import { useDjEdit } from '/@/renderer/features/dj/hooks/use-dj-edit';
import { useDjMode } from '/@/renderer/features/dj/hooks/use-dj-mode';
import { useDjPeaks } from '/@/renderer/features/dj/hooks/use-dj-peaks';
import { usePrepAudio } from '/@/renderer/features/dj/hooks/use-prep-audio';
import { useTrackDj } from '/@/renderer/features/dj/hooks/use-track-dj';
import { useWaveformColors } from '/@/renderer/features/dj/hooks/use-waveform-colors';
import { PrepListEntry, PrepLocationState, prepPath } from '/@/renderer/features/dj/prep/prep-list';
import { setPrepSession } from '/@/renderer/features/dj/prep/prep-session.store';
import {
    editClockOf,
    SnapMode,
    snapSeconds,
    toStoredMs,
} from '/@/renderer/features/dj/utils/dj-edit';
import { djMarks } from '/@/renderer/features/dj/utils/dj-marks';
import {
    codecOf,
    currentEngine,
    decodeSecondsToDj,
    djToDecodeSeconds,
    markContext,
    TrackOffsetContext,
} from '/@/renderer/features/dj/utils/dj-offset';
import { WaveformColors } from '/@/renderer/features/dj/utils/draw-waveform';
import {
    appName,
    formatAudioFormat,
    formatBpm,
    formatDjTime,
    formatUpdatedAt,
    gridSummary,
} from '/@/renderer/features/dj/utils/format-dj';
import { rawStreamUrl } from '/@/renderer/features/dj/utils/raw-stream';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { useCurrentServerId, usePlayerStoreBase, useTimestampStoreBase } from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { Flex } from '/@/shared/components/flex/flex';
import { Group } from '/@/shared/components/group/group';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { useLocalStorage } from '/@/shared/hooks/use-local-storage';
import { PlayerStatus } from '/@/shared/types/types';

// Subbox-only: one track's prep view (subbox-app#239, design-dj-ui §5.2). The waveform
// with everything the DJ apps stored on it, the eight pads, loops, memory cues and the
// grid, playable from the original file. Cues and loops are edited here (#241): on the
// panels, or on the waveform (drag a flag, double-click for a cue, shift-drag for a
// loop), each change one versioned write, with undo and a history. The grid is #245.
//
// Prep is production-line work, so prev/next walk the list the user came from, one key
// away: ↑/↓ for the track, space to play. The page takes those keys before the app's
// own hotkeys do (space would otherwise start the app's player).

const isTyping = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));

const formatLength = (ms: number) => {
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const DjModeOff = () => {
    const { t } = useTranslation();
    const djMode = useDjMode();
    return (
        <Stack align="center" gap="sm" p="xl">
            <Text fw={600}>{t('page.djPrep.djModeOff')}</Text>
            <Text isMuted size="sm" ta="center">
                {t('page.djMode.description')}
            </Text>
            <Button onClick={() => djMode.setEnabled(true)} variant="filled">
                {t('page.djMode.turnOn')}
            </Button>
        </Stack>
    );
};

const DjPrepRoute = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const { subboxId = '' } = useParams() as { subboxId?: string };
    const [searchParams] = useSearchParams();
    const songId = searchParams.get('song');
    const serverId = useCurrentServerId();
    const djMode = useDjMode();
    const active = djMode.enabled && Boolean(songId);

    const songQuery = useQuery({
        enabled: active && Boolean(serverId),
        queryFn: ({ signal }) =>
            api.controller.getSongDetail({
                apiClientProps: { serverId, signal },
                query: { id: songId! },
            }),
        queryKey: queryKeys.songs.detail(serverId, { id: songId! }),
    });
    const song = songQuery.data ?? null;
    const djQuery = useTrackDj(subboxId, { enabled: active });
    const dj = djQuery.data ?? null;
    // `demo` reads demoadmin's library and can't write it (pymix require_uploader).
    const canEdit = !useIsDemoSession() && Boolean(dj);
    const editor = useDjEdit(subboxId, dj);

    const peaksRequest = useMemo(() => (song ? { song, subboxId } : null), [song, subboxId]);
    const peaks = useDjPeaks(active ? peaksRequest : null);
    const src = useMemo(() => (active && song ? rawStreamUrl(song) : null), [active, song]);
    const audio = usePrepAudio(src);

    const mp3Tag = peaks.peaks?.mp3Tag;
    const context: TrackOffsetContext = useMemo(
        () => ({
            codec: codecOf(song?.container),
            editClock: dj?.cuedata.edit_clock,
            engine: currentEngine(),
            mp3Tag,
            sampleRate: song?.sampleRate,
            sourceApp: dj?.source_app,
        }),
        [dj?.cuedata.edit_clock, dj?.source_app, mp3Tag, song?.container, song?.sampleRate],
    );
    const durationMs = (peaks.peaks?.durationSeconds ?? 0) * 1000 || song?.duration || 0;

    // --- editing (#241) ---
    const [waveformColors, setWaveformColors] = useWaveformColors();
    const [snapMode, setSnapMode] = useLocalStorage<SnapMode>({
        defaultValue: 'beat',
        key: 'dj_prep_snap',
    });
    const beats = useMemo(
        () => (dj && durationMs ? djMarks(dj.cuedata, durationMs / 1000, context).beats : []),
        [context, dj, durationMs],
    );
    const editing = useMemo((): null | PrepEditing => {
        if (!canEdit || !dj) return null;
        // pymix#291: an edit is written in the time of the app the track came from.
        const clock = editClockOf(dj.cuedata, dj.source_app);
        const toStored = (seconds: number) => toStoredMs(seconds, context, clock);
        return {
            beats,
            editor,
            restamp: (ms, origin) => {
                const mark = markContext(context, origin);
                // Already in the edit's clock: the same number, not a float round trip.
                return mark.app === clock ? ms : toStored(djToDecodeSeconds(ms, mark));
            },
            snap: (seconds) => snapSeconds(seconds, beats, snapMode),
            toStored,
        };
    }, [beats, canEdit, context, dj, editor, snapMode]);
    const waveformEditing = useMemo((): DjWaveformEditing | null => {
        if (!editing || !dj) return null;
        const firstFree = (taken: number[]) =>
            Array.from({ length: 8 }, (_, i) => i).find((i) => !taken.includes(i));
        return {
            onCueAdd: (seconds) => {
                const slot = firstFree(dj.cuedata.cues.map((c) => c.index));
                if (slot == null) {
                    toast.warn({ message: t('page.djPrep.padsFull') as string });
                    return;
                }
                editing.editor.apply({
                    cue: { slot, value: { position: editing.toStored(seconds) } },
                });
            },
            onCueMove: (slot, seconds) => {
                const cue = dj.cuedata.cues.find((c) => c.index === slot);
                if (!cue) return;
                editing.editor.apply({
                    cue: {
                        slot,
                        value: {
                            color: cue.color ?? undefined,
                            name: cue.name ?? undefined,
                            position: editing.toStored(seconds),
                        },
                    },
                });
            },
            onLoopDraw: (start, end) => {
                const slot = firstFree(dj.cuedata.loops.map((l) => l.index));
                if (slot == null) {
                    toast.warn({ message: t('page.djPrep.loopsFull') as string });
                    return;
                }
                editing.editor.apply({
                    loop: {
                        slot,
                        value: { end: editing.toStored(end), start: editing.toStored(start) },
                    },
                });
            },
            snap: editing.snap,
        };
    }, [dj, editing, t]);

    // --- prev / next through the list the user came from ---
    const prepList = useMemo(
        () => (location.state as null | PrepLocationState)?.prepList ?? [],
        [location.state],
    );
    const index = prepList.findIndex((entry) => entry.subboxId === subboxId);
    const prev = index > 0 ? prepList[index - 1] : null;
    const next = index >= 0 && index < prepList.length - 1 ? prepList[index + 1] : null;
    const go = useCallback(
        (entry: null | PrepListEntry) => {
            if (!entry) return;
            // Replace, so Back leaves prep for the list rather than walking it backwards.
            navigate(prepPath(entry), { replace: true, state: { prepList } });
        },
        [navigate, prepList],
    );
    const close = useCallback(() => {
        if (location.key !== 'default') navigate(-1);
        else navigate('/');
    }, [location.key, navigate]);

    // The player bar drives this page's audio while it's open (prep-session.store.ts).
    const { pause, seek, toggle } = audio;
    const stop = useCallback(() => {
        pause();
        seek(0);
    }, [pause, seek]);
    const goPrev = useMemo(() => (prev ? () => go(prev) : null), [go, prev]);
    const goNext = useMemo(() => (next ? () => go(next) : null), [go, next]);
    const formatTime = useCallback(
        // In the clock of the app the track came from.
        (seconds: number) => formatDjTime(decodeSecondsToDj(seconds, markContext(context, null))),
        [context],
    );
    const sessionDuration = song?.duration ? song.duration / 1000 : 0;
    useEffect(() => {
        if (!active) {
            setPrepSession(null);
            return;
        }
        setPrepSession({
            auditioning: Boolean(audio.auditioning),
            durationSeconds: sessionDuration,
            formatTime,
            isPlaying: audio.isPlaying,
            next: goNext,
            position: audio.position,
            prev: goPrev,
            seek,
            song: song ?? null,
            stop,
            toggle,
        });
    }, [
        active,
        audio.auditioning,
        audio.isPlaying,
        audio.position,
        formatTime,
        goNext,
        goPrev,
        seek,
        sessionDuration,
        song,
        stop,
        toggle,
    ]);
    useEffect(() => () => setPrepSession(null), []);

    // Opening prep hands the bar to this track, so the app's player pauses rather than
    // play on under a bar that no longer shows it. Opened on the track that was playing
    // (the full-screen player's button), prep picks up where it was.
    const songLoaded = Boolean(song);
    useEffect(() => {
        if (!active || !songLoaded || !songId) return;
        const player = usePlayerStoreBase.getState();
        if (player.player.status === PlayerStatus.PLAYING) player.mediaPause();
        if (player.getCurrentSong()?.id === songId) {
            seek(useTimestampStoreBase.getState().timestamp);
        }
    }, [active, seek, songId, songLoaded]);

    const undoRef = useRef(editor);
    undoRef.current = editor;
    const canEditRef = useRef(canEdit);
    canEditRef.current = canEdit;
    useEffect(() => {
        if (!active) return undefined;
        const onKey = (event: KeyboardEvent) => {
            if (isTyping(event.target)) return;
            // Undo walks back through the track's versions (#241). Ctrl on Windows and
            // Linux, ⌘ on the Mac.
            const mod = event.ctrlKey || event.metaKey;
            const k = event.key.toLowerCase();
            if (mod && !event.altKey && (k === 'z' || k === 'y') && canEditRef.current) {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (k === 'y' || event.shiftKey) undoRef.current.redo();
                else undoRef.current.undo();
                return;
            }
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            const handlers: Record<string, () => void> = {
                ' ': audio.toggle,
                ArrowDown: () => go(next),
                ArrowUp: () => go(prev),
            };
            const handler = handlers[event.key];
            if (!handler) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            handler();
        };
        // Capture on window runs before the app's hotkeys, which listen on the document.
        window.addEventListener('keydown', onKey, { capture: true });
        return () => window.removeEventListener('keydown', onKey, { capture: true });
    }, [active, audio.toggle, go, next, prev]);

    const grid = gridSummary(dj?.cuedata, durationMs);
    const bpm = dj?.cuedata.bpm ?? grid.bpms[0] ?? song?.bpm ?? null;
    const key = dj?.key ?? dj?.cuedata.key ?? null;
    const source = dj?.source_app
        ? t('page.djPrep.from', {
              app: appName(dj.source_app),
              date: formatUpdatedAt(dj.updated_at) ?? '',
          }).trim()
        : null;
    const facts = song
        ? [
              bpm ? `${formatBpm(bpm)} BPM` : null,
              key,
              song.duration ? formatLength(song.duration) : null,
              formatAudioFormat(song) || null,
              source,
          ].filter(Boolean)
        : [];

    const title = song
        ? `${t('page.djPrep.prefix')} · ${[song.artistName, song.name].filter(Boolean).join(' — ')}`
        : t('page.djPrep.title');

    let body: React.ReactNode;
    if (djMode.isLoading) {
        body = <Spinner container />;
    } else if (!djMode.enabled) {
        body = <DjModeOff />;
    } else if (!songId || songQuery.isError) {
        body = (
            <Text isMuted p="xl" ta="center">
                {t('page.djPrep.notFound')}
            </Text>
        );
    } else if (!song || djQuery.isPending) {
        body = <Spinner container />;
    } else {
        body = (
            <Stack gap="md" p="md">
                <Text className={styles.facts} isMuted size="sm">
                    {facts.join('  ·  ')}
                </Text>
                {djQuery.isError && (
                    <Text isMuted size="sm">
                        {t('page.djPrep.djUnavailable')}
                    </Text>
                )}
                {djQuery.isSuccess && !dj && (
                    <Text isMuted size="sm">
                        {t('page.djPrep.notInLibrary')}
                    </Text>
                )}
                <Group gap="sm" justify="space-between">
                    {editing ? (
                        <Group gap="sm" wrap="nowrap">
                            <Text isMuted size="sm">
                                {t('page.djPrep.snap')}
                            </Text>
                            <SegmentedControl
                                data={[
                                    { label: t('page.djPrep.snapOff'), value: 'off' },
                                    { label: t('page.djPrep.snapBeat'), value: 'beat' },
                                    { label: t('page.djPrep.snapBar'), value: 'bar' },
                                ]}
                                onChange={(value) => setSnapMode(value as SnapMode)}
                                size="xs"
                                value={snapMode}
                            />
                            <Text isMuted size="xs">
                                {t('page.djPrep.waveformHint')}
                            </Text>
                        </Group>
                    ) : (
                        <span />
                    )}
                    <SegmentedControl
                        aria-label={t('page.djMode.waveformColors')}
                        data={[
                            { label: t('page.djMode.waveformColorsBands'), value: 'bands' },
                            { label: t('page.djMode.waveformColorsRgb'), value: 'rgb' },
                            { label: t('page.djMode.waveformColorsBlue'), value: 'blue' },
                        ]}
                        onChange={(value) => setWaveformColors(value as WaveformColors)}
                        size="xs"
                        value={waveformColors}
                    />
                </Group>
                <DjWaveform
                    cuedata={dj?.cuedata}
                    detailHeight={140}
                    durationSeconds={(song.duration ?? 0) / 1000}
                    editing={waveformEditing}
                    error={peaks.status === 'error' ? t('page.djPrep.waveformFailed') : null}
                    isPlaying={audio.isPlaying}
                    offset={context}
                    onSeek={audio.seek}
                    overviewHeight={64}
                    peaks={peaks.peaks}
                    position={audio.position}
                    readPosition={audio.readPosition}
                />
                {dj && (
                    <div className={styles.panels}>
                        <Stack gap="md">
                            {editing && (
                                <KeptEdits dj={dj} editor={editor} restamp={editing.restamp} />
                            )}
                            <PrepCues
                                audio={audio}
                                context={context}
                                dj={dj}
                                durationMs={durationMs}
                                editing={editing}
                            />
                            <PrepLoops
                                audio={audio}
                                context={context}
                                dj={dj}
                                durationMs={durationMs}
                                editing={editing}
                            />
                            <PrepMemoryCues
                                audio={audio}
                                context={context}
                                dj={dj}
                                durationMs={durationMs}
                            />
                        </Stack>
                        <Stack gap="md">
                            <PrepGrid dj={dj} durationMs={durationMs} />
                            {editing && <PrepHistory dj={dj} editor={editor} />}
                        </Stack>
                    </div>
                )}
            </Stack>
        );
    }

    return (
        <AnimatedPage>
            <PageHeader>
                <Flex gap="md" justify="space-between" w="100%">
                    {/* Shrinks so a long title truncates instead of pushing prev/next off. */}
                    <div className={styles.title}>
                        <LibraryHeaderBar ignoreMaxWidth>
                            <LibraryHeaderBar.Title>{title}</LibraryHeaderBar.Title>
                        </LibraryHeaderBar>
                    </div>
                    <Group gap="xs" style={{ flexShrink: 0 }} wrap="nowrap">
                        {prepList.length > 1 && index >= 0 && (
                            <Text isMuted size="sm">
                                {index + 1} / {prepList.length}
                            </Text>
                        )}
                        <ActionIcon
                            aria-label={t('page.djPrep.previous')}
                            disabled={!prev}
                            icon="arrowUpS"
                            onClick={() => go(prev)}
                            tooltip={{ label: t('page.djPrep.previousKey') }}
                            variant="subtle"
                        />
                        <ActionIcon
                            aria-label={t('page.djPrep.next')}
                            disabled={!next}
                            icon="arrowDownS"
                            onClick={() => go(next)}
                            tooltip={{ label: t('page.djPrep.nextKey') }}
                            variant="subtle"
                        />
                        <ActionIcon
                            aria-label={t('common.close', { postProcess: 'sentenceCase' })}
                            icon="x"
                            onClick={close}
                            variant="subtle"
                        />
                    </Group>
                </Flex>
            </PageHeader>
            <ScrollArea>{body}</ScrollArea>
        </AnimatedPage>
    );
};

const DjPrepRouteWithBoundary = () => (
    <PageErrorBoundary>
        <DjPrepRoute />
    </PageErrorBoundary>
);

export default DjPrepRouteWithBoundary;
