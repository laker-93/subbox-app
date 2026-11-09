import assert from 'node:assert/strict';

import {
    plannedTrackKey,
    splitDriveMissing,
} from '../src/renderer/features/sync/components/shared/drive-compare';

// Download's drive check splits the tracks a drive is missing into those on
// this computer and those to download first (#315, #314). These check the split.
//
// Usage: pnpm run check:drive-compare

const a = { album: 'A', artist: 'Artist', title: 'One' };
const b = { album: 'A', artist: 'Artist', title: 'Two' };
const c = { artist: 'Other', title: 'Three' };

// A track missing from the drive that is local is not downloaded.
{
    const split = splitDriveMissing([a, b, c], [b]);
    assert.deepEqual(split.onComputer, [a, c]);
    assert.deepEqual(split.toDownload, [b]);
}

// Nothing local: everything missing from the drive is downloaded.
{
    const split = splitDriveMissing([a, b], [a, b]);
    assert.deepEqual(split.onComputer, []);
    assert.deepEqual(split.toDownload, [a, b]);
}

// The local plan failed: download what was downloaded before #315.
{
    const split = splitDriveMissing([a, b], null);
    assert.deepEqual(split.onComputer, []);
    assert.deepEqual(split.toDownload, [a, b]);
}

// A song in two selected playlists is listed twice by the plan: one file, so
// listed once, on either side of the split.
{
    const split = splitDriveMissing([a, { ...a }, b, { ...b }], [a, a]);
    assert.equal(split.toDownload.length, 1);
    assert.equal(plannedTrackKey(split.toDownload[0]), plannedTrackKey(a));
    assert.equal(split.onComputer.length, 1);
    assert.ok(split.onComputer[0] === b);
}

// The album is part of the key, and a missing album is the same as an empty one.
{
    assert.notEqual(plannedTrackKey(a), plannedTrackKey({ ...a, album: 'B' }));
    assert.equal(plannedTrackKey(c), plannedTrackKey({ ...c, album: '' }));
}

// Each row stays the plan's own object, so the preview can mark it by identity.
{
    const split = splitDriveMissing([a, b], [b]);
    assert.ok(split.onComputer[0] === a);
}

console.log('check-drive-compare: ok');
