import { DjPeaks, PeaksSource } from '/@/renderer/features/dj/peaks/peaks-source';
import { codecOf } from '/@/renderer/features/dj/utils/dj-offset';
import { sniffMp3Tag } from '/@/renderer/features/dj/utils/mp3-tag';
import { rawStreamUrl } from '/@/renderer/features/dj/utils/raw-stream';

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
// ~345 peaks a second, a peak every ~2.9 ms: at the detail view's closest zoom (2 s) a
// 1000 px view on a 2x screen is still ~1 peak per two device pixels, and the drawing
// interpolates the rest (#268). 150 a second went blocky there.
const WINDOW = 64;
// Band edges, Hz. Roughly where Rekordbox's and Serato's 3-band waveforms split
// (kick and bass / vocals and synths / hats and air), so DJs read it without learning.
const LOW_MID_HZ = 200;
const MID_HIGH_HZ = 2_500;
// Yield to the UI every ~2 s of audio.
const CHUNK = DECODE_RATE * 2;

export const clientDecodePeaks: PeaksSource = {
    load: async ({ song }, signal) => {
        const url = rawStreamUrl(song);
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`Couldn't fetch the track (${response.status})`);
        const encoded = await response.arrayBuffer();
        signal.throwIfAborted();
        // Before decoding: decodeAudioData detaches the buffer.
        const mp3Tag = codecOf(song.container) === 'mp3' ? sniffMp3Tag(encoded) : null;

        const context = new OfflineAudioContext(1, 1, DECODE_RATE);
        const decoded = await context.decodeAudioData(encoded);
        signal.throwIfAborted();
        const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) =>
            decoded.getChannelData(c),
        );
        return { ...(await computePeaks(channels, decoded.sampleRate, signal)), mp3Tag };
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
    // The full band, unfiltered: its peak and its RMS (the waveform's solid body).
    const full = new Float32Array(n);
    const squares = new Float32Array(n);

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
            const f = Math.abs(x);
            squares[w] += x * x;
            if (f > full[w]) full[w] = f;
            if (l > low[w]) low[w] = l;
            if (m > mid[w]) mid[w] = m;
            if (h > high[w]) high[w] = h;
        }
        if (end < length) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            signal?.throwIfAborted();
        }
    }

    const rms = new Float32Array(n);
    for (let w = 0; w < n; w++) {
        rms[w] = Math.sqrt(squares[w] / Math.min(WINDOW, length - w * WINDOW));
    }

    const maxOf = (bands: Float32Array[]) => {
        let max = 0;
        for (const band of bands) for (const v of band) if (v > max) max = v;
        return max;
    };
    const toBytes = (band: Float32Array, max: number) => {
        const out = new Uint8Array(band.length);
        if (max > 0)
            for (let i = 0; i < band.length; i++) out[i] = Math.round((band[i] / max) * 255);
        return out;
    };
    // The bands against each other, so they keep their proportions; the full band and
    // its RMS against the full band's loudest peak.
    const bandMax = maxOf([low, mid, high]);
    const fullMax = maxOf([full]);

    return {
        durationSeconds: length / sampleRate,
        full: toBytes(full, fullMax),
        high: toBytes(high, bandMax),
        low: toBytes(low, bandMax),
        mid: toBytes(mid, bandMax),
        peaksPerSecond: sampleRate / WINDOW,
        rms: toBytes(rms, fullMax),
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
