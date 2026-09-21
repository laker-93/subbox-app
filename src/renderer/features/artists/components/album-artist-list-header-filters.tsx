import { ALBUM_ARTIST_TABLE_COLUMNS } from '/@/renderer/components/item-list/item-table-list/default-columns';
import { ListConfigMenu } from '/@/renderer/features/shared/components/list-config-menu';
import { ListDisplayTypeToggleButton } from '/@/renderer/features/shared/components/list-display-type-toggle-button';
import { ListRefreshButton } from '/@/renderer/features/shared/components/list-refresh-button';
import { ListSortControls } from '/@/renderer/features/shared/components/list-sort-controls';
import { Flex } from '/@/shared/components/flex/flex';
import { Group } from '/@/shared/components/group/group';
import { AlbumArtistListSort, LibraryItem } from '/@/shared/types/domain-types';
import { ItemListKey } from '/@/shared/types/types';

export const AlbumArtistListHeaderFilters = () => {
    return (
        <Flex justify="space-between">
            <Group gap="sm" w="100%">
                <ListSortControls
                    defaultSortByValue={AlbumArtistListSort.NAME}
                    displayKey={ItemListKey.ALBUM_ARTIST}
                    itemType={LibraryItem.ALBUM_ARTIST}
                    listKey={ItemListKey.ALBUM_ARTIST}
                />
                <ListRefreshButton listKey={ItemListKey.ALBUM_ARTIST} />
            </Group>
            <Group gap="sm" wrap="nowrap">
                <ListDisplayTypeToggleButton listKey={ItemListKey.ALBUM_ARTIST} />
                <ListConfigMenu
                    listKey={ItemListKey.ALBUM_ARTIST}
                    tableColumnsData={ALBUM_ARTIST_TABLE_COLUMNS}
                />
            </Group>
        </Flex>
    );
};
