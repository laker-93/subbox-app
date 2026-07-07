import { useQuery } from '@tanstack/react-query';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { urlConfig } from '/@/renderer/config/url-config';
import { useCurrentServerId } from '/@/renderer/store';

export const useWishlist = () => {
    const serverId = useCurrentServerId();

    return useQuery({
        queryFn: async ({ signal }) => {
            const result = await PymixController.wishlistList({
                baseUrl: urlConfig.pymix,
                signal,
            });

            return result.items;
        },
        queryKey: queryKeys.wishlist.list(serverId),
        // While any item is still resolving in the background (pymix's resolve loop fixes
        // hand-typed artist/title against MusicBrainz off the critical path), poll so the
        // corrected metadata and cleared "resolving…" badge appear without a manual
        // refresh. Stops polling once nothing is pending.
        refetchInterval: (query) =>
            query.state.data?.some((item) => item.resolve_state === 'pending') ? 15000 : false,
    });
};
