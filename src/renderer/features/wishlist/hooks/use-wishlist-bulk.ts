import { useMutation, useQueryClient } from '@tanstack/react-query';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { urlConfig } from '/@/renderer/config/url-config';
import { MutationHookArgs } from '/@/renderer/lib/react-query';
import { useCurrentServerId } from '/@/renderer/store';
import { UpdateWishlistItemRequest, WishlistStatus } from '/@/shared/types/wishlist-types';

// Bulk wishlist actions are fanned out over the existing single-item PATCH/DELETE
// endpoints rather than a dedicated bulk API — at personal-library scale a handful of
// concurrent requests is cheap, and it keeps pymix unchanged. The list is invalidated
// once in onSettled (not per request), so a partial failure still refreshes the grid to
// whatever actually changed.

export const useBulkUpdateWishlistStatus = (args: MutationHookArgs) => {
    const { options } = args || {};
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();

    return useMutation<unknown, Error, { ids: string[]; status: WishlistStatus }>({
        mutationFn: async ({ ids, status }) => {
            await Promise.all(
                ids.map((id) =>
                    PymixController.wishlistUpdate({
                        baseUrl: urlConfig.pymix,
                        body: { status } as UpdateWishlistItemRequest,
                        params: { id },
                    }),
                ),
            );
        },
        ...options,
        onSettled: (data, error, variables, context) => {
            queryClient.invalidateQueries({
                exact: false,
                queryKey: queryKeys.wishlist.root(serverId),
            });

            options?.onSettled?.(data, error, variables, context);
        },
    });
};

export const useBulkDeleteWishlistItems = (args: MutationHookArgs) => {
    const { options } = args || {};
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();

    return useMutation<unknown, Error, { ids: string[] }>({
        mutationFn: async ({ ids }) => {
            await Promise.all(
                ids.map((id) =>
                    PymixController.wishlistDelete({
                        baseUrl: urlConfig.pymix,
                        params: { id },
                    }),
                ),
            );
        },
        ...options,
        onSettled: (data, error, variables, context) => {
            queryClient.invalidateQueries({
                exact: false,
                queryKey: queryKeys.wishlist.root(serverId),
            });

            options?.onSettled?.(data, error, variables, context);
        },
    });
};
