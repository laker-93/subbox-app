import { gridBeats, gridSegments } from '/@/renderer/features/dj/utils/beatgrid';
import { djToDecodeSeconds, OffsetContext } from '/@/renderer/features/dj/utils/dj-offset';
import { DjCuedata } from '/@/shared/api/pymix/pymix-types';

// Subbox-only: a track's stored DJ data as things to draw, in decode seconds
// (subbox-app#237). The conversion from DJ-app time happens here, through dj-offset,
// so nothing that draws ever sees a stored position.

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
    seconds: number;
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

export const djMarks = (
    cuedata: DjCuedata | null | undefined,
    durationSeconds: number,
    context: OffsetContext,
): DjMarks => {
    if (!cuedata) return EMPTY_MARKS;
    const at = (ms: number) => djToDecodeSeconds(ms, context);
    const durationMs = durationSeconds * 1000;

    const cues = cuedata.cues.map((cue) => ({
        color: padColor(cue.color, cue.index),
        label: PAD_LETTERS[cue.index] ?? String(cue.index + 1),
        name: cue.name || '',
        seconds: at(cue.position),
        slot: cue.index,
    }));
    const loops = cuedata.loops.map((loop) => ({
        color: padColor(loop.color, loop.index),
        endSeconds: at(loop.end),
        label: String(loop.index + 1),
        name: loop.name || '',
        slot: loop.index,
        startSeconds: at(loop.start),
    }));
    const memory = (cuedata.memory ?? []).map((mark) => ({
        color: mark.color && /^#[0-9a-f]{6}$/i.test(mark.color) ? mark.color : '#ffffff',
        endSeconds: mark.end != null ? at(mark.end) : null,
        name: mark.name || '',
        seconds: at(mark.position),
    }));

    const beats = gridBeats(cuedata.beatgrid, durationMs).map((beat) => ({
        bar: beat.bar,
        isAnchor: beat.isAnchor,
        isDownbeat: beat.isDownbeat,
        seconds: at(beat.ms),
    }));
    const segments = gridSegments(cuedata.beatgrid, durationMs);
    const anchors = segments.map((segment, i) => {
        const changed = i === 0 || Math.abs(segment.bpm - segments[i - 1].bpm) >= 0.005;
        return {
            bpmLabel: changed ? segment.bpm.toFixed(2) : null,
            seconds: at(segment.startMs),
        };
    });

    return { anchors, beats, cues, loops, memory };
};
