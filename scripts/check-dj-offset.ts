import assert from 'node:assert/strict';

import { djMarks } from '../src/renderer/features/dj/utils/dj-marks';
import {
    appOf,
    AudioCodec,
    codecOf,
    DecodeEngine,
    DjApp,
    djOffsetMs,
    djToDecodeSeconds,
    markContext,
} from '../src/renderer/features/dj/utils/dj-offset';
import { sniffMp3Tag, webkitMp3LagSamples } from '../src/renderer/features/dj/utils/mp3-tag';

// Check for subbox-app#252: dj_offset carries A0's measured values (subbox-workspace#72),
// per DJ app, codec and sample rate, with WebKit's MP3 term read off the file's LAME
// tag. The MP3s are synthesised: only the first frame matters, so each is one frame
// header and a Xing/Info header, no audio.
//
// Usage: pnpm run check:dj-offset

const near = (actual: number, expected: number, message: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);

/** One MPEG-1 Layer III frame at 128 kbps, with an Info header and a LAME extension. */
const mp3Frame = ({
    encoder,
    id3 = false,
    mono = false,
    rate = 44_100,
}: {
    encoder?: string;
    id3?: boolean;
    mono?: boolean;
    rate?: 44_100 | 48_000;
}) => {
    const frame = new Uint8Array(417);
    frame.set([0xff, 0xfb, rate === 44_100 ? 0x90 : 0x94, mono ? 0xc0 : 0x00]);
    if (encoder) {
        let at = 4 + (mono ? 17 : 32);
        frame.set(Buffer.from('Info'), at);
        frame.set([0, 0, 0, 0x0f], at + 4); // frames, bytes, seek table, quality
        at += 8 + 4 + 4 + 100 + 4;
        frame.set(Buffer.from(encoder.padEnd(9, '\0')), at);
        // Delay 576, padding 1000: 12 bits each.
        const v = (576 << 12) | 1000;
        frame.set([v >> 16, (v >> 8) & 0xff, v & 0xff], at + 21);
    }
    if (!id3) return frame;
    // An ID3v2.4 tag of 300 bytes (syncsafe: 2 << 7 | 44).
    const tag = new Uint8Array(310);
    tag.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 2, 44]);
    return new Uint8Array([...tag, ...frame]);
};

// --- the LAME-tag sniffer ---

const lame = sniffMp3Tag(mp3Frame({ encoder: 'LAME3.100' }));
assert.deepEqual(lame, { delaySamples: 576, encoder: 'LAME3.100', sampleRate: 44_100 });
const lavc = sniffMp3Tag(mp3Frame({ encoder: 'Lavc60.31', id3: true, rate: 48_000 }));
assert.deepEqual(lavc, { delaySamples: 576, encoder: 'Lavc60.31', sampleRate: 48_000 });
const lavcMono = sniffMp3Tag(mp3Frame({ encoder: 'Lavc60.31', mono: true }));
assert.equal(lavcMono?.encoder, 'Lavc60.31', 'mono: the Info header is 17 bytes of side info in');
const bare = sniffMp3Tag(mp3Frame({ id3: true }));
assert.deepEqual(bare, { delaySamples: null, encoder: null, sampleRate: 44_100 });
assert.equal(sniffMp3Tag(Buffer.from('fLaC\0\0\0\x22')), null, 'not an MP3');

// A0's three WebKit cases, in samples behind ffmpeg's decode.
assert.equal(webkitMp3LagSamples(lame!), 0, 'lame CLI tag: WebKit trims like ffmpeg');
assert.equal(webkitMp3LagSamples(lavc!), 576, 'Lavc tag: WebKit keeps the encoder delay');
assert.equal(webkitMp3LagSamples(bare!), -529, 'no tag: WebKit trims what ffmpeg keeps');

// --- the table: (app, codec, sampleRate, engine) ---

const BROWSERS: DecodeEngine[] = ['chromium', 'electron', 'gecko', 'webkit'];
const MEASURED: [DjApp, AudioCodec, number, number][] = [
    ['rekordbox', 'mp3', 44_100, 50.0],
    ['rekordbox', 'mp3', 48_000, 48.0],
    ['rekordbox', 'flac', 44_100, 25.0],
    ['rekordbox', 'flac', 48_000, 25.0],
    ['serato', 'mp3', 44_100, 45.5],
    ['serato', 'mp3', 48_000, 41.4],
    ['serato', 'flac', 44_100, -2.5],
    ['serato', 'flac', 48_000, -2.5],
    // Unmeasured, the nearest measured (TODO in dj-offset.ts).
    ['rekordbox', 'wav', 44_100, 25.0],
    ['serato', 'aiff', 48_000, -2.5],
    ['rekordbox', 'mp3', 32_000, 50.0],
    ['serato', 'mp3', 96_000, 41.4],
    ['rekordbox', 'aac', 44_100, 0],
    ['serato', 'other', 44_100, 0],
];
for (const [app, codec, sampleRate, expected] of MEASURED) {
    for (const engine of BROWSERS) {
        // WebKit with a `lame` CLI tag decodes as ffmpeg does, so it takes the app's too.
        const mp3Tag = codec === 'mp3' ? lame : null;
        near(
            djOffsetMs({ app, codec, engine, mp3Tag, sampleRate }),
            expected,
            `${app} ${codec} ${sampleRate} ${engine}`,
        );
    }
}

// WebKit MP3 without a recognised tag: the app's offset less WebKit's lag.
const lavc44 = { ...lavc!, sampleRate: 44_100 };
near(
    djOffsetMs({
        app: 'rekordbox',
        codec: 'mp3',
        engine: 'webkit',
        mp3Tag: lavc44,
        sampleRate: 44_100,
    }),
    50.0 - (576 / 44_100) * 1000,
    'webkit Lavc 44.1 (+13.06 ms decode)',
);
near(
    djOffsetMs({ app: 'serato', codec: 'mp3', engine: 'webkit', mp3Tag: lavc, sampleRate: 48_000 }),
    41.4 - 12.0,
    'webkit Lavc 48 (+12.00 ms decode)',
);
near(
    djOffsetMs({ app: 'serato', codec: 'mp3', engine: 'webkit', mp3Tag: bare, sampleRate: 44_100 }),
    45.5 + (529 / 44_100) * 1000,
    'webkit untagged 44.1 (-12.00 ms decode)',
);
// The same tags change nothing anywhere else.
for (const engine of ['chromium', 'electron', 'gecko'] as DecodeEngine[]) {
    for (const mp3Tag of [lavc44, bare]) {
        const ctx = { app: 'rekordbox', codec: 'mp3', engine, mp3Tag, sampleRate: 44_100 } as const;
        near(djOffsetMs(ctx), 50.0, `${engine} ignores the MP3 tag`);
    }
}
// No DJ app behind a mark (an edit): decode time, but still WebKit's own lag.
near(djOffsetMs({ app: null, codec: 'flac', engine: 'chromium' }), 0, 'edit: decode time');
near(
    djOffsetMs({ app: null, codec: 'mp3', engine: 'webkit', mp3Tag: lavc44 }),
    -(576 / 44_100) * 1000,
    'edit on webkit Lavc',
);

// --- which app a mark is in ---

assert.equal(appOf('import:rekordbox', 'serato'), 'rekordbox');
assert.equal(appOf('import:serato', 'rekordbox'), 'serato');
assert.equal(appOf('file', 'rekordbox'), 'serato', 'file: a Serato GEOB read at ingest');
assert.equal(appOf(null, 'rekordbox'), 'rekordbox', 'no origin: the row source_app');
assert.equal(appOf(undefined, 'file'), 'serato');
assert.equal(
    appOf('edit', 'serato', 'serato'),
    'serato',
    "an edit is in its track's edit_clock (#241)",
);
assert.equal(
    appOf('edit', 'serato'),
    'rekordbox',
    'an edit from before edit_clock: Rekordbox, as pymix chose',
);
assert.equal(appOf('analysis', 'rekordbox'), null, 'analysis has no DJ app yet');
assert.equal(appOf('recipe:3', 'serato'), null);
assert.equal(appOf(null, null), null);

assert.equal(codecOf('mp3'), 'mp3');
assert.equal(codecOf('mpeg'), 'mp3');
assert.equal(codecOf('x-wav'), 'wav');
assert.equal(codecOf('aif'), 'aiff');
assert.equal(codecOf('m4a'), 'aac');
assert.equal(codecOf('ogg'), 'other');

// --- per mark, not per track: a Rekordbox grid and a Serato cue on one FLAC ---

const track = {
    codec: 'flac',
    engine: 'electron',
    sampleRate: 44_100,
    sourceApp: 'rekordbox',
} as const;
const marks = djMarks(
    {
        beatgrid: [{ bpm: 120, position_ms: 1000 }],
        beatgrid_meta: { origin: 'import:rekordbox' },
        cues: [{ index: 0, origin: 'import:serato', position: 2000 }],
        loops: [{ end: 6000, index: 0, origin: null, start: 4000 }],
        memory: [{ origin: 'file', position: 8000, type: 'cue' }],
    },
    30,
    track,
);
near(marks.anchors[0].seconds, (1000 - 25) / 1000, 'Rekordbox grid: 25 ms earlier');
near(
    marks.beats.find((beat) => beat.isAnchor)!.seconds,
    (1000 - 25) / 1000,
    'beats follow the grid origin',
);
near(marks.cues[0].seconds, (2000 + 2.5) / 1000, 'Serato cue: 2.5 ms later');
near(marks.loops[0].startSeconds, (4000 - 25) / 1000, 'no origin: source_app (Rekordbox)');
near(marks.loops[0].endSeconds, (6000 - 25) / 1000, 'a loop end converts like its start');
near(marks.memory[0].seconds, (8000 + 2.5) / 1000, 'file: Serato');
near(
    djToDecodeSeconds(2000, markContext(track, 'import:serato')),
    marks.cues[0].seconds,
    'the play buttons and the drawing agree',
);

console.log('dj-offset: every check passed');
