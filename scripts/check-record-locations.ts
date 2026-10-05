import { AxiosError, AxiosHeaders } from 'axios';
import assert from 'node:assert/strict';

import {
    matchedTrackLocations,
    RECORD_LOCATIONS_CHUNK,
    recordTrackLocations,
    TrackLocationToRecord,
} from '../src/main/features/core/sync/record-locations';

// The Rekordbox upload records where each *matched* track lives on this machine, so a
// later download can use it in place (#214 point 5, #216). These check the two halves:
// pairing /sync/match_tracks' answers with the tracks sent, and the best-effort send.
//
// Usage: pnpm run check:record-locations

const onDisk = new Set(['/Music/a.mp3', '/Music/b.mp3', '/Music/c.mp3']);
const exists = (p: string) => onDisk.has(p);

function axios404(): AxiosError {
    const headers = new AxiosHeaders();
    return new AxiosError('Not Found', 'ERR_BAD_REQUEST', { headers }, null, {
        config: { headers },
        data: { detail: 'Not Found' },
        headers: {},
        status: 404,
        statusText: 'Not Found',
    });
}

async function main(): Promise<void> {
    // Pairing: by position, matched with an id only, existing paths only, one per id.
    const sent = [
        { userLocation: '/Music/a.mp3' }, // matched, id -> recorded
        { userLocation: '/Music/b.mp3' }, // matched, no id (old pymix / untagged) -> skipped
        { userLocation: '/Music/c.mp3' }, // unmatched -> map_meta's job, skipped
        { userLocation: '/Music/gone.mp3' }, // matched, id, file not here -> skipped
        { userLocation: '/Music/c.mp3' }, // matched, same id as the first -> skipped
        { userLocation: null }, // matched, id, no path -> skipped
    ];
    const matched = [
        { matched: true, subboxId: 'sid-a' },
        { matched: true },
        { matched: false, subboxId: null },
        { matched: true, subboxId: 'sid-gone' },
        { matched: true, subboxId: 'sid-a' },
        { matched: true, subboxId: 'sid-x' },
    ];
    assert.deepEqual(matchedTrackLocations(sent, matched, exists), [
        { subbox_id: 'sid-a', user_location: '/Music/a.mp3' },
    ]);

    // A response from a pymix without #247: no subboxId anywhere, nothing to send.
    assert.deepEqual(
        matchedTrackLocations(
            sent,
            matched.map(({ matched: m }) => ({ matched: m })),
            exists,
        ),
        [],
    );

    // Chunked at pymix's cap, and the recorded counts summed.
    const many: TrackLocationToRecord[] = Array.from(
        { length: RECORD_LOCATIONS_CHUNK * 2 + 1 },
        (_, i) => ({ subbox_id: `sid-${i}`, user_location: `/Music/${i}.mp3` }),
    );
    const chunkSizes: number[] = [];
    const recorded = await recordTrackLocations({
        entries: many,
        post: async (chunk) => {
            chunkSizes.push(chunk.length);
            return { data: { recorded: chunk.map((e) => e.subbox_id) } };
        },
    });
    assert.deepEqual(chunkSizes, [RECORD_LOCATIONS_CHUNK, RECORD_LOCATIONS_CHUNK, 1]);
    assert.equal(recorded, many.length);

    // An old pymix 404s: asked once, not once per chunk, and the upload isn't failed.
    let calls = 0;
    assert.equal(
        await recordTrackLocations({
            entries: many,
            post: async () => {
                calls++;
                throw axios404();
            },
        }),
        0,
    );
    assert.equal(calls, 1);

    // Any other failure is swallowed too, keeping what was already recorded.
    calls = 0;
    assert.equal(
        await recordTrackLocations({
            entries: many,
            post: async (chunk) => {
                if (++calls === 2) throw new Error('socket hang up');
                return { data: { recorded: chunk.map((e) => e.subbox_id) } };
            },
        }),
        RECORD_LOCATIONS_CHUNK,
    );
    assert.equal(calls, 2);

    console.log('check:record-locations OK');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
