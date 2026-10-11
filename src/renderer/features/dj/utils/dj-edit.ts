import { BeatMark } from '/@/renderer/features/dj/utils/dj-marks';
import {
    appOf,
    decodeSecondsToDj,
    DjApp,
    TrackOffsetContext,
} from '/@/renderer/features/dj/utils/dj-offset';
import { DjCuedata, DjPatch } from '/@/shared/api/pymix/pymix-types';

// Subbox-only: what the prep view's editing needs that isn't a component (subbox-app#241,
// design-dj-ui §5.2, §3.2): which app's time an edit is written in, snapping, the
// cue palette, and what one edit touches, for a 409's merge-or-ask (§10 Q7).

/**
 * The app a new edit on this track is written in, as pymix picks it (pymix#291,
 * dj_edit.clock_of): the clock it already has, else the app the row was last written
 * by, else its grid's, else its first imported mark's, else Rekordbox. pymix decides,
 * and stores it on the first edit; the client works it out the same way only to
 * convert the position it sends, and draws with what pymix stored.
 */
export const editClockOf = (
    cuedata: DjCuedata | null | undefined,
    sourceApp: null | string | undefined,
): DjApp => {
    if (cuedata?.edit_clock) return cuedata.edit_clock;
    const origins = [
        sourceApp,
        cuedata?.beatgrid_meta?.origin,
        ...(cuedata?.cues ?? []).map((c) => c.origin),
        ...(cuedata?.loops ?? []).map((l) => l.origin),
        ...(cuedata?.memory ?? []).map((m) => m.origin),
    ];
    for (const origin of origins) {
        // `edit` names no app of its own here: only an import, a file, or a row's app.
        const app = origin && origin !== 'edit' ? appOf(origin) : null;
        if (app) return app;
    }
    return 'rekordbox';
};

/** A position on this engine's decode -> the ms an edit stores, in the track's clock. */
export const toStoredMs = (decodeSeconds: number, track: TrackOffsetContext, clock: DjApp) =>
    decodeSecondsToDj(decodeSeconds, { ...track, app: clock });

export type SnapMode = 'bar' | 'beat' | 'off';

/** The nearest beat (or downbeat) to `seconds`, decode time; itself with no grid. */
export const snapSeconds = (seconds: number, beats: BeatMark[], mode: SnapMode) => {
    if (mode === 'off') return seconds;
    let best: null | number = null;
    for (const beat of beats) {
        if (mode === 'bar' && !beat.isDownbeat) continue;
        if (best === null || Math.abs(beat.seconds - seconds) < Math.abs(best - seconds)) {
            best = beat.seconds;
        }
    }
    return best ?? seconds;
};

/**
 * Hot cue colours both apps can show (§5.2): the hues Rekordbox's and Serato's
 * palettes share, in Rekordbox's values. Colours travel as #RRGGBB untouched.
 */
export const CUE_PALETTE = [
    '#E62828', // red
    '#E0641B', // orange
    '#C3AF04', // yellow
    '#28E214', // green
    '#10B176', // teal
    '#305AFF', // blue
    '#B432FF', // purple
    '#DE44CF', // pink
];

/** The history's names for what one edit touches (pymix dj_edit.changed_fields). */
export const fieldsOf = (patch: Omit<DjPatch, 'expected_version'>): string[] => {
    if (patch.cue) {
        return [`cue:${patch.cue.slot}`].concat(
            patch.cue.from_slot != null ? [`cue:${patch.cue.from_slot}`] : [],
        );
    }
    if (patch.loop) {
        return [`loop:${patch.loop.slot}`].concat(
            patch.loop.from_slot != null ? [`loop:${patch.loop.from_slot}`] : [],
        );
    }
    if (patch.grid) return ['grid'];
    return ['key'];
};

const fieldValue = (cuedata: DjCuedata | null | undefined, field: string): unknown => {
    const [kind, slot] = field.split(':');
    if (kind === 'cue') return cuedata?.cues.find((c) => c.index === Number(slot)) ?? null;
    if (kind === 'loop') return cuedata?.loops.find((l) => l.index === Number(slot)) ?? null;
    if (kind === 'grid') return [cuedata?.beatgrid ?? null, cuedata?.beatgrid_meta ?? null];
    return cuedata?.key ?? null;
};

/**
 * Whether another device changed what this edit touches, between the version the
 * edit was made against and the one the track is at now. If not, the edit is
 * reapplied on top; if so, the user is asked (§10 Q7).
 */
export const touchesSameField = (
    patch: Omit<DjPatch, 'expected_version'>,
    base: DjCuedata | null | undefined,
    current: DjCuedata | null | undefined,
) =>
    fieldsOf(patch).some(
        (field) =>
            JSON.stringify(fieldValue(base, field)) !== JSON.stringify(fieldValue(current, field)),
    );
