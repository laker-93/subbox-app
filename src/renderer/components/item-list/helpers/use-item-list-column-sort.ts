import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { COLUMN_SORT_KEYS } from '/@/renderer/components/item-list/helpers/column-sort-keys';
import { ItemListColumnSort } from '/@/renderer/components/item-list/types';
import { getListSortOptions } from '/@/renderer/features/shared/components/list-sort-by-dropdown';
import { useListFilterPersistence } from '/@/renderer/features/shared/hooks/use-list-filter-persistence';
import { useSortByFilter } from '/@/renderer/features/shared/hooks/use-sort-by-filter';
import { useSortOrderFilter } from '/@/renderer/features/shared/hooks/use-sort-order-filter';
import { FILTER_KEYS } from '/@/renderer/features/shared/utils';
import { useCurrentServer } from '/@/renderer/store';
import { setSearchParam } from '/@/renderer/utils/query-params';
import { LibraryItem, SortOrder } from '/@/shared/types/domain-types';
import { ItemListKey, TableColumn } from '/@/shared/types/types';

interface UseItemListColumnSortProps {
    defaultSortBy: string;
    defaultSortOrder: SortOrder;
    /**
     * The item type whose sort fields apply — it decides both which columns map to a
     * sort field and which of those fields are on offer. A playlist's song table passes
     * `PLAYLIST_SONG`: the columns are the song columns, but the fields on offer are the
     * client-side set, not what the server can sort.
     */
    itemType: LibraryItem;
    listKey: ItemListKey;
}

/**
 * Click-to-sort for table headers.
 *
 * Clicking a new column sorts by that column in its natural direction (name ascending,
 * play count descending, ...); clicking the column that is already sorted flips the
 * direction. Sort state is the same URL-param + per-server persisted state the sort
 * dropdown writes, so the two controls stay in lockstep.
 */
export const useItemListColumnSort = ({
    defaultSortBy,
    defaultSortOrder,
    itemType,
    listKey,
}: UseItemListColumnSortProps): ItemListColumnSort => {
    const server = useCurrentServer();
    const { setFilters } = useListFilterPersistence(server.id, listKey);
    const [, setSearchParams] = useSearchParams();

    const { sortBy } = useSortByFilter<string>(defaultSortBy, listKey);
    const { sortOrder } = useSortOrderFilter(defaultSortOrder, listKey);

    const sortOptions = useMemo(
        () => getListSortOptions(itemType, server.type),
        [itemType, server.type],
    );

    // Only columns the server can actually sort by are clickable.
    const columnSortKeys = useMemo(() => {
        const supported = new Set(sortOptions.map((option) => option.value));
        const result = new Map<TableColumn, string>();

        Object.entries(COLUMN_SORT_KEYS[itemType] ?? {}).forEach(([column, sortKey]) => {
            if (sortKey && supported.has(sortKey)) {
                result.set(column as TableColumn, sortKey);
            }
        });

        return result;
    }, [itemType, sortOptions]);

    const applySort = useCallback(
        (sortKey: string, nextSortOrder?: SortOrder) => {
            // No explicit direction means "the direction this field is usually read in"
            // — name A-Z, play count high-first.
            const resolvedSortOrder =
                nextSortOrder ??
                sortOptions.find((option) => option.value === sortKey)?.defaultOrder ??
                SortOrder.ASC;

            // Both params go out in one write — two sequential setSearchParams calls in
            // the same tick would race, and the second would clobber the first.
            setSearchParams(
                (prev) => {
                    const withSortBy = setSearchParam(prev, FILTER_KEYS.SHARED.SORT_BY, sortKey);
                    return setSearchParam(
                        withSortBy,
                        FILTER_KEYS.SHARED.SORT_ORDER,
                        resolvedSortOrder,
                    );
                },
                { replace: true },
            );

            setFilters({
                [FILTER_KEYS.SHARED.SORT_BY]: sortKey,
                [FILTER_KEYS.SHARED.SORT_ORDER]: resolvedSortOrder,
            });
        },
        [setFilters, setSearchParams, sortOptions],
    );

    const onSort = useCallback(
        (columnId: TableColumn) => {
            const sortKey = columnSortKeys.get(columnId);

            if (!sortKey) {
                return;
            }

            // Re-clicking the sorted column flips it; a new column starts at its
            // natural direction.
            if (sortKey === sortBy) {
                applySort(sortKey, sortOrder === SortOrder.ASC ? SortOrder.DESC : SortOrder.ASC);
                return;
            }

            applySort(sortKey);
        },
        [applySort, columnSortKeys, sortBy, sortOrder],
    );

    return useMemo(
        () => ({ columnSortKeys, onSort, sortBy, sortOrder }),
        [columnSortKeys, onSort, sortBy, sortOrder],
    );
};
