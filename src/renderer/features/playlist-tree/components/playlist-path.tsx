import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';

import styles from './playlist-path.module.css';

import {
    usePlaylistPath,
    usePlaylistPlace,
    usePlaylistPlaces,
} from '/@/renderer/features/playlist-tree/hooks/use-playlist-places';
import { AppRoute } from '/@/renderer/router/routes';
import { Text } from '/@/shared/components/text/text';

// Subbox-only (subbox-app#149, design §11.3).

/**
 * ` · House › 2024` after a playlist's name, when another playlist has the same name.
 * Renders nothing otherwise, so it can sit after any upstream `{playlist.name}`.
 */
export const PlaylistPath = ({ playlistId }: { playlistId: string | undefined }) => {
    const path = usePlaylistPath(playlistId);
    if (!path) return null;
    return (
        <Text className={styles.path} component="span" isMuted>
            {' · '}
            {path}
        </Text>
    );
};

/**
 * The playlist page's breadcrumb, `Playlists › House › 2024`, shown whenever the
 * playlist is in a folder. Null otherwise, so the header keeps its own label.
 */
export const usePlaylistBreadcrumb = (playlistId: string | undefined) => {
    const { t } = useTranslation();
    const places = usePlaylistPlaces();
    const folders = playlistId ? places?.get(playlistId)?.folders : undefined;
    if (!folders?.length) return undefined;
    return (
        <Text className={styles.breadcrumb} fw={600} size="md" tt="uppercase">
            <Text component={Link} fw={600} isLink to={generatePath(AppRoute.PLAYLISTS)}>
                {t('page.sidebar.playlists', { postProcess: 'titleCase' })}
            </Text>
            {folders.map((folder, index) => (
                <span key={index}>
                    {' › '}
                    {folder}
                </span>
            ))}
        </Text>
    );
};

/**
 * The playlist page's title. For a `path` user Navidrome's name is the whole path
 * (`House / 2024`), which the breadcrumb already shows, so the title is the leaf
 * (subbox-app#173). Otherwise Navidrome's name, as upstream shows it.
 */
export const usePlaylistTitle = (playlistId: string | undefined, name: string | undefined) => {
    const place = usePlaylistPlace(playlistId);
    return place?.inName && place.leaf ? place.leaf : name;
};
