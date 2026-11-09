import assert from 'node:assert/strict';

import {
    plannedTrackKey,
    splitDriveMissing,
} from '../src/renderer/features/sync/components/shared/drive-compare';

// External Drive downloads only tracks missing from both the drive and this
// computer (#315). These check the split that decides it.
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

// A song in two selected playlists is listed twice by the plan: shown twice,
// fetched once.
{
    const split = splitDriveMissing([a, { ...a }, b], [a, a]);
    assert.equal(split.toDownload.length, 1);
    assert.equal(plannedTrackKey(split.toDownload[0]), plannedTrackKey(a));
    assert.deepEqual(split.onComputer, [b]);
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
