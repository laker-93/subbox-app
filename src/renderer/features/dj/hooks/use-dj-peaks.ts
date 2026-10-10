import { useEffect, useState } from 'react';

import { clientDecodePeaks } from '/@/renderer/features/dj/peaks/client-decode-peaks';
import {
    getCachedPeaks,
    peaksCacheKey,
    setCachedPeaks,
} from '/@/renderer/features/dj/peaks/peaks-cache';
import { DjPeaks, PeaksRequest, PeaksSource } from '/@/renderer/features/dj/peaks/peaks-source';

// Subbox-only: the waveform's peaks for one track (subbox-app#237). From the device
// cache when it has them, else from the peaks source, once. Not React Query: the
// result is large and that cache is persisted to IndexedDB whole.

// Track A's source. Track B swaps this for server peaks.
const source: PeaksSource = clientDecodePeaks;

// One decode per track in flight, however many views ask at once. Not tied to any
// one view's lifetime, so a view that unmounts doesn't cancel another's wait.
const inflight = new Map<string, Promise<DjPeaks>>();

const loadPeaks = async (key: string, request: PeaksRequest): Promise<DjPeaks> => {
    const cached = await getCachedPeaks(key);
    if (cached) return cached;
    let pending = inflight.get(key);
    if (!pending) {
        pending = source
            .load(request, new AbortController().signal)
            .then(async (peaks) => {
                await setCachedPeaks(key, peaks);
                return peaks;
            })
            .finally(() => inflight.delete(key));
        inflight.set(key, pending);
    }
    return pending;
};

export type DjPeaksState =
    | { error: Error; peaks: null; status: 'error' }
    | { error: null; peaks: DjPeaks; status: 'ready' }
    | { error: null; peaks: null; status: 'loading' };

const LOADING: DjPeaksState = { error: null, peaks: null, status: 'loading' };

export const useDjPeaks = (request: null | PeaksRequest): DjPeaksState => {
    const key = request ? peaksCacheKey(request) : null;
    const [state, setState] = useState<{ key: null | string; value: DjPeaksState }>({
        key: null,
        value: LOADING,
    });

    useEffect(() => {
        if (!request || !key) return undefined;
        let live = true;
        loadPeaks(key, request)
            .then((peaks) => {
                if (live) setState({ key, value: { error: null, peaks, status: 'ready' } });
            })
            .catch((error: Error) => {
                if (live) setState({ key, value: { error, peaks: null, status: 'error' } });
            });
        return () => {
            live = false;
        };
        // `key` covers everything in `request` the result depends on.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    // A result for another track is never shown while this one loads.
    return key && state.key === key ? state.value : LOADING;
};
