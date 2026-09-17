import assert from 'node:assert/strict';

import {
    describeJobWork,
    type ImportProgress,
} from '../src/renderer/features/sync/components/shared/job-envelope';

// What the sync screens are allowed to conclude from a finished job.
//
// The defect this guards (laker-93/subbox-app#50): a re-import of a library that
// is already uploaded applies BPM, ratings and cue points to every track and lands
// no new audio. Both numbers the screen had — `uploaded` and `n_tracks_processed`
// — correctly read 0, and the run was reported as "Imported 0 tracks". The server
// now reports per-phase counts (pymix migration 019) and this is the reading of
// them, so the rules below are the ones a screen must not get wrong again:
//
//   1. A phase the server reported work for is said out loud.
//   2. No `phases` means NOT REPORTED. It must never render as zero work — every
//      job completed without a ledger, and every server older than migration 019,
//      arrives that way, and telling those users their import did nothing is the
//      same bug wearing the other face.
//   3. A phase this client has no wording for renders nothing, rather than a raw
//      phase name. Servers ship ahead of clients.
//
// subbox-app has no unit-test runner; this is the repo's own `check:` convention.
//
// Usage: pnpm run check:job-outcome

const METADATA_LINE = 'Metadata updated on 5 tracks (BPM, ratings, cue points)';

function phase(
    name: string,
    counts: Partial<{ failed: number; ok: number; skipped: number; total: number }> = {},
) {
    return { failed: 0, ok: 0, phase: name, skipped: 0, total: 0, ...counts };
}

function progress(overrides: Partial<ImportProgress> = {}): ImportProgress {
    return {
        in_progress: false,
        n_tracks_processed: 0,
        n_tracks_to_process: 0,
        percentage_complete: 100,
        reason: '',
        result: true,
        ...overrides,
    };
}

// --- 1. the metadata pass is reported, on the run that reads as doing nothing --

assert.deepEqual(
    describeJobWork(
        progress({
            phases: [
                phase('mapping_ids', { ok: 5, total: 5 }),
                phase('applying_metadata', { ok: 5, total: 5 }),
            ],
        }),
    ),
    [METADATA_LINE],
    'the metadata pass must be reported — this is the line #50 was missing',
);

// `mapping_ids` is plumbing the user has no model of, so it is deliberately not
// in that list. If it ever gains wording, it is this assertion that should fail.
assert.deepEqual(
    describeJobWork(progress({ phases: [phase('mapping_ids', { ok: 5, total: 5 })] })),
    [],
    'mapping_ids is internal; it must not be narrated to the user',
);

// --- 2. not reported is not the same as nothing happened ---------------------

for (const absent of [undefined, null]) {
    assert.deepEqual(
        describeJobWork(progress({ phases: absent })),
        [],
        'an unreported job must produce no claims at all',
    );
}
assert.deepEqual(describeJobWork(undefined), [], 'no job at all must produce no claims');
assert.deepEqual(describeJobWork(null), [], 'no job at all must produce no claims');

// A phase that genuinely did nothing says nothing, rather than "updated on 0".
assert.deepEqual(
    describeJobWork(progress({ phases: [phase('applying_metadata', { skipped: 3, total: 3 })] })),
    [],
    'a phase with no successes must not claim any',
);

// --- 3. a newer server than this client ---------------------------------------

assert.deepEqual(
    describeJobWork(
        progress({
            phases: [
                phase('awaiting_visibility', { ok: 9, total: 9 }),
                phase('applying_metadata', { ok: 5, total: 5 }),
            ],
        }),
    ),
    [METADATA_LINE],
    'an unknown phase must be passed over, not rendered as a raw name',
);

// --- the counts are the server's, not ours ------------------------------------

assert.deepEqual(
    describeJobWork(
        progress({ phases: [phase('applying_metadata', { failed: 4, ok: 1, total: 5 })] }),
    ),
    ['Metadata updated on 1 track (BPM, ratings, cue points)'],
    'a partial pass reports what it did, singular where it should be',
);

console.log('check:job-outcome — all assertions passed');
