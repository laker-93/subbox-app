import { useMutation, useQueryClient } from '@tanstack/react-query';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { infiniteLoaderDataQueryKey } from '/@/renderer/components/item-list/helpers/item-list-infinite-loader';
import { urlConfig } from '/@/renderer/config/url-config';
import { MutationHookArgs } from '/@/renderer/lib/react-query';
import { LibraryItem } from '/@/shared/types/domain-types';

type DeleteSongResult = Awaited<ReturnType<typeof PymixController.deleteSong>>;

export const useDeleteSong = (args: MutationHookArgs) => {
    const { options } = args || {};
    const queryClient = useQueryClient();

    return useMutation<DeleteSongResult, Error, { ids: string[]; serverId: string }>({
        mutationFn: async ({ ids }) => {
            return PymixController.deleteSong({
                baseUrl: urlConfig.pymix,
                body: { ids },
            });
        },
        ...options,
        onSettled: (data, error, variables, context) => {
            const { serverId } = variables;

            // Invalidate on settle (not just success): a partial delete throws but
            // still removed some tracks, so their rows must disappear from the list.
            queryClient.invalidateQueries({
                exact: false,
                queryKey: queryKeys.songs.root(serverId),
            });

            queryClient.invalidateQueries({
                exact: false,
                queryKey: infiniteLoaderDataQueryKey(serverId, LibraryItem.SONG),
            });

            queryClient.invalidateQueries({
                exact: false,
                queryKey: queryKeys.albums.root(serverId),
            });

            options?.onSettled?.(data, error, variables, context);
        },
    });
};
