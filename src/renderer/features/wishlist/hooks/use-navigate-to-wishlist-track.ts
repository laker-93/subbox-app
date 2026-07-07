import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { generatePath, useNavigate } from 'react-router';

import { songsQueries } from '/@/renderer/features/songs/api/songs-api';
import { AppRoute } from '/@/renderer/router/routes';
import { useCurrentServerId } from '/@/renderer/store';
import { toast } from '/@/shared/components/toast/toast';
import { SongListSort, SortOrder } from '/@/shared/types/domain-types';

// Resolves an `available` wishlist item's linked_subbox_id to the actual library track and
// navigates to its album. Navidrome exposes SUBBOX_ID as the `subboxid` custom tag on its
// native /api/song endpoint (the Subsonic API drops custom tags), and lets us filter by it
// directly — so a single filtered fetch (via the getSongList `_custom` passthrough) returns
// the one matching song, carrying the albumId we route to. The reconcile step already
// stamped linked_subbox_id when it matched the track into the library.
export const useNavigateToWishlistTrack = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const serverId = useCurrentServerId();
    const queryClient = useQueryClient();

    const mutation = useMutation({
        mutationFn: async (subboxId: string) => {
            const result = await queryClient.fetchQuery(
                songsQueries.list({
                    query: {
                        _custom: { subboxid: subboxId },
                        limit: 1,
                        sortBy: SongListSort.NAME,
                        sortOrder: SortOrder.ASC,
                        startIndex: 0,
                    },
                    serverId: serverId ?? '',
                }),
            );
            return result.items[0] ?? null;
        },
        onError: () => {
            toast.error({
                message: t('page.wishlist.trackNotFound', {
                    postProcess: 'sentenceCase',
                }) as string,
            });
        },
        onSuccess: (song) => {
            // The tag isn't queryable until Navidrome has (re)scanned the file, so a
            // just-matched track can briefly resolve to nothing — tell the user rather than
            // navigating into an empty album route.
            if (!song?.albumId) {
                toast.warn({
                    message: t('page.wishlist.trackNotFound', {
                        postProcess: 'sentenceCase',
                    }) as string,
                });
                return;
            }
            navigate(generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: song.albumId }));
        },
    });

    return {
        isResolving: mutation.isPending,
        navigateToTrack: (subboxId: string) => mutation.mutate(subboxId),
    };
};
