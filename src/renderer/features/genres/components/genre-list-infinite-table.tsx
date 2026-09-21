import { UseSuspenseQueryOptions } from '@tanstack/react-query';

import { api } from '/@/renderer/api';
import { useItemListInfiniteLoader } from '/@/renderer/components/item-list/helpers/item-list-infinite-loader';
import { useItemListColumnReorder } from '/@/renderer/components/item-list/helpers/use-item-list-column-reorder';
import { useItemListColumnResize } from '/@/renderer/components/item-list/helpers/use-item-list-column-resize';
import { useItemListColumnSort } from '/@/renderer/components/item-list/helpers/use-item-list-column-sort';
import { useItemListColumnVisibility } from '/@/renderer/components/item-list/helpers/use-item-list-column-visibility';
import { useItemListScrollPersist } from '/@/renderer/components/item-list/helpers/use-item-list-scroll-persist';
import { GENRE_TABLE_COLUMNS } from '/@/renderer/components/item-list/item-table-list/default-columns';
import { ItemTableList } from '/@/renderer/components/item-list/item-table-list/item-table-list';
import { ItemTableListColumn } from '/@/renderer/components/item-list/item-table-list/item-table-list-column';
import { ItemListTableComponentProps } from '/@/renderer/components/item-list/types';
import { genresQueries } from '/@/renderer/features/genres/api/genres-api';
import {
    GenreListQuery,
    GenreListSort,
    LibraryItem,
    SortOrder,
} from '/@/shared/types/domain-types';
import { ItemListKey } from '/@/shared/types/types';

interface GenreListInfiniteTableProps extends ItemListTableComponentProps<GenreListQuery> {}

export const GenreListInfiniteTable = ({
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
        sortBy: GenreListSort.NAME,
        sortOrder: SortOrder.ASC,
    },
    saveScrollOffset = true,
    serverId,
    size = 'default',
}: GenreListInfiniteTableProps) => {
    const listCountQuery = genresQueries.listCount({
        query: { ...query },
        serverId: serverId,
    }) as UseSuspenseQueryOptions<number, Error, number, readonly unknown[]>;

    const listQueryFn = api.controller.getGenreList;

    const { getItem, getItemIndex, itemCount, loadedItems, onRangeChanged } =
        useItemListInfiniteLoader({
            eventKey: ItemListKey.GENRE,
            itemsPerPage,
            itemType: LibraryItem.GENRE,
            listCountQuery,
            listQueryFn,
            query,
            serverId,
        });

    const { handleOnScrollEnd, scrollOffset } = useItemListScrollPersist({
        enabled: saveScrollOffset,
    });

    const { handleColumnReordered } = useItemListColumnReorder({
        itemListKey: ItemListKey.GENRE,
    });

    const { handleColumnResized } = useItemListColumnResize({
        itemListKey: ItemListKey.GENRE,
    });

    const columnSort = useItemListColumnSort({
        defaultSortBy: GenreListSort.NAME,
        defaultSortOrder: SortOrder.ASC,
        itemType: LibraryItem.GENRE,
        listKey: ItemListKey.GENRE,
    });

    const columnVisibility = useItemListColumnVisibility({
        itemListKey: ItemListKey.GENRE,
        tableColumnsData: GENRE_TABLE_COLUMNS,
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
            enableExpansion={false}
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
            itemType={LibraryItem.GENRE}
            onColumnReordered={handleColumnReordered}
            onColumnResized={handleColumnResized}
            onRangeChanged={onRangeChanged}
            onScrollEnd={handleOnScrollEnd}
            size={size}
        />
    );
};
