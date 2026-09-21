import { GENRE_TABLE_COLUMNS } from '/@/renderer/components/item-list/item-table-list/default-columns';
import { ListConfigMenu } from '/@/renderer/features/shared/components/list-config-menu';
import { ListDisplayTypeToggleButton } from '/@/renderer/features/shared/components/list-display-type-toggle-button';
import { ListRefreshButton } from '/@/renderer/features/shared/components/list-refresh-button';
import { ListSortControls } from '/@/renderer/features/shared/components/list-sort-controls';
import { Flex } from '/@/shared/components/flex/flex';
import { Group } from '/@/shared/components/group/group';
import { GenreListSort, LibraryItem } from '/@/shared/types/domain-types';
import { ItemListKey } from '/@/shared/types/types';

export const GenreListHeaderFilters = () => {
    return (
        <Flex justify="space-between">
            <Group gap="sm" w="100%">
                <ListSortControls
                    defaultSortByValue={GenreListSort.NAME}
                    displayKey={ItemListKey.GENRE}
                    itemType={LibraryItem.GENRE}
                    listKey={ItemListKey.GENRE}
                />
                <ListRefreshButton listKey={ItemListKey.GENRE} />
            </Group>
            <Group gap="sm" wrap="nowrap">
                <ListDisplayTypeToggleButton listKey={ItemListKey.GENRE} />
                <ListConfigMenu
                    listKey={ItemListKey.GENRE}
                    tableColumnsData={GENRE_TABLE_COLUMNS}
                />
            </Group>
        </Flex>
    );
};
