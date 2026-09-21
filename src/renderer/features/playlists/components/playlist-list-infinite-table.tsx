import { UseSuspenseQueryOptions } from '@tanstack/react-query';

import { api } from '/@/renderer/api';
import { useItemListInfiniteLoader } from '/@/renderer/components/item-list/helpers/item-list-infinite-loader';
import { useItemListColumnReorder } from '/@/renderer/components/item-list/helpers/use-item-list-column-reorder';
import { useItemListColumnResize } from '/@/renderer/components/item-list/helpers/use-item-list-column-resize';
import { useItemListColumnSort } from '/@/renderer/components/item-list/helpers/use-item-list-column-sort';
import { useItemListColumnVisibility } from '/@/renderer/components/item-list/helpers/use-item-list-column-visibility';
import { useItemListScrollPersist } from '/@/renderer/components/item-list/helpers/use-item-list-scroll-persist';
import { PLAYLIST_TABLE_COLUMNS } from '/@/renderer/components/item-list/item-table-list/default-columns';
import { ItemTableList } from '/@/renderer/components/item-list/item-table-list/item-table-list';
import { ItemTableListColumn } from '/@/renderer/components/item-list/item-table-list/item-table-list-column';
import { ItemListTableComponentProps } from '/@/renderer/components/item-list/types';
import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import {
    LibraryItem,
    PlaylistListQuery,
    PlaylistListSort,
    SortOrder,
} from '/@/shared/types/domain-types';
import { ItemListKey } from '/@/shared/types/types';

interface PlaylistListInfiniteTableProps extends ItemListTableComponentProps<PlaylistListQuery> {}

export const PlaylistListInfiniteTable = ({
    autoFitColumns = false,
    columns,
    enableAlternateRowColors = false,
    enableHeader = true,
    enableHorizontalBorders = false,
    enableRowHoverHighlight = true,
    enableSelection = true,
    enableVerticalBorders = false,
    itemsPerPage = 100,
    query = {
        sortBy: PlaylistListSort.NAME,
        sortOrder: SortOrder.ASC,
    },
    saveScrollOffset = true,
    serverId,
    size = 'default',
}: PlaylistListInfiniteTableProps) => {
    const listCountQuery = playlistsQueries.listCount({
        query: { ...query },
        serverId: serverId,
    }) as UseSuspenseQueryOptions<number, Error, number, readonly unknown[]>;

    const listQueryFn = api.controller.getPlaylistList;

    const { getItem, getItemIndex, itemCount, loadedItems, onRangeChanged } =
        useItemListInfiniteLoader({
            eventKey: ItemListKey.PLAYLIST,
            itemsPerPage,
            itemType: LibraryItem.PLAYLIST,
            listCountQuery,
            listQueryFn,
            query,
            serverId,
        });

    const { handleOnScrollEnd, scrollOffset } = useItemListScrollPersist({
        enabled: saveScrollOffset,
    });

    const { handleColumnReordered } = useItemListColumnReorder({
        itemListKey: ItemListKey.PLAYLIST,
    });

    const { handleColumnResized } = useItemListColumnResize({
        itemListKey: ItemListKey.PLAYLIST,
    });

    const columnSort = useItemListColumnSort({
        defaultSortBy: PlaylistListSort.NAME,
        defaultSortOrder: SortOrder.ASC,
        itemType: LibraryItem.PLAYLIST,
        listKey: ItemListKey.PLAYLIST,
    });

    const columnVisibility = useItemListColumnVisibility({
        itemListKey: ItemListKey.PLAYLIST,
        tableColumnsData: PLAYLIST_TABLE_COLUMNS,
    });

    return (
        <ItemTableList
            autoFitColumns={autoFitColumns}
            CellComponent={ItemTableListColumn}
            columns={columns}
            columnSort={columnSort}
            columnVisibility={columnVisibility}
            data={loadedItems}
            enableAlternateRowColors={enableAlternateRowColors}
            enableHeader={enableHeader}
            enableHorizontalBorders={enableHorizontalBorders}
            enableRowHoverHighlight={enableRowHoverHighlight}
            enableSelection={enableSelection}
            enableVerticalBorders={enableVerticalBorders}
            getItem={getItem}
            getItemIndex={getItemIndex}
            initialTop={{
                to: scrollOffset ?? 0,
                type: 'offset',
            }}
            itemCount={itemCount}
            itemType={LibraryItem.PLAYLIST}
            onColumnReordered={handleColumnReordered}
            onColumnResized={handleColumnResized}
            onRangeChanged={onRangeChanged}
            onScrollEnd={handleOnScrollEnd}
            size={size}
        />
    );
};
