import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { sharedQueries } from '/@/renderer/features/shared/api/shared-api';
import { useAuthStoreActions, useCurrentServer } from '/@/renderer/store';
import { hasFeature } from '/@/shared/api/utils';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Icon } from '/@/shared/components/icon/icon';
import { ServerFeature } from '/@/shared/types/features-types';

export const ServerSelectorItems = () => {
    const { t } = useTranslation();
    const currentServer = useCurrentServer();
    const { setMusicFolderId } = useAuthStoreActions();

    const { data: musicFolders } = useQuery(
        currentServer
            ? sharedQueries.musicFolders({ query: null, serverId: currentServer.id })
            : { enabled: false, queryKey: ['disabled'] },
    );

    const supportsMultiSelect = hasFeature(currentServer, ServerFeature.MUSIC_FOLDER_MULTISELECT);

    const queryClient = useQueryClient();

    const handleToggleMusicFolder = (musicFolderId: string) => {
        if (supportsMultiSelect) {
            const currentIds = currentServer.musicFolderId || [];
            const isSelected = currentIds.includes(musicFolderId);

            if (isSelected) {
                // Remove from selection
                const newIds = currentIds.filter((id) => id !== musicFolderId);
                setMusicFolderId(newIds.length > 0 ? newIds : undefined);
            } else {
                // Add to selection
                setMusicFolderId([...currentIds, musicFolderId]);
            }
        } else {
            const currentId = Array.isArray(currentServer.musicFolderId)
                ? currentServer.musicFolderId[0]
                : currentServer.musicFolderId;
            const isSelected = currentId === musicFolderId;

            if (isSelected) {
                setMusicFolderId(undefined);
            } else {
                setMusicFolderId([musicFolderId]);
            }
        }

        queryClient.removeQueries();
    };

    const handleClearMusicFolders = () => {
        setMusicFolderId(undefined);
        queryClient.removeQueries();
    };

    if (!currentServer) {
        return null;
    }

    const selectedMusicFolders =
        musicFolders?.items.filter((folder) => currentServer.musicFolderId?.includes(folder.id)) ||
        [];

    return (
        <>
            {musicFolders && musicFolders.items.length > 0 && (
                <>
                    <DropdownMenu.Label>
                        {t('page.appMenu.selectMusicFolder', { postProcess: 'sentenceCase' })}
                    </DropdownMenu.Label>
                    <DropdownMenu.Item
                        isSelected={selectedMusicFolders.length === 0}
                        leftSection={<Icon icon="minus" />}
                        onClick={handleClearMusicFolders}
                    >
                        {t('common.none', { postProcess: 'titleCase' })}
                    </DropdownMenu.Item>
                    {musicFolders.items.map((folder) => {
                        const isSelected = supportsMultiSelect
                            ? currentServer.musicFolderId?.includes(folder.id) || false
                            : (Array.isArray(currentServer.musicFolderId)
                                  ? currentServer.musicFolderId[0]
                                  : currentServer.musicFolderId) === folder.id;
                        return (
                            <DropdownMenu.Item
                                isSelected={isSelected}
                                key={`musicFolder-${folder.id}`}
                                leftSection={<Icon icon={isSelected ? 'check' : 'folder'} />}
                                onClick={() => handleToggleMusicFolder(folder.id)}
                            >
                                {folder.name}
                            </DropdownMenu.Item>
                        );
                    })}
                </>
            )}
        </>
    );
};
