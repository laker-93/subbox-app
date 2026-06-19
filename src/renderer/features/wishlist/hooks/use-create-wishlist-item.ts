import { useMutation, useQueryClient } from '@tanstack/react-query';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { urlConfig } from '/@/renderer/config/url-config';
import { MutationHookArgs } from '/@/renderer/lib/react-query';
import { useCurrentServerId } from '/@/renderer/store';
import { CreateWishlistItemRequest } from '/@/shared/types/wishlist-types';

export const useCreateWishlistItem = (args: MutationHookArgs) => {
    const { options } = args || {};
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();

    return useMutation<unknown, Error, CreateWishlistItemRequest>({
        mutationFn: async (body) => {
            return PymixController.wishlistCreate({ baseUrl: urlConfig.pymix, body });
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
