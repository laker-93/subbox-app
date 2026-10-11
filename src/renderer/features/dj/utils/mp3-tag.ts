// Subbox-only: what an MP3's first frame says about its encoder delay (subbox-app#252).
//
// WebKit's decoder only trims an MP3's encoder delay when it recognises the LAME tag,
// and it doesn't recognise all of them (A0, subbox-workspace#72). So on WebKit a marker's
// offset depends on the file's tag, read here from the bytes the waveform already
// fetched. Only the first frame matters, so no extra fetch.

/** The decoder delay every MP3 decoder adds (MPEG Layer III's own), in samples. */
export const DECODER_DELAY_SAMPLES = 529;

export interface Mp3Tag {
    /** Encoder delay from the LAME extension, samples; null when there's no LAME extension. */
    delaySamples: null | number;
    /** The LAME extension's encoder string (`LAME3.100`, `Lavc60.31`), or null. */
    encoder: null | string;
    /** The first frame's sample rate, Hz. */
    sampleRate: number;
}

// Hz, by the header's version bits: MPEG 1, 2 and 2.5.
const SAMPLE_RATES: Record<number, number[]> = {
    0: [11_025, 12_000, 8_000],
    2: [22_050, 24_000, 16_000],
    3: [44_100, 48_000, 32_000],
};

// How far past ID3v2 to look for the first frame sync.
const SCAN_BYTES = 4096;

const ascii = (bytes: Uint8Array, at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));

const u32 = (bytes: Uint8Array, at: number) =>
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

/**
 * The first Layer III frame's sample rate and, if it carries a Xing/Info header with a
 * LAME extension, the encoder string and delay. Null when no frame is found.
 */
export const sniffMp3Tag = (data: ArrayBuffer | Uint8Array): Mp3Tag | null => {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

    let at = 0;
    // ID3v2: a 10-byte header, a syncsafe size, and a 10-byte footer when flagged.
    if (ascii(bytes, 0, 3) === 'ID3' && bytes.length >= 10) {
        const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
        at = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
    }

    const end = Math.min(at + SCAN_BYTES, bytes.length - 4);
    for (; at < end; at++) {
        if (bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) continue;
        const version = (bytes[at + 1] >> 3) & 3;
        const layer = (bytes[at + 1] >> 1) & 3;
        const rateIndex = (bytes[at + 2] >> 2) & 3;
        const bitrateIndex = bytes[at + 2] >> 4;
        // Layer III (01), not a reserved version, rate or bitrate.
        if (layer !== 1 || !SAMPLE_RATES[version] || rateIndex === 3) continue;
        if (bitrateIndex === 0 || bitrateIndex === 15) continue;
        return readInfo(bytes, at, version, SAMPLE_RATES[version][rateIndex]);
    }
    return null;
};

const readInfo = (bytes: Uint8Array, frame: number, version: number, sampleRate: number) => {
    const none: Mp3Tag = { delaySamples: null, encoder: null, sampleRate };
    const mono = bytes[frame + 3] >> 6 === 3;
    // The Xing/Info header sits after the 4-byte header and the side information.
    const sideInfo = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
    let at = frame + 4 + sideInfo;
    const id = ascii(bytes, at, 4);
    if (id !== 'Xing' && id !== 'Info') return none;
    const flags = u32(bytes, at + 4);
    at += 8;
    if (flags & 1) at += 4; // frames
    if (flags & 2) at += 4; // bytes
    if (flags & 4) at += 100; // seek table
    if (flags & 8) at += 4; // quality
    // The LAME extension: a 9-byte encoder string, then the delay 21 bytes in.
    if (at + 24 > bytes.length) return none;
    const encoder = ascii(bytes, at, 9).replace(/\0+$/, '').trim();
    if (!/^[\x20-\x7e]+$/.test(encoder)) return none;
    const delaySamples = (bytes[at + 21] << 4) | (bytes[at + 22] >> 4);
    return { delaySamples, encoder, sampleRate };
};

// ffmpeg (so Chromium, and B0.3's reference) reads the delay from these encoders' tags
// and trims it plus the decoder's own; from any other tag, or none, it trims nothing.
const FFMPEG_READS = /^(LAME|Lavc|Lavf)/;
// WebKit only recognises LAME's own tag. Otherwise it trims the decoder delay alone.
const WEBKIT_READS = /^LAME/;

/**
 * Samples WebKit's decode of this file runs behind ffmpeg's (positive: later).
 * A0 measured 0 on a `lame` CLI tag, +576 on ffmpeg's `Lavc` tag (its delay) and -529
 * with no Xing/LAME frame.
 *
 * TODO(subbox-workspace#72): a `Lavf` tag and other encoders' tags are modelled, not
 * measured, and Playwright's WebKit stood in for Safari.
 */
export const webkitMp3LagSamples = (tag: Mp3Tag): number => {
    const { delaySamples, encoder } = tag;
    const reads = (decoder: RegExp) => delaySamples != null && !!encoder && decoder.test(encoder);
    const tagged = (delaySamples ?? 0) + DECODER_DELAY_SAMPLES;
    const ffmpeg = reads(FFMPEG_READS) ? tagged : 0;
    const webkit = reads(WEBKIT_READS) ? tagged : DECODER_DELAY_SAMPLES;
    return ffmpeg - webkit;
};
