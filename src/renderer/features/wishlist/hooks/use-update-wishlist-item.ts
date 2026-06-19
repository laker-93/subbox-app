import { useMutation, useQueryClient } from '@tanstack/react-query';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { urlConfig } from '/@/renderer/config/url-config';
import { MutationHookArgs } from '/@/renderer/lib/react-query';
import { useCurrentServerId } from '/@/renderer/store';
import { UpdateWishlistItemRequest } from '/@/shared/types/wishlist-types';

type UpdateWishlistItemArgs = {
    body: UpdateWishlistItemRequest;
    wishlistId: string;
};

export const useUpdateWishlistItem = (args: MutationHookArgs) => {
    const { options } = args || {};
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();

    return useMutation<unknown, Error, UpdateWishlistItemArgs>({
        mutationFn: async ({ body, wishlistId }) => {
            return PymixController.wishlistUpdate({
                baseUrl: urlConfig.pymix,
                body,
                params: { id: wishlistId },
            });
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
