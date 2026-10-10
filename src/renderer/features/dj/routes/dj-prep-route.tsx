import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';

import styles from './dj-prep-route.module.css';

import { api } from '/@/renderer/api';
import { queryKeys } from '/@/renderer/api/query-keys';
import { PageHeader } from '/@/renderer/components/page-header/page-header';
import { DjWaveform } from '/@/renderer/features/dj/components/dj-waveform';
import {
    PrepCues,
    PrepGrid,
    PrepLoops,
    PrepMemoryCues,
} from '/@/renderer/features/dj/components/prep-panels';
import { useDjMode } from '/@/renderer/features/dj/hooks/use-dj-mode';
import { useDjPeaks } from '/@/renderer/features/dj/hooks/use-dj-peaks';
import { usePrepAudio } from '/@/renderer/features/dj/hooks/use-prep-audio';
import { useTrackDj } from '/@/renderer/features/dj/hooks/use-track-dj';
import { PrepListEntry, PrepLocationState, prepPath } from '/@/renderer/features/dj/prep/prep-list';
import {
    codecOf,
    currentEngine,
    decodeSecondsToDj,
    OffsetContext,
} from '/@/renderer/features/dj/utils/dj-offset';
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
import { useCurrentServerId } from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { Flex } from '/@/shared/components/flex/flex';
import { Group } from '/@/shared/components/group/group';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

// Subbox-only: one track's prep view, read-only (subbox-app#239, design-dj-ui §5.2). The
// waveform with everything the DJ apps stored on it, the eight pads, loops, memory cues
// and the grid, playable from the original file. Editing lands in #241 and #245.
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

    const peaksRequest = useMemo(() => (song ? { song, subboxId } : null), [song, subboxId]);
    const peaks = useDjPeaks(active ? peaksRequest : null);
    const src = useMemo(() => (active && song ? rawStreamUrl(song) : null), [active, song]);
    const audio = usePrepAudio(src);

    const context: OffsetContext = useMemo(
        () => ({ codec: codecOf(song?.container), engine: currentEngine() }),
        [song?.container],
    );
    const durationMs = (peaks.peaks?.durationSeconds ?? 0) * 1000 || song?.duration || 0;

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

    useEffect(() => {
        if (!active) return undefined;
        const onKey = (event: KeyboardEvent) => {
            if (event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return;
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
        ? [song.artistName, song.name].filter(Boolean).join(' — ')
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
                <DjWaveform
                    codec={context.codec}
                    cuedata={dj?.cuedata}
                    detailHeight={140}
                    durationSeconds={(song.duration ?? 0) / 1000}
                    error={peaks.status === 'error' ? t('page.djPrep.waveformFailed') : null}
                    isPlaying={audio.isPlaying}
                    onSeek={audio.seek}
                    overviewHeight={64}
                    peaks={peaks.peaks}
                    position={audio.position}
                />
                <Group gap="sm">
                    <ActionIcon
                        aria-label={
                            audio.isPlaying
                                ? t('player.pause', { postProcess: 'sentenceCase' })
                                : t('player.play', { postProcess: 'sentenceCase' })
                        }
                        icon={audio.isPlaying ? 'mediaPause' : 'mediaPlay'}
                        onClick={audio.toggle}
                        size="lg"
                        tooltip={{ label: t('page.djPrep.playKey') }}
                        variant="filled"
                    />
                    <Text className={styles.clock} size="sm">
                        {formatDjTime(decodeSecondsToDj(audio.position, context))}
                    </Text>
                    {audio.auditioning && (
                        <Text isMuted size="sm">
                            {t('page.djPrep.looping')}
                        </Text>
                    )}
                </Group>
                {dj && (
                    <div className={styles.panels}>
                        <Stack gap="md">
                            <PrepCues
                                audio={audio}
                                context={context}
                                dj={dj}
                                durationMs={durationMs}
                            />
                            <PrepLoops
                                audio={audio}
                                context={context}
                                dj={dj}
                                durationMs={durationMs}
                            />
                            <PrepMemoryCues
                                audio={audio}
                                context={context}
                                dj={dj}
                                durationMs={durationMs}
                            />
                        </Stack>
                        <PrepGrid dj={dj} durationMs={durationMs} />
                    </div>
                )}
            </Stack>
        );
    }

    return (
        <AnimatedPage>
            <PageHeader>
                <Flex justify="space-between" w="100%">
                    <LibraryHeaderBar ignoreMaxWidth>
                        <LibraryHeaderBar.Title>
                            {t('page.djPrep.prefix')} · {title}
                        </LibraryHeaderBar.Title>
                    </LibraryHeaderBar>
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
