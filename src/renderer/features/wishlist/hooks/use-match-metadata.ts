import { useMutation } from '@tanstack/react-query';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { MutationHookArgs } from '/@/renderer/lib/react-query';
import { MatchMetadataRequest, MusicBrainzMatch } from '/@/shared/types/wishlist-types';

// Runs the same MusicBrainz matcher pymix uses to refine link parsing, against free
// text the user typed (artist/title fields) or an inbox raw note. Resolves to null when
// there's no confident match, leaving the caller's current values untouched.
export const useMatchMetadata = (args: MutationHookArgs) => {
    const { options } = args || {};

    return useMutation<MusicBrainzMatch | null, Error, MatchMetadataRequest>({
        mutationFn: async (body) => {
            const res = await PymixController.wishlistMatchMetadata({
                baseUrl: urlConfig.pymix,
                body,
            });
            return res.match;
        },
        ...options,
    });
};
