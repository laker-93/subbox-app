import { useQuery } from '@tanstack/react-query';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { urlConfig } from '/@/renderer/config/url-config';
import { useCurrentServerId } from '/@/renderer/store';

// Subbox-only: one track's DJ data from pymix (subbox-app#237, pymix#269). null for a
// track that isn't in the user's library; a song with no subbox_id tag never asks.
export const useTrackDj = (
    subboxId: null | string | undefined,
    options?: { enabled?: boolean },
) => {
    const serverId = useCurrentServerId();
    return useQuery({
        enabled: Boolean(serverId && subboxId) && (options?.enabled ?? true),
        queryFn: ({ signal }) =>
            PymixController.getTrackDj({ baseUrl: urlConfig.pymix, signal, subboxId: subboxId! }),
        queryKey: queryKeys.dj.track(serverId, subboxId ?? ''),
        // Skipping back and forth through a queue shouldn't refetch each track (#238).
        // Edits made in subbox update this cache themselves.
        staleTime: 5 * 60_000,
    });
};
