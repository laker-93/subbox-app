import { createStore, del, get, set } from 'idb-keyval';

import { DjPeaks, PeaksRequest } from '/@/renderer/features/dj/peaks/peaks-source';

// Subbox-only: client-decoded peaks, cached per device so a track is decoded once
// (subbox-app#237). Its own IndexedDB database, not React Query's persisted cache:
// a 10-minute track's peaks are a few hundred KB, and that cache is loaded whole at
// start-up.

// Bump when the peaks computation changes, so old entries are never drawn.
const PEAKS_VERSION = 1;
const MAX_ENTRIES = 300;
const INDEX_KEY = '__index';

let store: null | ReturnType<typeof createStore> = null;
const peaksStore = () => (store ??= createStore('subbox-dj-peaks', 'peaks'));

/** subbox_id plus what changes when the file does, so a re-tagged file is re-decoded. */
export const peaksCacheKey = ({ song, subboxId }: PeaksRequest) =>
    `v${PEAKS_VERSION}:${subboxId}:${song.size}:${song.updatedAt}`;

export const getCachedPeaks = async (key: string): Promise<DjPeaks | undefined> => {
    try {
        const peaks = await get<DjPeaks>(key, peaksStore());
        if (peaks) void touch(key);
        return peaks;
    } catch {
        return undefined;
    }
};

export const setCachedPeaks = async (key: string, peaks: DjPeaks) => {
    try {
        await set(key, peaks, peaksStore());
        await touch(key);
    } catch {
        // A cache that can't be written (private window, quota) only costs a re-decode.
    }
};

/** Last-used times, so the oldest entries go once there are more than MAX_ENTRIES. */
const touch = async (key: string) => {
    const index = (await get<Record<string, number>>(INDEX_KEY, peaksStore())) ?? {};
    index[key] = Date.now();
    const keys = Object.keys(index);
    if (keys.length > MAX_ENTRIES) {
        const oldest = keys.sort((a, b) => index[a] - index[b]).slice(0, keys.length - MAX_ENTRIES);
        for (const k of oldest) {
            delete index[k];
            await del(k, peaksStore());
        }
    }
    await set(INDEX_KEY, index, peaksStore());
};
