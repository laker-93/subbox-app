import assert from 'node:assert/strict';

import {
    formatKey,
    parseKey,
    toCamelot,
    toMusical,
} from '../src/renderer/features/dj/utils/musical-key';

// Check for subbox-app#240: the Key column parses every spelling pymix can hand it
// (its stored Rekordbox spelling, pymix#282, or a file tag as written) and renders
// Camelot, musical or both. The table is the Camelot wheel and Traktor's Open Key,
// the same one pymix's musical_key.py round-trips.
//
// Usage: pnpm run check:musical-key

// [Camelot, Open Key, Rekordbox's spelling, another spelling of the same key]
const WHEEL: [string, string, string, string][] = [
    ['1A', '6m', 'Abm', 'G#m'],
    ['1B', '6d', 'B', 'B major'],
    ['2A', '7m', 'Ebm', 'D#m'],
    ['2B', '7d', 'F#', 'Gb'],
    ['3A', '8m', 'Bbm', 'A#m'],
    ['3B', '8d', 'Db', 'C#'],
    ['4A', '9m', 'Fm', 'F minor'],
    ['4B', '9d', 'Ab', 'G#'],
    ['5A', '10m', 'Cm', 'C min'],
    ['5B', '10d', 'Eb', 'D#'],
    ['6A', '11m', 'Gm', 'gm'],
    ['6B', '11d', 'Bb', 'A#'],
    ['7A', '12m', 'Dm', 'D minor'],
    ['7B', '12d', 'F', 'Fmaj'],
    ['8A', '1m', 'Am', 'A minor'],
    ['8B', '1d', 'C', 'C major'],
    ['9A', '2m', 'Em', 'E min'],
    ['9B', '2d', 'G', 'G maj'],
    ['10A', '3m', 'Bm', 'Cbm'],
    ['10B', '3d', 'D', 'D major'],
    ['11A', '4m', 'F#m', 'Gbm'],
    ['11B', '4d', 'A', 'A major'],
    ['12A', '5m', 'Dbm', 'C#m'],
    ['12B', '5d', 'E', 'Fb'],
];

for (const [camelot, openKey, musical, other] of WHEEL) {
    for (const spelling of [camelot, camelot.toLowerCase(), openKey, musical, other]) {
        const key = parseKey(spelling);
        assert.ok(key, `${spelling} parses`);
        assert.equal(toCamelot(key), camelot, `${spelling} -> Camelot`);
        assert.equal(toMusical(key), musical, `${spelling} -> musical`);
    }
}

assert.equal(formatKey('Am', 'both'), '8A · Am');
assert.equal(formatKey('8A', 'musical'), 'Am');
assert.equal(formatKey('Gbm', 'camelot'), '11A');
assert.equal(formatKey(' F#m ', 'both'), '11A · F#m', 'surrounding space');
assert.equal(formatKey('weird', 'both'), 'weird', "a value that isn't a key shows as written");
assert.equal(formatKey(null, 'both'), null);
assert.equal(formatKey('', 'both'), null);
for (const bad of ['13A', '0B', '13m', 'H', 'Am7']) {
    assert.equal(parseKey(bad), null, `${bad} is not a key`);
}

console.log('musical-key: every check passed');
