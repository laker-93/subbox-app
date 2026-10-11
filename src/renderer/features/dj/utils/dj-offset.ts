import isElectron from 'is-electron';

import { Mp3Tag, webkitMp3LagSamples } from '/@/renderer/features/dj/utils/mp3-tag';

// Subbox-only: the one place DJ-app time and decode time meet (subbox-app#237, #252,
// design-dj-ui §3.1). The waveform, the playerbar markers and the DJ views' player seek
// convert through here, and nothing else in the client does.
//
// pymix stores every cue, loop and grid anchor in DJ-app time: where Rekordbox or
// Serato put it. subbox never had to care while it only carried one app's marks to the
// other, because the two apps' errors mostly cancel (design-beatgrids §5). Drawing a
// cue on subbox's *own* decode breaks that cancellation.
//
// So: stored time is DJ-app time, drawn and seeked time is decode time, and this
// converts: decode_ms = stored_ms - djOffsetMs(...). A positive offset means the DJ app
// places a moment later than this engine's decode does, so a stored position is pulled
// earlier to draw it.
//
// Measured in A0 (subbox-workspace#72, scripts/dj-offset/results/2026-10-11-a0-findings.md
// in subbox-workspace), which chains onto B0.3's DJ-app measurements against the same
// ffmpeg decode:
// - Electron, Chrome and Firefox decode exactly as ffmpeg does, on every format, so the
//   offset is the DJ app's alone. It depends on the app, codec and sample rate.
// - WebKit adds a term on MP3 only, set by the file's LAME tag (mp3-tag.ts).
// - The app is per mark, not per track: a track can hold a Rekordbox grid and a Serato
//   cue, so each mark converts through its own `origin` (markContext).

export type AudioCodec = 'aac' | 'aiff' | 'flac' | 'mp3' | 'other' | 'wav';

export type DecodeEngine = 'chromium' | 'electron' | 'gecko' | 'webkit';

export type DjApp = 'rekordbox' | 'serato';

/** One mark's: the track's, plus the app that placed it (null: not a DJ app). */
export interface OffsetContext extends Omit<TrackOffsetContext, 'sourceApp'> {
    app: DjApp | null;
}

/** One track's side of the offset: everything but which app placed the mark. */
export interface TrackOffsetContext {
    codec: AudioCodec;
    engine: DecodeEngine;
    /** From the waveform's fetch of the original file. Only WebKit MP3 needs it. */
    mp3Tag?: Mp3Tag | null;
    /** Navidrome's, Hz. */
    sampleRate?: null | number;
    /** The DJ row's `source_app`: the app for a mark with no `origin`. */
    sourceApp?: null | string;
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

/** From Navidrome's suffix (`mp3`) or Subsonic's content subtype (`mpeg`, `x-wav`). */
export const codecOf = (container?: null | string): AudioCodec => {
    const c = (container || '').toLowerCase().replace(/^x-/, '');
    if (c === 'mp3' || c === 'mpeg') return 'mp3';
    if (c === 'flac') return 'flac';
    if (c === 'wav' || c === 'wave') return 'wav';
    if (c === 'aif' || c === 'aiff' || c === 'aifc') return 'aiff';
    if (c === 'aac' || c === 'm4a' || c === 'mp4') return 'aac';
    return 'other';
};

/**
 * The app whose clock a mark is in, from its `origin` (pymix's cuedata_origin.py).
 * `file` is a Serato GEOB frame read at ingest. A mark with no origin predates origins
 * and is the row's `source_app`'s, which is `file` for the same GEOB read.
 */
export const appOf = (origin: null | string | undefined, sourceApp?: null | string) => {
    const app = origin || sourceApp;
    if (app === 'import:rekordbox' || app === 'rekordbox') return 'rekordbox';
    if (app === 'import:serato' || app === 'serato' || app === 'file') return 'serato';
    // TODO(subbox-app#241): `edit`, and later `analysis` and `recipe:`, have no DJ app
    // behind them, and their time convention is decided there. Nothing writes them yet;
    // until then they read as decode time.
    return null;
};

/** The context one mark converts through. */
export const markContext = (
    { sourceApp, ...track }: TrackOffsetContext,
    origin: null | string | undefined,
): OffsetContext => ({ ...track, app: appOf(origin, sourceApp) });

/**
 * Milliseconds each DJ app places a moment after ffmpeg's decode does (B0.3). FLAC
 * doesn't vary with the rate; MP3 does, by the app.
 */
const APP_OFFSET_MS: Record<DjApp, { flac: number; mp3: Record<44_100 | 48_000, number> }> = {
    rekordbox: { flac: 25.0, mp3: { 44_100: 50.0, 48_000: 48.0 } },
    serato: { flac: -2.5, mp3: { 44_100: 45.5, 48_000: 41.4 } },
};

const appOffsetMs = (app: DjApp, codec: AudioCodec, sampleRate: null | number | undefined) => {
    const measured = APP_OFFSET_MS[app];
    switch (codec) {
        case 'aac':
        case 'other':
            // TODO(subbox-workspace#72): unmeasured in both apps, and AAC's priming
            // isn't like MP3's or FLAC's, so nothing measured is near. Drawn as decoded.
            return 0;
        case 'aiff':
        case 'wav':
            // TODO(subbox-workspace#72): unmeasured in both apps. Uncompressed, so
            // FLAC's (no encoder delay either) is the nearest measured.
            return measured.flac;
        case 'flac':
            return measured.flac;
        case 'mp3':
            // TODO(subbox-workspace#72): only 44.1 and 48 kHz, on tagged files, were
            // measured: another rate takes the nearer, and a header-less MP3 (ffmpeg
            // keeps its delay there) or Rekordbox on a `lame` CLI tag is unmeasured.
            // An unknown rate is taken as 44.1, the common one.
            return measured.mp3[(sampleRate ?? 44_100) >= 46_050 ? 48_000 : 44_100];
    }
};

/**
 * Milliseconds this engine's decode runs behind ffmpeg's: 0 everywhere A0 measured,
 * except WebKit MP3, where it's the file's LAME tag (mp3-tag.ts).
 */
const engineLagMs = ({ codec, engine, mp3Tag }: OffsetContext) => {
    if (engine !== 'webkit' || codec !== 'mp3') return 0;
    // Without the tag (the playerbar, which never fetches the file) take the
    // recognised-tag case, 0: there a pixel is hundreds of ms, and an error of ±13 ms
    // doesn't show.
    if (!mp3Tag) return 0;
    return (webkitMp3LagSamples(mp3Tag) / mp3Tag.sampleRate) * 1000;
};

/** Milliseconds the mark's DJ app runs ahead of this engine's decode. */
export const djOffsetMs = (context: OffsetContext): number => {
    const app = context.app ? appOffsetMs(context.app, context.codec, context.sampleRate) : 0;
    return app - engineLagMs(context);
};

/** A stored (DJ-app) position in ms -> seconds on this engine's decode. */
export const djToDecodeSeconds = (djMs: number, context: OffsetContext): number =>
    (djMs - djOffsetMs(context)) / 1000;

/** Seconds on this engine's decode -> a DJ-app position in ms, for writing back. */
export const decodeSecondsToDj = (decodeSeconds: number, context: OffsetContext): number =>
    decodeSeconds * 1000 + djOffsetMs(context);
