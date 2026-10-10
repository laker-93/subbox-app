import isElectron from 'is-electron';

// Subbox-only: the one place DJ-app time and decode time meet (subbox-app#237,
// design-dj-ui §3.1). The waveform and the DJ views' player seek convert through
// here, and nothing else in the client does.
//
// pymix stores every cue, loop and grid anchor in DJ-app time: where Rekordbox or
// Serato put it. Those programs both land ~46 ms after a gapless decode of an MP3, and
// subbox never had to care, because it only ever carried one program's marks to the
// other and the two errors cancelled (design-beatgrids §5). Drawing a cue on subbox's
// *own* decode breaks that cancellation: the offset between the browser's decode and
// the DJ apps' is now the only thing standing between a cue and the beat it was set on.
//
// So: stored time is DJ-app time, drawn and seeked time is decode time, and this
// converts. A positive offset means the DJ apps place a moment later than this engine's
// decode does, so a stored position is pulled earlier to draw it.

export type AudioCodec = 'flac' | 'mp3' | 'other';

export type DecodeEngine = 'chromium' | 'electron' | 'gecko' | 'webkit';

export interface OffsetContext {
    codec: AudioCodec;
    engine: DecodeEngine;
}

/** The engine decoding audio here: Electron, or the browser running the web player. */
export const currentEngine = (): DecodeEngine => {
    if (isElectron()) return 'electron';
    const ua = navigator.userAgent;
    if (/Firefox\//.test(ua)) return 'gecko';
    if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'chromium';
    if (/Safari\//.test(ua)) return 'webkit';
    return 'chromium';
};

export const codecOf = (container?: null | string): AudioCodec => {
    const c = (container || '').toLowerCase();
    if (c === 'mp3' || c === 'mpeg') return 'mp3';
    if (c === 'flac') return 'flac';
    return 'other';
};

/**
 * Milliseconds the DJ apps' clock runs ahead of each engine's decode, per codec.
 *
 * TODO(subbox-workspace#72): every value is 0 until A0 measures them. No marker ships
 * to users before that lands: a cue drawn ~46 ms off its beat is a tenth of a beat at
 * 128 BPM, and plainly wrong on the detail view.
 */
const MEASURED_OFFSET_MS: Record<DecodeEngine, Record<AudioCodec, number>> = {
    chromium: { flac: 0, mp3: 0, other: 0 },
    electron: { flac: 0, mp3: 0, other: 0 },
    gecko: { flac: 0, mp3: 0, other: 0 },
    webkit: { flac: 0, mp3: 0, other: 0 },
};

export const djOffsetMs = ({ codec, engine }: OffsetContext): number =>
    MEASURED_OFFSET_MS[engine][codec];

/** A stored (DJ-app) position in ms -> seconds on this engine's decode. */
export const djToDecodeSeconds = (djMs: number, context: OffsetContext): number =>
    (djMs - djOffsetMs(context)) / 1000;

/** Seconds on this engine's decode -> a DJ-app position in ms, for writing back. */
export const decodeSecondsToDj = (decodeSeconds: number, context: OffsetContext): number =>
    decodeSeconds * 1000 + djOffsetMs(context);
