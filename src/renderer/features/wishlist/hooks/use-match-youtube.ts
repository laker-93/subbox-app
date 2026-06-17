import { useMutation } from '@tanstack/react-query';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { MutationHookArgs } from '/@/renderer/lib/react-query';
import { MatchYoutubeResponse } from '/@/shared/types/wishlist-types';

export const useMatchYoutube = (args: MutationHookArgs) => {
    const { options } = args || {};

    return useMutation<MatchYoutubeResponse, Error, { wishlistId: string }>({
        mutationFn: async ({ wishlistId }) => {
            return PymixController.wishlistMatchYoutube({
                baseUrl: urlConfig.pymix,
                params: { id: wishlistId },
            });
        },
        ...options,
    });
};
