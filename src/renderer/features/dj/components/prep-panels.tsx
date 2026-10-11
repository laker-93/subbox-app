import { useTranslation } from 'react-i18next';

import styles from './prep-panels.module.css';

import { PrepAudio } from '/@/renderer/features/dj/hooks/use-prep-audio';
import { PAD_LETTERS, padColor } from '/@/renderer/features/dj/utils/dj-marks';
import { djToDecodeSeconds, OffsetContext } from '/@/renderer/features/dj/utils/dj-offset';
import {
    appName,
    formatBpm,
    formatDjTime,
    gridSummary,
    loopBars,
} from '/@/renderer/features/dj/utils/format-dj';
import { DjTrack } from '/@/shared/api/pymix/pymix-types';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Badge } from '/@/shared/components/badge/badge';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

// Subbox-only: the prep view's read-only panels (subbox-app#239, design-dj-ui §5.2):
// the eight hot cue pads, the loops, memory cues and the grid. Times are shown as the
// DJ app shows them; play buttons convert to decode time through dj-offset.

interface PanelProps {
    audio: PrepAudio;
    context: OffsetContext;
    dj: DjTrack;
    durationMs: number;
}

const Swatch = ({ color }: { color?: null | string }) => (
    <span
        className={styles.swatch}
        data-empty={!color || undefined}
        style={color ? { background: color } : undefined}
    />
);

const Panel = ({ children, title }: { children: React.ReactNode; title: string }) => (
    <section aria-label={title} className={styles.panel}>
        <Text className={styles.panelTitle} fw={600} size="sm">
            {title}
        </Text>
        {children}
    </section>
);

export const PrepCues = ({ audio, context, dj }: PanelProps) => {
    const { t } = useTranslation();
    const bySlot = new Map(dj.cuedata.cues.map((cue) => [cue.index, cue]));

    return (
        <Panel title={t('page.djPrep.hotCues')}>
            <Stack gap={2}>
                {Array.from(PAD_LETTERS).map((letter, slot) => {
                    const cue = bySlot.get(slot);
                    return (
                        <Group className={styles.row} gap="sm" key={letter} wrap="nowrap">
                            <Swatch color={cue ? padColor(cue.color, slot) : null} />
                            <Text className={styles.slot} fw={600}>
                                {letter}
                            </Text>
                            <Text className={styles.time} isMuted={!cue}>
                                {cue ? formatDjTime(cue.position) : '—'}
                            </Text>
                            <Text className={styles.name} isMuted truncate>
                                {cue?.name || ''}
                            </Text>
                            {cue && (
                                <ActionIcon
                                    aria-label={t('page.djPrep.playCue', { slot: letter })}
                                    icon="mediaPlay"
                                    onClick={() =>
                                        audio.play(djToDecodeSeconds(cue.position, context))
                                    }
                                    size="xs"
                                    variant="subtle"
                                />
                            )}
                        </Group>
                    );
                })}
            </Stack>
        </Panel>
    );
};

export const PrepLoops = ({ audio, context, dj, durationMs }: PanelProps) => {
    const { t } = useTranslation();
    const loops = [...dj.cuedata.loops].sort((a, b) => a.index - b.index);

    return (
        <Panel title={t('page.djPrep.loops')}>
            {loops.length === 0 && (
                <Text isMuted size="sm">
                    {t('page.djPrep.noLoops')}
                </Text>
            )}
            <Stack gap={2}>
                {loops.map((loop) => {
                    const start = djToDecodeSeconds(loop.start, context);
                    const end = djToDecodeSeconds(loop.end, context);
                    const playing =
                        audio.isPlaying &&
                        audio.auditioning?.start === start &&
                        audio.auditioning?.end === end;
                    const bars = loopBars(dj.cuedata, loop.start, loop.end, durationMs);
                    return (
                        <Group className={styles.row} gap="sm" key={loop.index} wrap="nowrap">
                            <Swatch color={padColor(loop.color, loop.index)} />
                            <Text className={styles.slot} fw={600}>
                                {loop.index + 1}
                            </Text>
                            <Text className={styles.range}>
                                {formatDjTime(loop.start)} – {formatDjTime(loop.end)}
                            </Text>
                            <Text className={styles.name} isMuted truncate>
                                {[
                                    bars != null ? t('page.djPrep.bars', { count: bars }) : null,
                                    loop.name,
                                ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </Text>
                            <ActionIcon
                                aria-label={
                                    playing
                                        ? t('page.djPrep.stopLoop')
                                        : t('page.djPrep.auditionLoop', { slot: loop.index + 1 })
                                }
                                aria-pressed={playing}
                                icon={playing ? 'mediaStop' : 'mediaRepeat'}
                                onClick={() =>
                                    playing ? audio.pause() : audio.playLoop(start, end)
                                }
                                size="xs"
                                variant={playing ? 'filled' : 'subtle'}
                            />
                        </Group>
                    );
                })}
            </Stack>
        </Panel>
    );
};

export const PrepMemoryCues = ({ audio, context, dj }: PanelProps) => {
    const { t } = useTranslation();
    const memory = [...(dj.cuedata.memory ?? [])].sort((a, b) => a.position - b.position);
    if (memory.length === 0) return null;

    return (
        <Panel title={t('page.djPrep.memoryCues')}>
            <Stack gap={2}>
                {memory.map((mark, i) => (
                    <Group className={styles.row} gap="sm" key={i} wrap="nowrap">
                        <Swatch color={mark.color} />
                        <Text className={styles.range}>
                            {formatDjTime(mark.position)}
                            {mark.type === 'loop' && mark.end != null
                                ? ` – ${formatDjTime(mark.end)}`
                                : ''}
                        </Text>
                        <Text className={styles.name} isMuted truncate>
                            {mark.name || ''}
                        </Text>
                        <ActionIcon
                            aria-label={t('page.djPrep.playMemory', {
                                time: formatDjTime(mark.position),
                            })}
                            icon="mediaPlay"
                            onClick={() => audio.play(djToDecodeSeconds(mark.position, context))}
                            size="xs"
                            variant="subtle"
                        />
                    </Group>
                ))}
            </Stack>
        </Panel>
    );
};

export const PrepGrid = ({ dj, durationMs }: Omit<PanelProps, 'audio' | 'context'>) => {
    const { t } = useTranslation();
    const summary = gridSummary(dj.cuedata, durationMs);
    const app =
        appName(dj.cuedata.beatgrid_meta?.origin) ??
        appName(dj.source_app) ??
        t('page.djPrep.yourDjApp');
    const state = {
        app: t('page.djPrep.gridFromApp', { app }),
        edited: t('page.djPrep.gridEdited'),
        locked: t('page.djPrep.gridLocked'),
        none: t('page.djPrep.gridNone'),
    }[dj.grid_state];

    const rows: [string, string][] =
        dj.grid_state === 'none'
            ? []
            : [
                  [t('page.djPrep.anchors'), String(summary.anchors)],
                  [
                      t('page.djPrep.bpm'),
                      summary.bpms.length
                          ? summary.bpms.map(formatBpm).join(' → ')
                          : t('page.djPrep.unreadable'),
                  ],
                  [t('page.djPrep.meter'), summary.beatsPerBar ? `${summary.beatsPerBar}/4` : '—'],
                  [
                      t('page.djPrep.firstAnchor'),
                      summary.firstAnchorMs != null ? formatDjTime(summary.firstAnchorMs) : '—',
                  ],
              ];

    return (
        <Panel title={t('page.djPrep.grid')}>
            <Stack gap="xs">
                <div>
                    <Badge variant={dj.grid_state === 'none' ? 'outline' : 'light'}>{state}</Badge>
                </div>
                {rows.map(([label, value]) => (
                    <Group gap="sm" key={label} wrap="nowrap">
                        <Text className={styles.label} isMuted size="sm">
                            {label}
                        </Text>
                        <Text className={styles.time} size="sm">
                            {value}
                        </Text>
                    </Group>
                ))}
            </Stack>
        </Panel>
    );
};
