import { DjGridAnchor } from '/@/shared/api/pymix/pymix-types';

// Subbox-only: a stored beat grid -> the beats to draw (subbox-app#237). The rules are
// pymix's (pymix/model/beatgrid.py); this only reads them.
//
// Every anchor says "a beat falls here". The tempo after an anchor is its own `bpm`
// (Rekordbox), or `beats_till_next` beats spread evenly to the next anchor (Serato).
// The last anchor always has a `bpm` and runs to the end of the track. `metro` is the
// meter and `battito` which beat of the bar the anchor sits on; Serato has neither, so
// its anchors read as 4/4 downbeats. Like both DJ apps, the first segment's tempo is
// also run backwards to the start of the track.
//
// Times here are DJ-app milliseconds. The caller converts to decode time to draw.

export interface GridBeat {
    /** Bar number, counted from 1 at the first downbeat at or after 0 ms. */
    bar: number;
    /** 1-based beat of the bar. */
    beatOfBar: number;
    isAnchor: boolean;
    isDownbeat: boolean;
    ms: number;
}

export interface GridSegment {
    beatsPerBar: number;
    bpm: number;
    endMs: number;
    startMs: number;
}

const beatsPerBarOf = (metro?: null | string) => {
    const n = Number.parseInt((metro || '4/4').split('/')[0], 10);
    return Number.isFinite(n) && n > 0 ? n : 4;
};

/**
 * The grid as segments of constant tempo, or [] when it can't be read. A grid that is
 * only partly readable is dropped whole, as pymix does: a guessed segment would put
 * every beat after it in the wrong place, which is worse than drawing none.
 */
export const gridSegments = (
    anchors: DjGridAnchor[] | null | undefined,
    durationMs: number,
): GridSegment[] => {
    if (!anchors?.length) return [];
    const ordered = [...anchors].sort((a, b) => a.position_ms - b.position_ms);
    const segments: GridSegment[] = [];
    for (let i = 0; i < ordered.length; i++) {
        const anchor = ordered[i];
        const next = ordered[i + 1];
        const endMs = next ? next.position_ms : Math.max(durationMs, anchor.position_ms);
        let bpm = anchor.bpm ?? null;
        if (next && anchor.beats_till_next) {
            const span = next.position_ms - anchor.position_ms;
            // Serato's whole-beat spacing wins over a stated bpm where both exist: it is
            // what places the next anchor exactly on a beat.
            if (span > 0) bpm = (anchor.beats_till_next * 60_000) / span;
        }
        if (!bpm || bpm <= 0 || !Number.isFinite(bpm)) return [];
        segments.push({
            beatsPerBar: beatsPerBarOf(anchor.metro),
            bpm,
            endMs,
            startMs: anchor.position_ms,
        });
    }
    return segments;
};

/**
 * Every beat from 0 to `durationMs`. `battito` puts each anchor on its beat of the bar,
 * and bars count on across anchors.
 */
export const gridBeats = (
    anchors: DjGridAnchor[] | null | undefined,
    durationMs: number,
): GridBeat[] => {
    const segments = gridSegments(anchors, durationMs);
    if (!segments.length) return [];
    const ordered = [...(anchors ?? [])].sort((a, b) => a.position_ms - b.position_ms);
    const raw: { beatOfBar: number; isAnchor: boolean; ms: number }[] = [];

    // Before the first anchor: the first segment's tempo, run backwards.
    const first = segments[0];
    const firstBattito = ordered[0].battito || 1;
    const firstBeatMs = 60_000 / first.bpm;
    for (let k = Math.floor(first.startMs / firstBeatMs); k >= 1; k--) {
        const beatOfBar = mod(firstBattito - 1 - k, first.beatsPerBar) + 1;
        raw.push({ beatOfBar, isAnchor: false, ms: first.startMs - k * firstBeatMs });
    }

    segments.forEach((segment, i) => {
        const beatMs = 60_000 / segment.bpm;
        const battito = ordered[i].battito || 1;
        // Stop half a beat short of the next anchor, which starts its own count.
        const last = i + 1 < segments.length ? segment.endMs - beatMs / 2 : segment.endMs;
        for (let k = 0; segment.startMs + k * beatMs <= last; k++) {
            raw.push({
                beatOfBar: mod(battito - 1 + k, segment.beatsPerBar) + 1,
                isAnchor: k === 0,
                ms: segment.startMs + k * beatMs,
            });
        }
    });

    let bar = 0;
    return raw.map((beat) => {
        const isDownbeat = beat.beatOfBar === 1;
        if (isDownbeat) bar += 1;
        return { ...beat, bar: Math.max(bar, 1), isDownbeat };
    });
};

const mod = (n: number, m: number) => ((n % m) + m) % m;
