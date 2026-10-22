import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './prep-panels.module.css';

import i18n from '/@/i18n/i18n';
import { DjEdit, DjEditor } from '/@/renderer/features/dj/hooks/use-dj-edit';
import { PrepAudio } from '/@/renderer/features/dj/hooks/use-prep-audio';
import { CUE_PALETTE } from '/@/renderer/features/dj/utils/dj-edit';
import {
    BeatMark,
    PAD_LETTERS,
    padColor,
    PadEntry,
    padIndex,
    placePads,
} from '/@/renderer/features/dj/utils/dj-marks';
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
import { toast } from '/@/shared/components/toast/toast';

// Subbox-only: the prep view's panels (subbox-app#239, design-dj-ui §5.2): the eight
// pads, each a hot cue or a loop (#269), memory cues and the grid. With `editing` (#241),
// pads are set, named, coloured, moved, turned between cue and loop, and deleted here. Times are shown as the
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

type Pad = PadEntry<DjCue, DjLoop>;

/** The button that activates a loop, and exits it while it's the active one. */
const LoopButton = ({
    audio,
    end,
    label,
    start,
}: {
    audio: PrepAudio;
    end: number;
    label: string;
    start: number;
}) => {
    const { t } = useTranslation();
    const active = audio.activeLoop?.start === start && audio.activeLoop?.end === end;
    const text = active
        ? t('page.djPrep.exitLoop')
        : t('page.djPrep.activateLoop', { slot: label });
    return (
        <ActionIcon
            aria-label={text}
            aria-pressed={active}
            icon="mediaRepeat"
            onClick={() => (active ? audio.exitLoop() : audio.playLoop(start, end))}
            size="xs"
            tooltip={{ label: text }}
            variant={active ? 'filled' : 'subtle'}
        />
    );
};

/**
 * The eight pads, A-H, as Rekordbox shows them (subbox-app#269): each empty, a hot cue,
 * or a loop. Which pad a stored cue or loop is on is placePads' answer, the one a
 * Rekordbox export writes. A Serato loop left without a pad is listed under them.
 *
 * An edit stores a mark on the pad it's put on. pymix edits one cue or one loop per
 * version, so putting a cue on a loop's pad (or the reverse) is two versions: the one
 * clearing the pad, then the one setting it.
 */
export const PrepPads = ({
    audio,
    context,
    dj,
    durationMs,
    editing,
}: PanelProps & { editing?: null | PrepEditing }) => {
    const { t } = useTranslation();
    const { cues, loops } = dj.cuedata;
    const layout = placePads(cues, loops);
    const placed = padIndex(layout);
    const freePad = layout.pads.indexOf(null);
    const [bars, setBars] = useState('4');
    const beatsPerBar = gridSummary(dj.cuedata, durationMs).beatsPerBar ?? 4;

    const decode = (ms: number, origin: null | string | undefined) =>
        djToDecodeSeconds(ms, markContext(context, origin));

    const cueValue = (cue: DjCue) =>
        editing && {
            color: cue.color ?? undefined,
            name: cue.name ?? undefined,
            position: editing.restamp(cue.position, cue.origin),
        };
    const loopValue = (loop: DjLoop) =>
        editing && {
            active: loop.active ?? false,
            color: loop.color ?? undefined,
            end: editing.restamp(loop.end, loop.origin),
            name: loop.name ?? undefined,
            start: editing.restamp(loop.start, loop.origin),
        };
    const clear = (entry: Pad): DjEdit =>
        entry.kind === 'cue'
            ? { cue: { slot: entry.cue.index, value: null } }
            : { loop: { slot: entry.loop.index, value: null } };

    /** One version each, in order; stops at the first that isn't saved. */
    const run = async (edits: DjEdit[]) => {
        if (!editing) return;
        for (const edit of edits) {
            if (!(await editing.editor.apply(edit))) return;
        }
    };

    /**
     * What has to go before a `kind` is stored on `pad`, or null when it can't: the pad's
     * occupant, unless the write replaces it anyway, and for a loop, a Serato loop stored
     * on that slot but shown on another pad, which moves to the slot of the pad it's on
     * (no change on screen) so the write doesn't replace it.
     */
    const makeRoom = (pad: number, kind: Pad['kind'], moving?: DjLoop): DjEdit[] | null => {
        const edits: DjEdit[] = [];
        const occupant = layout.pads[pad];
        const replacedAnyway =
            occupant &&
            (occupant.kind === 'cue' ? occupant.cue.index : occupant.loop.index) === pad &&
            occupant.kind === kind;
        if (occupant && !replacedAnyway) edits.push(clear(occupant));
        if (kind === 'loop') {
            const holder = loops.find(
                (l) => l.index === pad && l !== moving && placed.loops.get(l.index) !== pad,
            );
            if (holder) {
                const to = placed.loops.get(holder.index);
                if (to == null) {
                    toast.warn({ message: t('page.djPrep.slotHeldBySeratoLoop') as string });
                    return null;
                }
                const value = loopValue(holder);
                if (value) edits.unshift({ loop: { from_slot: holder.index, slot: to, value } });
            }
        }
        return edits;
    };

    const putCue = (pad: number, value: DjCue | Record<string, unknown>) => {
        const before = makeRoom(pad, 'cue');
        if (before) run([...before, { cue: { slot: pad, value } }]);
    };
    const putLoop = (pad: number, value: Record<string, unknown>) => {
        const before = makeRoom(pad, 'loop');
        if (before) run([...before, { loop: { slot: pad, value } }]);
    };

    /** A loop `n` bars long from `startSeconds` (decode), on the grid; null without one. */
    const loopFrom = (startSeconds: number, n: number) => {
        if (!editing) return null;
        const start = editing.snap(startSeconds);
        const length = beatsLong(editing.beats, start, n * beatsPerBar);
        if (length == null) return null;
        return { end: editing.toStored(start + length), start: editing.toStored(start) };
    };

    const setCueAtPlayhead = (pad: number, entry: null | Pad) => {
        if (!editing) return;
        const position = editing.toStored(editing.snap(audio.position));
        if (entry?.kind === 'cue') putCue(pad, { ...cueValue(entry.cue), position });
        else putCue(pad, { position });
    };
    const setLoopAtPlayhead = (pad: number, entry: null | Pad) => {
        const range = loopFrom(audio.position, Number(bars));
        if (!range) return;
        putLoop(pad, entry?.kind === 'loop' ? { ...loopValue(entry.loop), ...range } : range);
    };
    const toLoop = (pad: number, cue: DjCue) => {
        const range = loopFrom(decode(cue.position, cue.origin), Number(bars));
        if (range)
            putLoop(pad, { color: cue.color ?? undefined, name: cue.name ?? undefined, ...range });
    };
    const toCue = (pad: number, loop: DjLoop) => {
        if (!editing) return;
        putCue(pad, {
            color: loop.color ?? undefined,
            name: loop.name ?? undefined,
            position: editing.restamp(loop.start, loop.origin),
        });
    };
    const move = (entry: Pad, to: number) => {
        if (!editing) return;
        if (entry.kind === 'cue') {
            const before = makeRoom(to, 'cue');
            const position = editing.restamp(entry.cue.position, entry.cue.origin);
            if (before) {
                run([
                    ...before,
                    { cue: { from_slot: entry.cue.index, slot: to, value: { position } } },
                ]);
            }
            return;
        }
        const { loop } = entry;
        const before = makeRoom(to, 'loop', loop);
        const value = {
            end: editing.restamp(loop.end, loop.origin),
            start: editing.restamp(loop.start, loop.origin),
        };
        if (before) run([...before, { loop: { from_slot: loop.index, slot: to, value } }]);
    };

    const canLoop = Boolean(editing && editing.beats.length > 0);

    const loopRow = (loop: DjLoop, pad: null | number) => {
        const letter = pad != null ? PAD_LETTERS[pad] : '';
        const start = decode(loop.start, loop.origin);
        const end = decode(loop.end, loop.origin);
        const loopLength = loopBars(dj.cuedata, loop.start, loop.end, durationMs);
        const length = loopLength != null ? t('page.djPrep.bars', { count: loopLength }) : null;
        const color = padColor(loop.color, pad ?? loop.index);
        return (
            <>
                {editing && pad != null ? (
                    <ColorPicker
                        color={color}
                        label={t('page.djPrep.loopColor', { slot: letter })}
                        onPick={(c) => {
                            const value = loopValue(loop);
                            if (value)
                                editing.editor.apply({
                                    loop: { slot: loop.index, value: { ...value, color: c } },
                                });
                        }}
                    />
                ) : (
                    <Swatch color={color} />
                )}
                <Text className={styles.slot} fw={600}>
                    {letter}
                </Text>
                <Text className={styles.range}>
                    {formatDjTime(loop.start)} – {formatDjTime(loop.end)}
                </Text>
                {editing && pad != null ? (
                    <NameInput
                        label={t('page.djPrep.loopName', { slot: letter })}
                        name={loop.name}
                        onCommit={(name) => {
                            const value = loopValue(loop);
                            if (value) {
                                editing.editor.apply({
                                    loop: {
                                        slot: loop.index,
                                        value: { ...value, name: name || undefined },
                                    },
                                });
                            }
                        }}
                    />
                ) : (
                    <Text className={styles.name} isMuted truncate>
                        {editing ? loop.name : [length, loop.name].filter(Boolean).join(' · ')}
                    </Text>
                )}
                {editing && length && (
                    <Text isMuted size="xs">
                        {length}
                    </Text>
                )}
                <LoopButton
                    audio={audio}
                    end={end}
                    label={letter || formatDjTime(loop.start)}
                    start={start}
                />
            </>
        );
    };

    return (
        <Panel title={t('page.djPrep.hotCues')}>
            <Stack gap={2}>
                {layout.pads.map((entry, pad) => {
                    const letter = PAD_LETTERS[pad];
                    const cue = entry?.kind === 'cue' ? entry.cue : null;
                    const color = cue ? padColor(cue.color, pad) : null;
                    return (
                        <Group
                            className={styles.row}
                            data-kind={entry?.kind}
                            gap="sm"
                            key={letter}
                            wrap="nowrap"
                        >
                            {entry?.kind === 'loop' ? (
                                loopRow(entry.loop, pad)
                            ) : (
                                <>
                                    {editing && cue && color ? (
                                        <ColorPicker
                                            color={color}
                                            label={t('page.djPrep.cueColor', { slot: letter })}
                                            onPick={(c) => {
                                                const value = cueValue(cue);
                                                if (value)
                                                    editing.editor.apply({
                                                        cue: {
                                                            slot: cue.index,
                                                            value: { ...value, color: c },
                                                        },
                                                    });
                                            }}
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
                                            onCommit={(name) => {
                                                const value = cueValue(cue);
                                                if (value) {
                                                    editing.editor.apply({
                                                        cue: {
                                                            slot: cue.index,
                                                            value: {
                                                                ...value,
                                                                name: name || undefined,
                                                            },
                                                        },
                                                    });
                                                }
                                            }}
                                        />
                                    ) : (
                                        <Text className={styles.name} isMuted truncate>
                                            {cue?.name || ''}
                                        </Text>
                                    )}
                                    {cue && (
                                        <ActionIcon
                                            aria-label={t('page.djPrep.playCue', { slot: letter })}
                                            icon="mediaPlay"
                                            onClick={() =>
                                                audio.play(decode(cue.position, cue.origin))
                                            }
                                            size="xs"
                                            variant="subtle"
                                        />
                                    )}
                                </>
                            )}
                            {editing && (
                                <ActionIcon
                                    aria-label={t('page.djPrep.setCue', { slot: letter })}
                                    icon="arrowDownToLine"
                                    onClick={() => setCueAtPlayhead(pad, entry)}
                                    size="xs"
                                    tooltip={{ label: t('page.djPrep.setCue', { slot: letter }) }}
                                    variant="subtle"
                                />
                            )}
                            {editing && entry && (
                                <SlotMenu
                                    count={PAD_LETTERS.length}
                                    label={t(
                                        entry.kind === 'cue'
                                            ? 'page.djPrep.cueMenu'
                                            : 'page.djPrep.loopMenu',
                                        { slot: letter },
                                    )}
                                    labelOf={(to) => PAD_LETTERS[to]}
                                    occupied={
                                        new Set(layout.pads.flatMap((p, i) => (p ? [i] : [])))
                                    }
                                    onDelete={() => editing.editor.apply(clear(entry))}
                                    onMove={(to) => move(entry, to)}
                                    slot={pad}
                                >
                                    {entry.kind === 'cue' && (
                                        <DropdownMenu.Item
                                            disabled={!canLoop}
                                            onClick={() => toLoop(pad, entry.cue)}
                                        >
                                            {t('page.djPrep.makeLoop', { count: Number(bars) })}
                                        </DropdownMenu.Item>
                                    )}
                                    {entry.kind === 'loop' && (
                                        <>
                                            <DropdownMenu.Item
                                                onClick={() => toCue(pad, entry.loop)}
                                            >
                                                {t('page.djPrep.makeCue')}
                                            </DropdownMenu.Item>
                                            {canLoop && (
                                                <>
                                                    <DropdownMenu.Label>
                                                        {t('page.djPrep.length')}
                                                    </DropdownMenu.Label>
                                                    {LOOP_BARS.map((n) => (
                                                        <DropdownMenu.Item
                                                            key={n}
                                                            onClick={() => {
                                                                const { loop } = entry;
                                                                const range = loopFrom(
                                                                    decode(loop.start, loop.origin),
                                                                    n,
                                                                );
                                                                const value = loopValue(loop);
                                                                if (range && value) {
                                                                    editing.editor.apply({
                                                                        loop: {
                                                                            slot: loop.index,
                                                                            value: {
                                                                                ...value,
                                                                                ...range,
                                                                            },
                                                                        },
                                                                    });
                                                                }
                                                            }}
                                                        >
                                                            {t('page.djPrep.bars', { count: n })}
                                                        </DropdownMenu.Item>
                                                    ))}
                                                </>
                                            )}
                                        </>
                                    )}
                                    <DropdownMenu.Divider />
                                </SlotMenu>
                            )}
                            {editing && !entry && (
                                <ActionIcon
                                    aria-label={t('page.djPrep.setLoop', { slot: letter })}
                                    disabled={!canLoop}
                                    icon="mediaRepeat"
                                    onClick={() => setLoopAtPlayhead(pad, entry)}
                                    size="xs"
                                    tooltip={{ label: t('page.djPrep.setLoop', { slot: letter }) }}
                                    variant="subtle"
                                />
                            )}
                        </Group>
                    );
                })}
            </Stack>
            {layout.overflow.length > 0 && (
                <Stack gap={2} mt="xs">
                    <Text fw={600} size="xs">
                        {t('page.djPrep.seratoLoops')}
                    </Text>
                    <Text isMuted size="xs">
                        {t('page.djPrep.seratoLoopsHint')}
                    </Text>
                    {layout.overflow.map((entry) =>
                        entry.kind === 'loop' ? (
                            <Group
                                className={styles.row}
                                gap="sm"
                                key={`loop-${entry.loop.index}`}
                                wrap="nowrap"
                            >
                                {loopRow(entry.loop, null)}
                                {editing && (
                                    <ActionIcon
                                        aria-label={t('common.delete')}
                                        icon="delete"
                                        onClick={() => editing.editor.apply(clear(entry))}
                                        size="xs"
                                        variant="subtle"
                                    />
                                )}
                            </Group>
                        ) : null,
                    )}
                </Stack>
            )}
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
                            disabled={freePad === -1 || !canLoop}
                            onClick={() => setLoopAtPlayhead(freePad, null)}
                            size="compact-xs"
                            variant="default"
                        >
                            {t('page.djPrep.addLoop')}
                        </Button>
                    </Group>
                    <Text isMuted size="xs">
                        {canLoop ? t('page.djPrep.addLoopHint') : t('page.djPrep.addLoopNoGrid')}
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
