import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { usePlaylistTree } from '/@/renderer/features/playlist-tree/hooks/use-playlist-tree';
import { Text } from '/@/shared/components/text/text';

// Subbox-only: the playlist delete confirmation names what goes, and says it can be
// undone, when the delete goes to pymix's trash (subbox-app#150, design §11.4).
// Anyone else keeps upstream's wording, passed as `children`.

export const DeletePlaylistConfirmText = ({
    children,
    playlists,
}: {
    children: ReactNode;
    playlists: { name: string }[];
}) => {
    const { t } = useTranslation();
    const { state } = usePlaylistTree();
    if (state !== 'tree' || playlists.length === 0) return <>{children}</>;
    return (
        <Text>
            {playlists.length === 1
                ? t('form.trash.confirmPlaylist', { name: playlists[0].name })
                : t('form.trash.confirmPlaylists', { count: playlists.length })}
        </Text>
    );
};

export const deleteFolderConfirmText = (
    t: (key: string, options?: Record<string, unknown>) => string,
    name: string,
    playlists: number,
) =>
    playlists
        ? t('form.trash.confirmFolder', { count: playlists, name })
        : t('form.trash.confirmEmptyFolder', { name });
