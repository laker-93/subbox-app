import { useMutation, useQueryClient } from '@tanstack/react-query';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { infiniteLoaderDataQueryKey } from '/@/renderer/components/item-list/helpers/item-list-infinite-loader';
import { urlConfig } from '/@/renderer/config/url-config';
import { MutationHookArgs } from '/@/renderer/lib/react-query';
import { LibraryItem } from '/@/shared/types/domain-types';

export const useDeleteSong = (args: MutationHookArgs) => {
    const { options } = args || {};
    const queryClient = useQueryClient();

    return useMutation<null, Error, { ids: string[]; serverId: string }>({
        mutationFn: async ({ ids }) => {
            return PymixController.deleteSong({
                baseUrl: urlConfig.pymix,
                body: { ids },
            });
        },
        ...options,
        onSuccess: (data, variables, context) => {
            const { serverId } = variables;

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

            options?.onSuccess?.(data, variables, context);
        },
    });
};
