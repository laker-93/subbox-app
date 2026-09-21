import { useCallback } from 'react';

import { useLocalStorage } from '/@/shared/hooks/use-local-storage';
import { ItemListKey } from '/@/shared/types/types';

export interface ListFilterPersistence {
    [listKey: string]: {
        [filterKey: string]: string | undefined;
    };
}

const getPersistenceKey = (serverId: string) => {
    return `${serverId}-filters`;
};

export const useListFilterPersistence = (serverId: string, listKey: ItemListKey) => {
    const [persistedFilters, setPersistedFilters] = useLocalStorage<ListFilterPersistence>({
        defaultValue: {},
        key: getPersistenceKey(serverId),
    });

    const getFilter = (filterKey: string): string | undefined => {
        return persistedFilters?.[listKey]?.[filterKey];
    };

    // Both setters are memoized: `useItemListColumnSort` carries `setFilters` into the
    // `columnSort` object the table cells are memoized against, so an identity that
    // changed every render would defeat those checks on every virtualized cell.
    const setFilter = useCallback(
        (filterKey: string, value: string) => {
            setPersistedFilters((prev) => ({
                ...prev,
                [listKey]: {
                    ...prev[listKey],
                    [filterKey]: value,
                },
            }));
        },
        [listKey, setPersistedFilters],
    );

    const setFilters = useCallback(
        (filters: Record<string, string>) => {
            setPersistedFilters((prev) => ({
                ...prev,
                [listKey]: {
                    ...prev[listKey],
                    ...filters,
                },
            }));
        },
        [listKey, setPersistedFilters],
    );

    return {
        getFilter,
        setFilter,
        setFilters,
    };
};
