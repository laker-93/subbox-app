import { useQuery } from '@tanstack/react-query';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { urlConfig } from '/@/renderer/config/url-config';
import { useCurrentServerId } from '/@/renderer/store';
import { DjTrackSummary } from '/@/shared/api/pymix/pymix-types';

// Subbox-only: one song-table row's DJ columns (subbox-app#240, pymix#269).
//
// Each DJ cell asks for its own row, so a table scrolled into view asks for every
// visible track at once. The asks made in one tick are sent as one
// POST /tracks/dj/summary (pymix caps it at 500 ids), and each answer is cached per
// track, so the four DJ columns of a row, and a row scrolled back to, cost nothing.

const MAX_IDS = 500;

export interface DjRowSummary {
    summary: DjTrackSummary | null;
    // False when pymix couldn't read the file tags, so a null key means "unknown".
    tagsRead: boolean;
}

interface Pending {
    reject: (error: unknown) => void;
    resolve: (value: DjRowSummary) => void;
}

const queue = new Map<string, Pending[]>();
let scheduled = false;

const flush = () => {
    scheduled = false;
    const batch = new Map(queue);
    queue.clear();
    const ids = [...batch.keys()];

    for (let i = 0; i < ids.length; i += MAX_IDS) {
        const chunk = ids.slice(i, i + MAX_IDS);
        PymixController.getDjSummary({ baseUrl: urlConfig.pymix, subboxIds: chunk })
            .then((res) => {
                for (const id of chunk) {
                    const value = { summary: res.tracks[id] ?? null, tagsRead: res.tags_read };
                    batch.get(id)?.forEach((p) => p.resolve(value));
                }
            })
            .catch((error) => {
                for (const id of chunk) batch.get(id)?.forEach((p) => p.reject(error));
            });
    }
};

const load = (subboxId: string) =>
    new Promise<DjRowSummary>((resolve, reject) => {
        const waiting = queue.get(subboxId);
        if (waiting) waiting.push({ reject, resolve });
        else queue.set(subboxId, [{ reject, resolve }]);
        if (!scheduled) {
            scheduled = true;
            setTimeout(flush, 0);
        }
    });

/** null `summary` means the track isn't in the user's library, or has no subbox_id. */
export const useDjSummary = (subboxId: null | string, options?: { enabled?: boolean }) => {
    const serverId = useCurrentServerId();
    return useQuery({
        enabled: Boolean(serverId && subboxId) && (options?.enabled ?? true),
        queryFn: () => load(subboxId!),
        queryKey: queryKeys.dj.summary(serverId, subboxId ?? ''),
        // A table re-rendering on scroll mustn't refetch; edits made in subbox
        // invalidate the row themselves.
        staleTime: 5 * 60_000,
    });
};
