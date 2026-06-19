import { useMutation } from '@tanstack/react-query';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { MutationHookArgs } from '/@/renderer/lib/react-query';
import { WishlistSetSheetRequest } from '/@/shared/types/wishlist-types';

type SetWishlistSheetArgs = {
    body: WishlistSetSheetRequest;
};

export const useSetWishlistSheet = (args: MutationHookArgs) => {
    const { options } = args || {};

    return useMutation<unknown, Error, SetWishlistSheetArgs>({
        mutationFn: async ({ body }) => {
            return PymixController.wishlistSetSheet({
                baseUrl: urlConfig.pymix,
                body,
            });
        },
        ...options,
    });
};
