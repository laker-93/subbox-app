import { useMutation, useQueryClient } from '@tanstack/react-query';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { urlConfig } from '/@/renderer/config/url-config';
import { invalidateTrackLists, waitUntilGone } from '/@/renderer/features/trash/api/track-trash';
import { MutationHookArgs } from '/@/renderer/lib/react-query';

type DeleteSongResult = Awaited<ReturnType<typeof PymixController.deleteSong>>;

export const useDeleteSong = (args: MutationHookArgs) => {
    const { options } = args || {};
    const queryClient = useQueryClient();

    return useMutation<
        DeleteSongResult,
        Error,
        // `songIds` are the tracks' Navidrome ids, to know when the library has
        // caught up; `ids` are their subbox ids, which pymix deletes by.
        { ids: string[]; serverId: string; songIds?: string[] }
    >({
        mutationFn: async ({ ids }) => {
            return PymixController.deleteSong({
                baseUrl: urlConfig.pymix,
                body: { ids },
            });
        },
        ...options,
        onSettled: (data, error, variables, context) => {
            const { serverId, songIds } = variables;

            // Invalidate on settle (not just success): a partial delete throws but
            // still removed some tracks, so their rows must disappear from the list.
            invalidateTrackLists(queryClient, serverId);
            queryClient.invalidateQueries({ queryKey: queryKeys.trash.root(serverId) });

            // Navidrome lists a deleted track until it has noticed the file is gone,
            // so a refetch now can show it again. Refetch once more when the library
            // reflects the delete (design §11.4), not optimistically (#18).
            if (songIds?.length) {
                waitUntilGone(serverId, songIds).then(() =>
                    invalidateTrackLists(queryClient, serverId),
                );
            }

            options?.onSettled?.(data, error, variables, context);
        },
    });
};
