import { gridBeats, gridSegments } from '/@/renderer/features/dj/utils/beatgrid';
import {
    djToDecodeSeconds,
    markContext,
    TrackOffsetContext,
} from '/@/renderer/features/dj/utils/dj-offset';
import { DjCuedata } from '/@/shared/api/pymix/pymix-types';

// Subbox-only: a track's stored DJ data as things to draw, in decode seconds
// (subbox-app#237). The conversion from DJ-app time happens here, through dj-offset,
// so nothing that draws ever sees a stored position. Each mark converts through its own
// origin's app (#252): one track can hold a Rekordbox grid and a Serato cue.

export const PAD_LETTERS = 'ABCDEFGH';

// When a pad has no colour of its own: Serato's default pad colours, A-H.
const PAD_FALLBACK_COLORS = [
    '#cc0000',
    '#cc4400',
    '#cc8800',
    '#cccc00',
    '#00cc00',
    '#00cccc',
    '#0000cc',
    '#cc00cc',
];

export interface AnchorMark {
    /** Set where the tempo differs from the segment before, or on the first anchor. */
    bpmLabel: null | string;
    seconds: number;
}

export interface BeatMark {
    bar: number;
    isAnchor: boolean;
    isDownbeat: boolean;
    seconds: number;
}

export interface CueMark {
    color: string;
    label: string;
    name: string;
    /** The pad it shows on (placePads); null for one left without a pad. */
    pad: null | number;
    seconds: number;
    /** The stored index. */
    slot: number;
}

export interface DjMarks {
    anchors: AnchorMark[];
    beats: BeatMark[];
    cues: CueMark[];
    loops: LoopMark[];
    memory: MemoryMarkView[];
}

export interface LoopMark {
    color: string;
    endSeconds: number;
    label: string;
    name: string;
    /** The pad it shows on (placePads); null for a Serato loop left without one. */
    pad: null | number;
    /** The stored index: for a Serato loop, its saved-loop slot, which may not be its pad. */
    slot: number;
    startSeconds: number;
}

export interface MemoryMarkView {
    color: string;
    endSeconds: null | number;
    name: string;
    seconds: number;
}

export const EMPTY_MARKS: DjMarks = { anchors: [], beats: [], cues: [], loops: [], memory: [] };

export const padColor = (color: null | string | undefined, slot: number) =>
    color && /^#[0-9a-f]{6}$/i.test(color) ? color : PAD_FALLBACK_COLORS[slot % 8];

export type PadEntry<C, L> = { cue: C; kind: 'cue' } | { kind: 'loop'; loop: L };

export interface PadLayout<C, L> {
    /** The marks that kept no pad, every pad being taken: written as memory marks. */
    overflow: PadEntry<C, L>[];
    /** A-H: what each pad holds, or null. */
    pads: (null | PadEntry<C, L>)[];
}

const isSlot = (index: unknown): index is number =>
    typeof index === 'number' && Number.isInteger(index) && index >= 0;

/**
 * Which pad each hot cue and loop is on (subbox-app#269). Rekordbox shares the eight pads
 * between hot cues and hot loops, and its loops' `index` is the pad. Serato keeps cues and
 * saved loops in separate slot ranges, so a Serato loop's slot can be a cue's pad.
 *
 * This mirrors pymix's `to_rekordbox_marks` (pymix/model/cue_marks.py), so a track's pads
 * are the ones a Rekordbox export writes: a stored slot is kept if it's free, cues claim
 * theirs before loops, and a mark whose slot is taken goes to the lowest free pad. Change
 * one, change the other. Display only: the stored index is never rewritten by this.
 * A negative index (pre-pymix#265 memory marks) is no pad's, and left out.
 */
export const placePads = <C extends { index: number }, L extends { index: number }>(
    cues: C[],
    loops: L[],
): PadLayout<C, L> => {
    const pads: (null | PadEntry<C, L>)[] = Array(PAD_LETTERS.length).fill(null);
    const hot: [PadEntry<C, L>, number][] = [
        ...cues.filter((c) => isSlot(c.index)).map((cue) => [{ cue, kind: 'cue' }, cue.index]),
        ...loops.filter((l) => isSlot(l.index)).map((loop) => [{ kind: 'loop', loop }, loop.index]),
    ] as [PadEntry<C, L>, number][];
    const pending: PadEntry<C, L>[] = [];
    for (const [entry, index] of hot) {
        if (index < pads.length && !pads[index]) pads[index] = entry;
        else pending.push(entry);
    }
    const overflow: PadEntry<C, L>[] = [];
    for (const entry of pending) {
        const free = pads.indexOf(null);
        if (free === -1) overflow.push(entry);
        else pads[free] = entry;
    }
    return { overflow, pads };
};

/** The pad each stored cue and loop shows on, by kind and stored index. */
export const padIndex = <C extends { index: number }, L extends { index: number }>(
    layout: PadLayout<C, L>,
) => {
    const cues = new Map<number, number>();
    const loops = new Map<number, number>();
    layout.pads.forEach((entry, pad) => {
        if (entry?.kind === 'cue') cues.set(entry.cue.index, pad);
        if (entry?.kind === 'loop') loops.set(entry.loop.index, pad);
    });
    return { cues, loops };
};

export const djMarks = (
    cuedata: DjCuedata | null | undefined,
    durationSeconds: number,
    context: TrackOffsetContext,
): DjMarks => {
    if (!cuedata) return EMPTY_MARKS;
    const converter = (origin: null | string | undefined) => {
        const mark = markContext(context, origin);
        return (ms: number) => djToDecodeSeconds(ms, mark);
    };
    const gridAt = converter(cuedata.beatgrid_meta?.origin);
    const durationMs = durationSeconds * 1000;

    const placed = padIndex(placePads(cuedata.cues, cuedata.loops));
    const cues = cuedata.cues.map((cue) => {
        const pad = placed.cues.get(cue.index) ?? null;
        return {
            color: padColor(cue.color, pad ?? cue.index),
            label: pad != null ? PAD_LETTERS[pad] : '',
            name: cue.name || '',
            pad,
            seconds: converter(cue.origin)(cue.position),
            slot: cue.index,
        };
    });
    const loops = cuedata.loops.map((loop) => {
        const at = converter(loop.origin);
        const pad = placed.loops.get(loop.index) ?? null;
        return {
            color: padColor(loop.color, pad ?? loop.index),
            endSeconds: at(loop.end),
            label: pad != null ? PAD_LETTERS[pad] : '',
            name: loop.name || '',
            pad,
            slot: loop.index,
            startSeconds: at(loop.start),
        };
    });
    const memory = (cuedata.memory ?? []).map((mark) => {
        const at = converter(mark.origin);
        return {
            color: mark.color && /^#[0-9a-f]{6}$/i.test(mark.color) ? mark.color : '#ffffff',
            endSeconds: mark.end != null ? at(mark.end) : null,
            name: mark.name || '',
            seconds: at(mark.position),
        };
    });

    const beats = gridBeats(cuedata.beatgrid, durationMs).map((beat) => ({
        bar: beat.bar,
        isAnchor: beat.isAnchor,
        isDownbeat: beat.isDownbeat,
        seconds: gridAt(beat.ms),
    }));
    const segments = gridSegments(cuedata.beatgrid, durationMs);
    const anchors = segments.map((segment, i) => {
        const changed = i === 0 || Math.abs(segment.bpm - segments[i - 1].bpm) >= 0.005;
        return {
            bpmLabel: changed ? segment.bpm.toFixed(2) : null,
            seconds: gridAt(segment.startMs),
        };
    });

    return { anchors, beats, cues, loops, memory };
};
