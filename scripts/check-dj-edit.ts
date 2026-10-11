import assert from 'node:assert/strict';

import {
    editClockOf,
    fieldsOf,
    snapSeconds,
    toStoredMs,
    touchesSameField,
} from '../src/renderer/features/dj/utils/dj-edit';
import { BeatMark } from '../src/renderer/features/dj/utils/dj-marks';
import {
    djToDecodeSeconds,
    markContext,
    TrackOffsetContext,
} from '../src/renderer/features/dj/utils/dj-offset';
import { DjCuedata } from '../src/shared/api/pymix/pymix-types';

// Check for subbox-app#241: the prep view's edits are written in the clock pymix#291
// picks, a position round-trips through it, snapping lands on the grid, and a 409
// reapplies an edit only when the other device changed something else (§10 Q7).
//
// Usage: pnpm run check:dj-edit

const near = (actual: number, expected: number, message: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);

const cuedata = (extra: Partial<DjCuedata> = {}): DjCuedata => ({ cues: [], loops: [], ...extra });

// --- the clock: as pymix's dj_edit.clock_of ---
assert.equal(editClockOf(cuedata({ edit_clock: 'serato' }), 'rekordbox'), 'serato', 'kept');
assert.equal(editClockOf(cuedata(), 'rekordbox'), 'rekordbox', 'the row');
assert.equal(editClockOf(cuedata(), 'file'), 'serato', 'a file read is Serato');
assert.equal(
    editClockOf(cuedata({ beatgrid_meta: { origin: 'import:serato' } }), 'subbox'),
    'serato',
    'subbox names no app: the grid',
);
assert.equal(
    editClockOf(cuedata({ cues: [{ index: 0, origin: 'file', position: 1 }] }), 'subbox'),
    'serato',
    'then the marks',
);
assert.equal(
    editClockOf(cuedata({ cues: [{ index: 0, origin: 'edit', position: 1 }] }), 'subbox'),
    'rekordbox',
    'an edit names no app; nothing does: Rekordbox',
);
assert.equal(editClockOf(null, null), 'rekordbox');

// --- a position round-trips: drawn where it's stored ---
const track: TrackOffsetContext = { codec: 'flac', engine: 'electron', sampleRate: 44_100 };
for (const clock of ['rekordbox', 'serato'] as const) {
    const stored = toStoredMs(12.345, track, clock);
    near(
        djToDecodeSeconds(stored, markContext({ ...track, editClock: clock }, 'edit')),
        12.345,
        `${clock}: an edit draws where it was put`,
    );
}
near(
    toStoredMs(1, track, 'rekordbox') - toStoredMs(1, track, 'serato'),
    27.5,
    'FLAC: 27.5 ms apart',
);

// --- snapping ---
const beats: BeatMark[] = [0, 0.5, 1, 1.5, 2, 2.5].map((seconds, i) => ({
    bar: Math.floor(i / 4) + 1,
    isAnchor: i === 0,
    isDownbeat: i % 4 === 0,
    seconds,
}));
assert.equal(snapSeconds(0.7, beats, 'beat'), 0.5);
assert.equal(snapSeconds(1.4, beats, 'bar'), 2);
assert.equal(snapSeconds(0.7, beats, 'off'), 0.7);
assert.equal(snapSeconds(0.7, [], 'beat'), 0.7, 'no grid: where it was');

// --- what an edit touches, for a 409 ---
assert.deepEqual(fieldsOf({ cue: { slot: 2, value: null } }), ['cue:2']);
assert.deepEqual(fieldsOf({ cue: { from_slot: 0, slot: 5 } }), ['cue:5', 'cue:0'], 'a move: both');
assert.deepEqual(fieldsOf({ grid: { locked: true } }), ['grid']);
const base = cuedata({ cues: [{ index: 0, origin: 'import:rekordbox', position: 1000 }] });
const otherPadChanged = cuedata({
    cues: [...base.cues, { index: 1, origin: 'edit', position: 2000 }],
});
assert.equal(
    touchesSameField({ cue: { slot: 0, value: { position: 900 } } }, base, otherPadChanged),
    false,
    'another pad changed: reapply',
);
const samePadChanged = cuedata({ cues: [{ index: 0, origin: 'edit', position: 1100 }] });
assert.equal(
    touchesSameField({ cue: { slot: 0, value: { position: 900 } } }, base, samePadChanged),
    true,
    'the same pad changed: ask',
);
assert.equal(
    touchesSameField({ cue: { from_slot: 0, slot: 3 } }, base, samePadChanged),
    true,
    'a move from a pad that changed: ask',
);

console.log('dj-edit: every check passed');
