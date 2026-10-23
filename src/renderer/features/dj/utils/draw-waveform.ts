import { DjPeaks } from '/@/renderer/features/dj/peaks/peaks-source';
import { DjMarks } from '/@/renderer/features/dj/utils/dj-marks';

// Subbox-only: drawing the DJ waveform onto a canvas (subbox-app#237, design-dj-ui
// §4.1). Pure functions of the canvas, the peaks and the marks, all in decode seconds.

// How the peaks are coloured (#268), a device preference (use-waveform-colors).
// - bands: low/mid/high layered back to front, the way Rekordbox's 3-band waveform is.
// - rgb: one waveform, each column coloured by its band energies, low -> red, mid ->
//   green, high -> blue, the way Serato's is.
// - blue: one waveform in blue, whiter where there's more high end, the way Rekordbox's
//   Blue is.
export type WaveformColors = 'bands' | 'blue' | 'rgb';

export const BAND_COLORS = {
    high: 'rgba(245, 245, 245, 0.95)',
    low: 'rgba(32, 110, 245, 0.95)',
    mid: 'rgba(240, 150, 40, 0.95)',
};

const BLUE_PEAK = 'rgba(20, 90, 220, 0.95)';
// The Blue waveform's body, from no high end to all high end.
const BLUE_BODY = Array.from({ length: 17 }, (_, i) => {
    const f = i / 16;
    const mix = (a: number, b: number) => Math.round(a + (b - a) * f);
    return `rgb(${mix(60, 225)}, ${mix(140, 240)}, ${mix(255, 255)})`;
});

const LOOP_FILL = 'rgba(46, 204, 113, 0.22)';
const LOOP_EDGE = 'rgba(46, 204, 113, 0.9)';
const PLAYHEAD = '#ffffff';
const ANCHOR = '#ff3b3b';

export interface View {
    /** CSS pixels. */
    height: number;
    /** Device pixels per CSS pixel; marks land on whole device pixels, as the peaks do. */
    pixelRatio?: number;
    /** Seconds at the left edge, and seconds per CSS pixel. */
    secondsPerPx: number;
    startSeconds: number;
    width: number;
}

const xOf = (view: View, seconds: number) => (seconds - view.startSeconds) / view.secondsPerPx;

/** xOf, on a whole device pixel. */
const snappedX = (view: View, seconds: number) => {
    const ratio = view.pixelRatio || 1;
    return Math.round(xOf(view, seconds) * ratio) / ratio;
};

/**
 * `data` over [from, to) seconds, 0-1. The loudest peak when that spans a peak or more;
 * zoomed in further, between the two nearest peaks, so the outline is smooth rather
 * than a staircase of repeated peaks.
 */
const sampleBetween = (data: Uint8Array, pps: number, from: number, to: number) => {
    const a = from * pps;
    const b = to * pps;
    if (b - a >= 1) {
        const i0 = Math.max(0, Math.floor(a));
        const i1 = Math.min(data.length, Math.ceil(b));
        let max = 0;
        for (let i = i0; i < i1; i++) if (data[i] > max) max = data[i];
        return max / 255;
    }
    const p = (a + b) / 2 - 0.5;
    const i = Math.floor(p);
    if (i + 1 < 0 || i >= data.length) return 0;
    const v0 = data[Math.max(i, 0)];
    const v1 = data[Math.min(i + 1, data.length - 1)];
    return (v0 + (v1 - v0) * (p - i)) / 255;
};

/** Each band's loudest peak, for colouring by band balance within one track. */
const bandMaxima = new WeakMap<DjPeaks, { high: number; low: number; mid: number }>();
const maximaOf = (peaks: DjPeaks) => {
    let maxima = bandMaxima.get(peaks);
    if (!maxima) {
        const max = (data: Uint8Array) => {
            let m = 1;
            for (const v of data) if (v > m) m = v;
            return m / 255;
        };
        maxima = { high: max(peaks.high), low: max(peaks.low), mid: max(peaks.mid) };
        bandMaxima.set(peaks, maxima);
    }
    return maxima;
};

/** Where drawPeaks draws, all in device pixels. */
export interface PeakColumns {
    columns: number;
    /** Column c covers [c, c + 1) * secondsPerColumn of the track, wherever it's drawn. */
    firstColumn: number;
    height: number;
    secondsPerColumn: number;
    top: number;
}

/**
 * One device pixel per column, on an untransformed context. Columns are fixed to the
 * track rather than to the view, so a column scrolled into a new place shows exactly
 * what it did before and the waveform doesn't shimmer as it moves (#268).
 */
export const drawPeaks = (
    ctx: CanvasRenderingContext2D,
    peaks: DjPeaks,
    colors: WaveformColors,
    { columns, firstColumn, height, secondsPerColumn, top }: PeakColumns,
) => {
    const mid = top + height / 2;
    const half = height / 2;
    const pps = peaks.peaksPerSecond;
    const span = (x: number) => {
        const from = (firstColumn + x) * secondsPerColumn;
        if (from < 0 || from > peaks.durationSeconds) return null;
        return [from, from + secondsPerColumn] as const;
    };
    const bar = (x: number, amp: number) => {
        if (amp <= 0) return;
        const h = Math.max(0.5, amp * half);
        ctx.fillRect(x, mid - h, 1, h * 2);
    };

    if (colors === 'bands') {
        for (const band of ['low', 'mid', 'high'] as const) {
            ctx.fillStyle = BAND_COLORS[band];
            const data = peaks[band];
            for (let x = 0; x < columns; x++) {
                const at = span(x);
                if (at) bar(x, sampleBetween(data, pps, at[0], at[1]));
            }
        }
        return;
    }

    const maxima = maximaOf(peaks);
    for (let x = 0; x < columns; x++) {
        const at = span(x);
        if (!at) continue;
        const [from, to] = at;
        const low = sampleBetween(peaks.low, pps, from, to) / maxima.low;
        const midBand = sampleBetween(peaks.mid, pps, from, to) / maxima.mid;
        const high = sampleBetween(peaks.high, pps, from, to) / maxima.high;
        // Without a full band (a source that only has bands), the loudest band stands in.
        const peak = peaks.full
            ? sampleBetween(peaks.full, pps, from, to)
            : Math.max(low * maxima.low, midBand * maxima.mid, high * maxima.high);
        const body = peaks.rms ? sampleBetween(peaks.rms, pps, from, to) : peak * 0.6;

        if (colors === 'blue') {
            ctx.fillStyle = BLUE_PEAK;
            bar(x, peak);
            const share = high / (low + midBand + high || 1);
            ctx.fillStyle = BLUE_BODY[Math.round(Math.min(1, share * 1.5) * 16)];
            bar(x, body);
        } else {
            const scale = 255 / Math.max(low, midBand, high, 1e-6);
            const r = Math.round(low * scale);
            const g = Math.round(midBand * scale);
            const b = Math.round(high * scale);
            ctx.fillStyle = `rgb(${r >> 1}, ${g >> 1}, ${b >> 1})`;
            bar(x, peak);
            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            bar(x, body);
        }
    }
};

export const drawLoops = (
    ctx: CanvasRenderingContext2D,
    view: View,
    marks: DjMarks,
    withLabels: boolean,
) => {
    for (const loop of marks.loops) {
        const x0 = snappedX(view, loop.startSeconds);
        const x1 = snappedX(view, loop.endSeconds);
        if (x1 < 0 || x0 > view.width) continue;
        ctx.fillStyle = LOOP_FILL;
        ctx.fillRect(x0, 0, Math.max(1, x1 - x0), view.height);
        ctx.fillStyle = LOOP_EDGE;
        ctx.fillRect(x0, 0, 1, view.height);
        ctx.fillRect(x1 - 1, 0, 1, view.height);
        if (withLabels) {
            ctx.font = '10px sans-serif';
            ctx.textBaseline = 'bottom';
            ctx.fillText(
                ['Loop', loop.label, loop.name].filter(Boolean).join(' '),
                x0 + 3,
                view.height - 2,
            );
        }
    }
};

/** Beat lines; downbeats brighter, bar numbers above them where there's room. */
export const drawGrid = (ctx: CanvasRenderingContext2D, view: View, marks: DjMarks) => {
    if (!marks.beats.length) return;
    // Thin out the bar numbers so they never run into each other.
    const barPx = (() => {
        const downbeats = marks.beats.filter((b) => b.isDownbeat);
        if (downbeats.length < 2) return Infinity;
        return (downbeats[1].seconds - downbeats[0].seconds) / view.secondsPerPx;
    })();
    const labelEvery = barPx >= 28 ? 1 : 2 ** Math.ceil(Math.log2(28 / Math.max(barPx, 0.01)));
    // Beat lines only once there's room to tell them apart.
    const beatPx = barPx / 4;

    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'top';
    for (const beat of marks.beats) {
        const x = snappedX(view, beat.seconds);
        if (x < -40 || x > view.width) continue;
        if (beat.isDownbeat) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
            ctx.fillRect(x, 0, 1, view.height);
            if ((beat.bar - 1) % labelEvery === 0) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
                ctx.fillText(String(beat.bar), x + 3, 2);
            }
        } else if (beatPx >= 6) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.fillRect(x, 12, 1, view.height - 12);
        }
    }

    // Anchors, distinct from beats, with the tempo where it changes.
    for (const anchor of marks.anchors) {
        const x = snappedX(view, anchor.seconds);
        if (x < -60 || x > view.width) continue;
        ctx.fillStyle = ANCHOR;
        ctx.fillRect(x, 0, 2, view.height);
        ctx.beginPath();
        ctx.moveTo(x - 4, 0);
        ctx.lineTo(x + 6, 0);
        ctx.lineTo(x + 1, 6);
        ctx.fill();
        if (anchor.bpmLabel) {
            ctx.textBaseline = 'top';
            ctx.fillText(`${anchor.bpmLabel} BPM`, x + 5, 14);
        }
    }
};

/** Hot cues as flags: a coloured line, and a tab with the pad letter (and name). */
export const drawCues = (
    ctx: CanvasRenderingContext2D,
    view: View,
    marks: DjMarks,
    withNames: boolean,
) => {
    ctx.font = 'bold 10px sans-serif';
    ctx.textBaseline = 'middle';
    for (const memory of marks.memory) {
        const x = snappedX(view, memory.seconds);
        if (x < -6 || x > view.width + 6) continue;
        ctx.fillStyle = memory.color;
        ctx.beginPath();
        ctx.moveTo(x - 4, view.height);
        ctx.lineTo(x + 4, view.height);
        ctx.lineTo(x, view.height - 6);
        ctx.fill();
    }
    for (const cue of marks.cues) {
        const x = snappedX(view, cue.seconds);
        if (x < -120 || x > view.width + 2) continue;
        ctx.fillStyle = cue.color;
        ctx.fillRect(x, 0, 1, view.height);
        const text = withNames && cue.name ? `${cue.label} ${cue.name}` : cue.label;
        const w = Math.ceil(ctx.measureText(text).width) + 6;
        const tabY = withNames ? view.height - 14 : 0;
        ctx.fillRect(x, tabY, w, 12);
        ctx.fillStyle = '#000000';
        ctx.fillText(text, x + 3, tabY + 6.5);
    }
};

export const drawPlayhead = (ctx: CanvasRenderingContext2D, view: View, seconds: number) => {
    const x = snappedX(view, seconds);
    ctx.fillStyle = PLAYHEAD;
    ctx.fillRect(x - 1, 0, 2, view.height);
};

/** Size a canvas's backing store to its CSS box at this screen's pixel ratio. */
export const fitCanvas = (canvas: HTMLCanvasElement, width: number, height: number) => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return ctx;
};
