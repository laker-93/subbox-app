import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './prep-panels.module.css';

import i18n from '/@/i18n/i18n';
import { DjEditor } from '/@/renderer/features/dj/hooks/use-dj-edit';
import { PrepAudio } from '/@/renderer/features/dj/hooks/use-prep-audio';
import { CUE_PALETTE } from '/@/renderer/features/dj/utils/dj-edit';
import { BeatMark, PAD_LETTERS, padColor } from '/@/renderer/features/dj/utils/dj-marks';
import {
    djToDecodeSeconds,
    markContext,
    TrackOffsetContext,
} from '/@/renderer/features/dj/utils/dj-offset';
import {
    appName,
    formatBpm,
    formatDjTime,
    gridSummary,
    loopBars,
} from '/@/renderer/features/dj/utils/format-dj';
import { DjCue, DjLoop, DjTrack } from '/@/shared/api/pymix/pymix-types';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Group } from '/@/shared/components/group/group';
import { Popover } from '/@/shared/components/popover/popover';
import { Select } from '/@/shared/components/select/select';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';

// Subbox-only: the prep view's panels (subbox-app#239, design-dj-ui §5.2): the eight
// hot cue pads, the loops, memory cues and the grid. With `editing` (#241), pads and
// loops are set, named, coloured, moved and deleted here, one PATCH each. Times are shown as the
// DJ app shows them; play buttons convert to decode time through dj-offset, each mark
// through its own origin's app (#252).

interface PanelProps {
    audio: PrepAudio;
    context: TrackOffsetContext;
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

/** The prep view's editing, when the user can write (not `demo`; #241). */
export interface PrepEditing {
    /** Grid beats, decode seconds: loop lengths in bars count them. */
    beats: BeatMark[];
    editor: DjEditor;
    /** A stored position, any origin -> the same moment as an edit stores it. */
    restamp: (ms: number, origin: null | string | undefined) => number;
    snap: (decodeSeconds: number) => number;
    /** Decode seconds -> the ms an edit stores. */
    toStored: (decodeSeconds: number) => number;
}

// Keys typed into a name must never reach the page's or the app's hotkeys: space would
// play, arrows would change track (tree-rename-from-context-menu-no-focus).
const stopKeys = (e: React.KeyboardEvent) => e.stopPropagation();

const NameInput = ({
    label,
    name,
    onCommit,
}: {
    label: string;
    name: null | string | undefined;
    onCommit: (name: string) => void;
}) => (
    <TextInput
        aria-label={label}
        className={styles.nameInput}
        defaultValue={name ?? ''}
        key={name ?? ''}
        onBlur={(e) => {
            const value = e.currentTarget.value.trim();
            if (value !== (name ?? '')) onCommit(value);
        }}
        onKeyDown={(e) => {
            stopKeys(e);
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
                e.currentTarget.value = name ?? '';
                e.currentTarget.blur();
            }
        }}
        placeholder={i18n.t('page.djPrep.namePlaceholder') as string}
        size="xs"
        variant="unstyled"
    />
);

const ColorPicker = ({
    color,
    label,
    onPick,
}: {
    color: string;
    label: string;
    onPick: (color: string) => void;
}) => (
    <Popover position="bottom-start" withinPortal>
        <Popover.Target>
            <button aria-label={label} className={styles.swatchButton} type="button">
                <Swatch color={color} />
            </button>
        </Popover.Target>
        <Popover.Dropdown>
            <div className={styles.palette}>
                {CUE_PALETTE.map((c) => (
                    <button
                        aria-label={c}
                        aria-pressed={c.toUpperCase() === color.toUpperCase()}
                        className={styles.paletteColor}
                        key={c}
                        onClick={() => onPick(c)}
                        style={{ background: c }}
                        type="button"
                    />
                ))}
            </div>
        </Popover.Dropdown>
    </Popover>
);

/** Move to another pad or slot, or delete. Moving onto an occupied one replaces it. */
const SlotMenu = ({
    children,
    count,
    label,
    labelOf,
    occupied,
    onDelete,
    onMove,
    slot,
}: {
    children?: React.ReactNode;
    count: number;
    label: string;
    labelOf: (slot: number) => string;
    occupied: Set<number>;
    onDelete: () => void;
    onMove: (to: number) => void;
    slot: number;
}) => {
    const { t } = useTranslation();
    return (
        <DropdownMenu position="bottom-end">
            <DropdownMenu.Target>
                <ActionIcon
                    aria-label={label}
                    icon="ellipsisHorizontal"
                    size="xs"
                    variant="subtle"
                />
            </DropdownMenu.Target>
            <DropdownMenu.Dropdown>
                {children}
                <DropdownMenu.Label>{t('page.djPrep.moveTo')}</DropdownMenu.Label>
                {Array.from({ length: count }, (_, to) => to)
                    .filter((to) => to !== slot)
                    .map((to) => (
                        <DropdownMenu.Item key={to} onClick={() => onMove(to)}>
                            {occupied.has(to)
                                ? t('page.djPrep.replaceSlot', { slot: labelOf(to) })
                                : labelOf(to)}
                        </DropdownMenu.Item>
                    ))}
                <DropdownMenu.Divider />
                <DropdownMenu.Item onClick={onDelete}>{t('common.delete')}</DropdownMenu.Item>
            </DropdownMenu.Dropdown>
        </DropdownMenu>
    );
};

export const PrepCues = ({
    audio,
    context,
    dj,
    editing,
}: PanelProps & { editing?: null | PrepEditing }) => {
    const { t } = useTranslation();
    const bySlot = new Map(dj.cuedata.cues.map((cue) => [cue.index, cue]));
    const occupied = new Set(bySlot.keys());

    // Every write of a cue sends the whole of it, in the edit's clock (restamp).
    const writeCue = (cue: DjCue, changes: Partial<DjCue>, slot = cue.index) =>
        editing?.editor.apply({
            cue: {
                slot,
                value: {
                    color: cue.color ?? undefined,
                    name: cue.name ?? undefined,
                    position: editing.restamp(cue.position, cue.origin),
                    ...changes,
                },
            },
        });
    const setAtPlayhead = (slot: number, cue?: DjCue) => {
        if (!editing) return;
        const position = editing.toStored(editing.snap(audio.position));
        if (cue) writeCue(cue, { position });
        else editing.editor.apply({ cue: { slot, value: { position } } });
    };

    return (
        <Panel title={t('page.djPrep.hotCues')}>
            <Stack gap={2}>
                {Array.from(PAD_LETTERS).map((letter, slot) => {
                    const cue = bySlot.get(slot);
                    const color = cue ? padColor(cue.color, slot) : null;
                    return (
                        <Group className={styles.row} gap="sm" key={letter} wrap="nowrap">
                            {editing && cue && color ? (
                                <ColorPicker
                                    color={color}
                                    label={t('page.djPrep.cueColor', { slot: letter })}
                                    onPick={(c) => writeCue(cue, { color: c })}
                                />
                            ) : (
                                <Swatch color={color} />
                            )}
                            <Text className={styles.slot} fw={600}>
                                {letter}
                            </Text>
                            <Text className={styles.time} isMuted={!cue}>
                                {cue ? formatDjTime(cue.position) : '—'}
                            </Text>
                            {editing && cue ? (
                                <NameInput
                                    label={t('page.djPrep.cueName', { slot: letter })}
                                    name={cue.name}
                                    onCommit={(name) => writeCue(cue, { name: name || undefined })}
                                />
                            ) : (
                                <Text className={styles.name} isMuted truncate>
                                    {cue?.name || ''}
                                </Text>
                            )}
                            {editing && (
                                <ActionIcon
                                    aria-label={t('page.djPrep.setCue', { slot: letter })}
                                    icon="arrowDownToLine"
                                    onClick={() => setAtPlayhead(slot, cue)}
                                    size="xs"
                                    tooltip={{ label: t('page.djPrep.setCue', { slot: letter }) }}
                                    variant="subtle"
                                />
                            )}
                            {cue && (
                                <ActionIcon
                                    aria-label={t('page.djPrep.playCue', { slot: letter })}
                                    icon="mediaPlay"
                                    onClick={() =>
                                        audio.play(
                                            djToDecodeSeconds(
                                                cue.position,
                                                markContext(context, cue.origin),
                                            ),
                                        )
                                    }
                                    size="xs"
                                    variant="subtle"
                                />
                            )}
                            {editing && cue && (
                                <SlotMenu
                                    count={PAD_LETTERS.length}
                                    label={t('page.djPrep.cueMenu', { slot: letter })}
                                    labelOf={(to) => PAD_LETTERS[to]}
                                    occupied={occupied}
                                    onDelete={() =>
                                        editing.editor.apply({ cue: { slot, value: null } })
                                    }
                                    onMove={(to) =>
                                        editing.editor.apply({
                                            cue: {
                                                from_slot: slot,
                                                slot: to,
                                                value: {
                                                    position: editing.restamp(
                                                        cue.position,
                                                        cue.origin,
                                                    ),
                                                },
                                            },
                                        })
                                    }
                                    slot={slot}
                                />
                            )}
                        </Group>
                    );
                })}
            </Stack>
        </Panel>
    );
};

const LOOP_SLOTS = 8;
const LOOP_BARS = [1, 2, 4, 8, 16, 32];

/**
 * How long `count` beats last from the beat nearest `seconds`, decode seconds, following
 * any tempo change; null past the grid's end or without one. With snapping off the loop
 * starts where it was put and is still that many beats long.
 */
const beatsLong = (beats: BeatMark[], seconds: number, count: number) => {
    if (!beats.length) return null;
    let nearest = 0;
    for (let i = 1; i < beats.length; i++) {
        if (Math.abs(beats[i].seconds - seconds) < Math.abs(beats[nearest].seconds - seconds)) {
            nearest = i;
        }
    }
    const end = beats[nearest + count]?.seconds;
    return end == null ? null : end - beats[nearest].seconds;
};

export const PrepLoops = ({
    audio,
    context,
    dj,
    durationMs,
    editing,
}: PanelProps & { editing?: null | PrepEditing }) => {
    const { t } = useTranslation();
    const loops = [...dj.cuedata.loops].sort((a, b) => a.index - b.index);
    const occupied = new Set(loops.map((loop) => loop.index));
    const freeSlot = Array.from({ length: LOOP_SLOTS }, (_, i) => i).find((i) => !occupied.has(i));
    const [bars, setBars] = useState('4');
    const beatsPerBar = gridSummary(dj.cuedata, durationMs).beatsPerBar ?? 4;

    const writeLoop = (loop: DjLoop, changes: Partial<DjLoop>, slot = loop.index) =>
        editing?.editor.apply({
            loop: {
                slot,
                value: {
                    active: loop.active ?? false,
                    color: loop.color ?? undefined,
                    end: editing.restamp(loop.end, loop.origin),
                    name: loop.name ?? undefined,
                    start: editing.restamp(loop.start, loop.origin),
                    ...changes,
                },
            },
        });
    /** A loop `n` bars long from `startSeconds` (decode), on the grid; null without one. */
    const loopFrom = (startSeconds: number, n: number) => {
        if (!editing) return null;
        const start = editing.snap(startSeconds);
        const length = beatsLong(editing.beats, start, n * beatsPerBar);
        if (length == null) return null;
        return { end: editing.toStored(start + length), start: editing.toStored(start) };
    };
    const addLoop = () => {
        if (!editing || freeSlot == null) return;
        const range = loopFrom(audio.position, Number(bars));
        if (range) editing.editor.apply({ loop: { slot: freeSlot, value: range } });
    };

    return (
        <Panel title={t('page.djPrep.loops')}>
            {loops.length === 0 && (
                <Text isMuted size="sm">
                    {t('page.djPrep.noLoops')}
                </Text>
            )}
            <Stack gap={2}>
                {loops.map((loop) => {
                    const loopContext = markContext(context, loop.origin);
                    const start = djToDecodeSeconds(loop.start, loopContext);
                    const end = djToDecodeSeconds(loop.end, loopContext);
                    const playing =
                        audio.isPlaying &&
                        audio.auditioning?.start === start &&
                        audio.auditioning?.end === end;
                    const loopLength = loopBars(dj.cuedata, loop.start, loop.end, durationMs);
                    const color = padColor(loop.color, loop.index);
                    return (
                        <Group className={styles.row} gap="sm" key={loop.index} wrap="nowrap">
                            {editing ? (
                                <ColorPicker
                                    color={color}
                                    label={t('page.djPrep.loopColor', { slot: loop.index + 1 })}
                                    onPick={(c) => writeLoop(loop, { color: c })}
                                />
                            ) : (
                                <Swatch color={color} />
                            )}
                            <Text className={styles.slot} fw={600}>
                                {loop.index + 1}
                            </Text>
                            <Text className={styles.range}>
                                {formatDjTime(loop.start)} – {formatDjTime(loop.end)}
                            </Text>
                            {editing ? (
                                <NameInput
                                    label={t('page.djPrep.loopName', { slot: loop.index + 1 })}
                                    name={loop.name}
                                    onCommit={(name) =>
                                        writeLoop(loop, { name: name || undefined })
                                    }
                                />
                            ) : (
                                <Text className={styles.name} isMuted truncate>
                                    {[
                                        loopLength != null
                                            ? t('page.djPrep.bars', { count: loopLength })
                                            : null,
                                        loop.name,
                                    ]
                                        .filter(Boolean)
                                        .join(' · ')}
                                </Text>
                            )}
                            {editing && loopLength != null && (
                                <Text isMuted size="xs">
                                    {t('page.djPrep.bars', { count: loopLength })}
                                </Text>
                            )}
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
                            {editing && (
                                <SlotMenu
                                    count={LOOP_SLOTS}
                                    label={t('page.djPrep.loopMenu', { slot: loop.index + 1 })}
                                    labelOf={(to) => t('page.djPrep.loopSlot', { slot: to + 1 })}
                                    occupied={occupied}
                                    onDelete={() =>
                                        editing.editor.apply({
                                            loop: { slot: loop.index, value: null },
                                        })
                                    }
                                    onMove={(to) => writeLoop(loop, {}, to)}
                                    slot={loop.index}
                                >
                                    {editing.beats.length > 0 && (
                                        <>
                                            <DropdownMenu.Label>
                                                {t('page.djPrep.length')}
                                            </DropdownMenu.Label>
                                            {LOOP_BARS.map((n) => (
                                                <DropdownMenu.Item
                                                    key={n}
                                                    onClick={() => {
                                                        const range = loopFrom(start, n);
                                                        if (range) writeLoop(loop, range);
                                                    }}
                                                >
                                                    {t('page.djPrep.bars', { count: n })}
                                                </DropdownMenu.Item>
                                            ))}
                                            <DropdownMenu.Divider />
                                        </>
                                    )}
                                </SlotMenu>
                            )}
                        </Group>
                    );
                })}
            </Stack>
            {editing && (
                <Stack gap={4} mt="xs">
                    <Group gap="xs" wrap="nowrap">
                        <Select
                            aria-label={t('page.djPrep.length')}
                            data={LOOP_BARS.map((n) => ({
                                label: t('page.djPrep.bars', { count: n }),
                                value: String(n),
                            }))}
                            onChange={(value) => value && setBars(value)}
                            size="xs"
                            value={bars}
                            w={110}
                        />
                        <Button
                            disabled={freeSlot == null || editing.beats.length === 0}
                            onClick={addLoop}
                            size="compact-xs"
                            variant="default"
                        >
                            {t('page.djPrep.addLoop')}
                        </Button>
                    </Group>
                    <Text isMuted size="xs">
                        {editing.beats.length === 0
                            ? t('page.djPrep.addLoopNoGrid')
                            : t('page.djPrep.addLoopHint')}
                    </Text>
                </Stack>
            )}
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
                            onClick={() =>
                                audio.play(
                                    djToDecodeSeconds(
                                        mark.position,
                                        markContext(context, mark.origin),
                                    ),
                                )
                            }
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
