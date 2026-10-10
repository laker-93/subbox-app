import { api } from '/@/renderer/api';
import { DjPeaks, PeaksSource } from '/@/renderer/features/dj/peaks/peaks-source';

// Subbox-only: peaks from the browser's own decode of the original file (subbox-app#237,
// design-dj-ui §4.2, track A).
//
// Always the original (`format=raw`), whatever transcoding the user has set for
// playback: a transcode is a re-encode, and its encoder delay has nothing to do with the
// original's, so markers placed in DJ-app time would land somewhere else on it (§3.1).
//
// Decoded at DECODE_RATE rather than the file's own rate: the browser resamples during
// decodeAudioData, which keeps time exactly and halves the memory and the work. 11 kHz
// is still above the high band. The decoded buffer is dropped as soon as the peaks are
// out of it: a 10-minute stereo track is ~200 MB of float32 at 44.1 kHz.

const DECODE_RATE = 22_050;
// ~150 peaks a second: a peak every ~7 ms, finer than the detail view's closest zoom.
const WINDOW = 147;
// Band edges, Hz. Roughly where Rekordbox's and Serato's 3-band waveforms split
// (kick and bass / vocals and synths / hats and air), so DJs read it without learning.
const LOW_MID_HZ = 200;
const MID_HIGH_HZ = 2_500;
// Yield to the UI every ~2 s of audio.
const CHUNK = DECODE_RATE * 2;

export const clientDecodePeaks: PeaksSource = {
    load: async ({ song }, signal) => {
        const url = api.controller.getStreamUrl({
            apiClientProps: { serverId: song._serverId },
            query: { format: 'raw', id: song.id, transcode: true },
        });
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`Couldn't fetch the track (${response.status})`);
        const encoded = await response.arrayBuffer();
        signal.throwIfAborted();

        const context = new OfflineAudioContext(1, 1, DECODE_RATE);
        const decoded = await context.decodeAudioData(encoded);
        signal.throwIfAborted();
        const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) =>
            decoded.getChannelData(c),
        );
        return computePeaks(channels, decoded.sampleRate, signal);
    },
};

/** Exported for tests. `channels` are released by the caller once this resolves. */
export const computePeaks = async (
    channels: Float32Array[],
    sampleRate: number,
    signal?: AbortSignal,
): Promise<DjPeaks> => {
    const length = channels[0]?.length ?? 0;
    const n = Math.ceil(length / WINDOW);
    const low = new Float32Array(n);
    const mid = new Float32Array(n);
    const high = new Float32Array(n);

    const lowpass = biquad('lowpass', LOW_MID_HZ, sampleRate);
    const midHighpass = biquad('highpass', LOW_MID_HZ, sampleRate);
    const midLowpass = biquad('lowpass', MID_HIGH_HZ, sampleRate);
    const highpass = biquad('highpass', MID_HIGH_HZ, sampleRate);
    const scale = 1 / Math.max(channels.length, 1);

    for (let start = 0; start < length; start += CHUNK) {
        const end = Math.min(start + CHUNK, length);
        for (let i = start; i < end; i++) {
            let x = 0;
            for (const channel of channels) x += channel[i];
            x *= scale;
            const w = (i / WINDOW) | 0;
            const l = Math.abs(lowpass(x));
            const m = Math.abs(midLowpass(midHighpass(x)));
            const h = Math.abs(highpass(x));
            if (l > low[w]) low[w] = l;
            if (m > mid[w]) mid[w] = m;
            if (h > high[w]) high[w] = h;
        }
        if (end < length) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            signal?.throwIfAborted();
        }
    }

    let max = 0;
    for (const band of [low, mid, high]) for (const v of band) if (v > max) max = v;
    const toBytes = (band: Float32Array) => {
        const out = new Uint8Array(band.length);
        if (max > 0)
            for (let i = 0; i < band.length; i++) out[i] = Math.round((band[i] / max) * 255);
        return out;
    };

    return {
        durationSeconds: length / sampleRate,
        high: toBytes(high),
        low: toBytes(low),
        mid: toBytes(mid),
        peaksPerSecond: sampleRate / WINDOW,
    };
};

/** One RBJ-cookbook biquad (Q = 1/√2), as a stateful sample -> sample function. */
const biquad = (type: 'highpass' | 'lowpass', hz: number, sampleRate: number) => {
    const w0 = (2 * Math.PI * hz) / sampleRate;
    const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
    const cos = Math.cos(w0);
    const a0 = 1 + alpha;
    const b1 = (type === 'lowpass' ? 1 - cos : -(1 + cos)) / a0;
    const b0 = (type === 'lowpass' ? (1 - cos) / 2 : (1 + cos) / 2) / a0;
    const b2 = b0;
    const a1 = (-2 * cos) / a0;
    const a2 = (1 - alpha) / a0;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    return (x: number) => {
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        return y;
    };
};
