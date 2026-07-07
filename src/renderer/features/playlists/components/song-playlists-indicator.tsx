import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';

import { usePlaylistsContainingSong } from '/@/renderer/features/playlists/hooks/use-playlists-containing-song';
import { AppRoute } from '/@/renderer/router/routes';
import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';
import { Popover } from '/@/shared/components/popover/popover';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

interface SongPlaylistsIndicatorProps {
    serverId: string | undefined;
    songId: string | undefined;
}

export const SongPlaylistsIndicator = ({ serverId, songId }: SongPlaylistsIndicatorProps) => {
    const { t } = useTranslation();
    const { isLoading, playlists } = usePlaylistsContainingSong(serverId, songId);

    if (!songId) {
        return null;
    }

    const count = playlists.length;
    const isSorted = count > 0;

    return (
        <Popover position="top" withArrow>
            <Popover.Target>
                <Button
                    aria-label={t('player.inPlaylistCount', {
                        count,
                        postProcess: 'sentenceCase',
                    })}
                    leftSection={
                        <Icon color={isSorted ? 'primary' : 'muted'} icon="playlist" size="sm" />
                    }
                    px="xs"
                    size="compact-xs"
                    variant="subtle"
                >
                    <Text isMuted={!isSorted} size="xs">
                        {count}
                    </Text>
                </Button>
            </Popover.Target>
            <Popover.Dropdown>
                {isLoading ? (
                    <Spinner />
                ) : isSorted ? (
                    <Stack gap="xs">
                        <Text isMuted size="xs">
                            {t('player.inPlaylistCount', {
                                count,
                                postProcess: 'sentenceCase',
                            })}
                        </Text>
                        {playlists.map((playlist) => (
                            <Text
                                component={Link}
                                isLink
                                key={playlist.id}
                                size="sm"
                                to={generatePath(AppRoute.PLAYLISTS_DETAIL_SONGS, {
                                    playlistId: playlist.id,
                                })}
                            >
                                {playlist.name}
                            </Text>
                        ))}
                    </Stack>
                ) : (
                    <Text isMuted size="sm">
                        {t('player.notInAnyPlaylist', { postProcess: 'sentenceCase' })}
                    </Text>
                )}
            </Popover.Dropdown>
        </Popover>
    );
};
