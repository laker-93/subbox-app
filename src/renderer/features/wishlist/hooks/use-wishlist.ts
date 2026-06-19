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
    });
};
