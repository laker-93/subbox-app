import { useMutation } from '@tanstack/react-query';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { MutationHookArgs } from '/@/renderer/lib/react-query';
import { WishlistLinkMetadata } from '/@/shared/types/wishlist-types';

export const useParseWishlistLink = (args: MutationHookArgs) => {
    const { options } = args || {};

    return useMutation<WishlistLinkMetadata, Error, { url: string }>({
        mutationFn: async ({ url }) => {
            const res = await PymixController.wishlistParseLink({
                baseUrl: urlConfig.pymix,
                body: { url },
            });
            return res.metadata;
        },
        ...options,
    });
};
