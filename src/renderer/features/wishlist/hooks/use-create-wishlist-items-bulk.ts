import { useMutation, useQueryClient } from '@tanstack/react-query';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { urlConfig } from '/@/renderer/config/url-config';
import { MutationHookArgs } from '/@/renderer/lib/react-query';
import { useCurrentServerId } from '/@/renderer/store';
import {
    CreateWishlistItemsBulkRequest,
    WishlistBulkCreateResponse,
} from '/@/shared/types/wishlist-types';

export const useCreateWishlistItemsBulk = (args: MutationHookArgs) => {
    const { options } = args || {};
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();

    return useMutation<WishlistBulkCreateResponse, Error, CreateWishlistItemsBulkRequest>({
        mutationFn: async (body) => {
            return PymixController.wishlistBulkCreate({ baseUrl: urlConfig.pymix, body });
        },
        ...options,
        onSuccess: (data, variables, context) => {
            queryClient.invalidateQueries({
                exact: false,
                queryKey: queryKeys.wishlist.root(serverId),
            });

            options?.onSuccess?.(data, variables, context);
        },
    });
};
