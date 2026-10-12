// Subbox-only: a track's key in the notation the user picked (subbox-app#240,
// design-dj-ui §10 Q4). pymix stores one spelling, Rekordbox's (`Am`, `F#m`, `Abm`;
// pymix#282), and a file tag can be in any; this parses all of them and renders
// Camelot, musical, or both. A port of pymix's `musical_key.py`, which round-trip
// tests all 24 keys.

export type KeyNotation = 'both' | 'camelot' | 'musical';

/** Pitch class 0-11 with C = 0, and the mode. */
export interface MusicalKey {
    minor: boolean;
    pitch: number;
}

const PITCH: Record<string, number> = { A: 9, B: 11, C: 0, D: 2, E: 4, F: 5, G: 7 };
const ACCIDENTAL: Record<string, number> = { '#': 1, '♭': -1, '♯': 1, b: -1 };
// Camelot number -> [major pitch class, minor pitch class]. 8B = C major, 8A = A minor.
const CAMELOT: Record<number, [number, number]> = {
    1: [11, 8],
    2: [6, 3],
    3: [1, 10],
    4: [8, 5],
    5: [3, 0],
    6: [10, 7],
    7: [5, 2],
    8: [0, 9],
    9: [7, 4],
    10: [2, 11],
    11: [9, 6],
    12: [4, 1],
};
// Open Key (Traktor's): number -> major pitch class. 1d = C major, 1m = A minor.
const OPEN_KEY_MAJOR = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
// Rekordbox's spelling: flats except F#.
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** `Am`, `F#m`, `Gbm`, `C`, `A minor`, `8A`, `1m` -> the key; null for anything else. */
export const parseKey = (value: null | string | undefined): MusicalKey | null => {
    const s = value?.trim();
    if (!s) return null;

    let m = /^(\d{1,2})([AB])$/i.exec(s);
    if (m) {
        const pair = CAMELOT[Number(m[1])];
        if (!pair) return null;
        const minor = m[2].toUpperCase() === 'A';
        return { minor, pitch: minor ? pair[1] : pair[0] };
    }

    m = /^(\d{1,2})([dm])$/.exec(s);
    if (m) {
        const major = OPEN_KEY_MAJOR[Number(m[1]) - 1];
        if (major === undefined) return null;
        const minor = m[2] === 'm';
        return { minor, pitch: minor ? (major + 9) % 12 : major };
    }

    m = /^([A-G])([#b♯♭]?)\s*(m|min|minor|maj|major)?$/i.exec(s);
    if (!m) return null;
    const pitch = PITCH[m[1].toUpperCase()] + (ACCIDENTAL[m[2]] ?? 0);
    const minor = ['m', 'min', 'minor'].includes((m[3] ?? '').toLowerCase());
    return { minor, pitch: (pitch + 12) % 12 };
};

export const toMusical = (key: MusicalKey) => NAMES[key.pitch] + (key.minor ? 'm' : '');

export const toCamelot = (key: MusicalKey) => {
    for (const [n, [major, minor]] of Object.entries(CAMELOT)) {
        if (key.minor ? minor === key.pitch : major === key.pitch) {
            return `${n}${key.minor ? 'A' : 'B'}`;
        }
    }
    return '';
};

/**
 * `8A · Am`, `8A` or `Am`. A value that isn't a key is shown as written, so a tag
 * subbox can't read still shows rather than vanishing.
 */
export const formatKey = (value: null | string | undefined, notation: KeyNotation) => {
    if (!value) return null;
    const key = parseKey(value);
    if (!key) return value;
    if (notation === 'camelot') return toCamelot(key);
    if (notation === 'musical') return toMusical(key);
    return `${toCamelot(key)} · ${toMusical(key)}`;
};
