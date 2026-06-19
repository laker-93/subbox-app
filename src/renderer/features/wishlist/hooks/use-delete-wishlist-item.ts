import { useMutation, useQueryClient } from '@tanstack/react-query';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { urlConfig } from '/@/renderer/config/url-config';
import { MutationHookArgs } from '/@/renderer/lib/react-query';
import { useCurrentServerId } from '/@/renderer/store';

export const useDeleteWishlistItem = (args: MutationHookArgs) => {
    const { options } = args || {};
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();

    return useMutation<unknown, Error, { wishlistId: string }>({
        mutationFn: async ({ wishlistId }) => {
            return PymixController.wishlistDelete({
                baseUrl: urlConfig.pymix,
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
