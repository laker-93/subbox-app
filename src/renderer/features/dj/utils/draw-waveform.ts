import { DjPeaks } from '/@/renderer/features/dj/peaks/peaks-source';
import { DjMarks } from '/@/renderer/features/dj/utils/dj-marks';

// Subbox-only: drawing the DJ waveform onto a canvas (subbox-app#237, design-dj-ui
// §4.1). Pure functions of the canvas, the peaks and the marks, all in decode seconds.

// Low/mid/high, layered back to front the way Rekordbox's 3-band waveform is, so
// DJs read it without learning anything.
export const BAND_COLORS = {
    high: 'rgba(245, 245, 245, 0.95)',
    low: 'rgba(32, 110, 245, 0.95)',
    mid: 'rgba(240, 150, 40, 0.95)',
};

const LOOP_FILL = 'rgba(46, 204, 113, 0.22)';
const LOOP_EDGE = 'rgba(46, 204, 113, 0.9)';
const PLAYHEAD = '#ffffff';
const ANCHOR = '#ff3b3b';

export interface View {
    /** CSS pixels. */
    height: number;
    /** Seconds at the left edge, and seconds per CSS pixel. */
    secondsPerPx: number;
    startSeconds: number;
    width: number;
}

const xOf = (view: View, seconds: number) => (seconds - view.startSeconds) / view.secondsPerPx;

/** The loudest peak of `band` between two times, 0-1. */
const peakBetween = (band: Uint8Array, pps: number, from: number, to: number) => {
    const i0 = Math.max(0, Math.floor(from * pps));
    const i1 = Math.min(band.length, Math.max(i0 + 1, Math.ceil(to * pps)));
    let max = 0;
    for (let i = i0; i < i1; i++) if (band[i] > max) max = band[i];
    return max / 255;
};

export const drawPeaks = (
    ctx: CanvasRenderingContext2D,
    view: View,
    peaks: DjPeaks,
    top: number,
    height: number,
) => {
    const mid = top + height / 2;
    const half = height / 2;
    const pps = peaks.peaksPerSecond;
    for (const band of ['low', 'mid', 'high'] as const) {
        ctx.fillStyle = BAND_COLORS[band];
        const data = peaks[band];
        for (let x = 0; x < view.width; x++) {
            const from = view.startSeconds + x * view.secondsPerPx;
            if (from < 0 || from > peaks.durationSeconds) continue;
            const amp = peakBetween(data, pps, from, from + view.secondsPerPx);
            if (amp <= 0) continue;
            const h = Math.max(1, amp * half);
            ctx.fillRect(x, mid - h, 1, h * 2);
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
        const x0 = xOf(view, loop.startSeconds);
        const x1 = xOf(view, loop.endSeconds);
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
                `Loop ${loop.label}${loop.name ? ` ${loop.name}` : ''}`,
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
        const x = Math.round(xOf(view, beat.seconds));
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
        const x = Math.round(xOf(view, anchor.seconds));
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
        const x = Math.round(xOf(view, memory.seconds));
        if (x < -6 || x > view.width + 6) continue;
        ctx.fillStyle = memory.color;
        ctx.beginPath();
        ctx.moveTo(x - 4, view.height);
        ctx.lineTo(x + 4, view.height);
        ctx.lineTo(x, view.height - 6);
        ctx.fill();
    }
    for (const cue of marks.cues) {
        const x = Math.round(xOf(view, cue.seconds));
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
    const x = Math.round(xOf(view, seconds));
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
