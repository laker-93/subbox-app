import { useEffect } from 'react';

import { useCurrentServer, usePlayerStoreBase } from '/@/renderer/store';
import { LogCategory, logFn } from '/@/renderer/utils/logger';
import { logMsg } from '/@/renderer/utils/logger-message';
import { hasFeature } from '/@/shared/api/utils';
import { ServerFeature } from '/@/shared/types/features-types';

const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_128_BITS = (1n << 128n) - 1n;

/**
 * Whether Navidrome 0.64 could not have issued this id. Its migration rewrote every
 * id to 22 base62 characters holding at most 128 bits; random ids from before it
 * mostly hold more, and older ones were 32 hex characters or a uuid.
 */
export const isPreCanonicalId = (id: string): boolean => {
    if (id.length !== 22) {
        return (
            /^[0-9a-f]{32}$/i.test(id) || /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
        );
    }
    let value = 0n;
    for (const char of id) {
        const digit = BASE62.indexOf(char);
        if (digit < 0) return false;
        value = value * 62n + BigInt(digit);
    }
    return value > MAX_128_BITS;
};

/**
 * Drops a persisted play queue that was saved before the user's Navidrome moved to
 * 0.64. That upgrade re-encodes most song ids, so the queue's songs no longer exist
 * and resuming it would only replay as stream errors (subbox-workspace
 * docs/design-multi-tenancy.md §5.2). One id the new server could not have issued
 * is enough: every song in the queue was saved at the same time.
 */
export const useDropPreCanonicalQueue = () => {
    const server = useCurrentServer();
    const canonical = server ? hasFeature(server, ServerFeature.CANONICAL_IDS) : false;

    useEffect(() => {
        if (!server || !canonical) return;

        const check = () => {
            const songs = Object.values(usePlayerStoreBase.getState().queue.songs);
            const stale = songs.filter(
                (song) => song._serverId === server.id && isPreCanonicalId(song.id),
            );
            if (stale.length === 0) return;

            logFn.warn(logMsg[LogCategory.PLAYER].clearQueuePreCanonicalIds, {
                category: LogCategory.PLAYER,
                meta: { serverId: server.id, songs: songs.length, stale: stale.length },
            });
            usePlayerStoreBase.getState().clearQueue();
        };

        if (usePlayerStoreBase.persist.hasHydrated()) {
            check();
            return undefined;
        }
        return usePlayerStoreBase.persist.onFinishHydration(check);
    }, [server, canonical]);
};

export const DropPreCanonicalQueueHook = () => {
    useDropPreCanonicalQueue();
    return null;
};
