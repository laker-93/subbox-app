import { useCallback, useMemo } from 'react';

import { DefaultTableColumn } from '/@/renderer/components/item-list/item-table-list/default-columns';
import { ItemListColumnVisibility } from '/@/renderer/components/item-list/types';
import { useSettingsStore, useSettingsStoreActions } from '/@/renderer/store';
import { ItemListKey, TableColumn } from '/@/shared/types/types';

interface UseItemListColumnVisibilityProps {
    itemListKey: ItemListKey;
    /** The full set of columns this table offers, for their labels and their order. */
    tableColumnsData: DefaultTableColumn[];
    tableKey?: 'detail' | 'main';
}

/**
 * Show/hide columns from the header's right-click menu.
 *
 * Writes the same `lists[key].table.columns` the configure modal writes, so a column
 * toggled here is toggled there too.
 */
export const useItemListColumnVisibility = ({
    itemListKey,
    tableColumnsData,
    tableKey = 'main',
}: UseItemListColumnVisibilityProps): ItemListColumnVisibility => {
    const { setList } = useSettingsStoreActions();
    const columns = useSettingsStore((state) => {
        const list = state.lists[itemListKey];
        return tableKey === 'detail' ? list?.detail?.columns : list?.table?.columns;
    });

    const labels = useMemo(() => {
        return new Map(tableColumnsData.map((column) => [column.value, column.label]));
    }, [tableColumnsData]);

    // Settings hold every column, enabled or not, in display order — that order is what
    // the menu lists. A column with no label here is one this table doesn't offer.
    const menuColumns = useMemo(() => {
        return (columns ?? [])
            .filter((column) => labels.has(column.id))
            .map((column) => ({
                id: column.id,
                isEnabled: column.isEnabled,
                label: labels.get(column.id) as string,
            }));
    }, [columns, labels]);

    const onToggleColumn = useCallback(
        (columnId: TableColumn) => {
            if (!columns) {
                return;
            }

            const updatedColumns = columns.map((column) =>
                column.id === columnId ? { ...column, isEnabled: !column.isEnabled } : column,
            );

            if (tableKey === 'detail') {
                type SetListData = Parameters<
                    ReturnType<typeof useSettingsStoreActions>['setList']
                >[1];
                setList(itemListKey, { detail: { columns: updatedColumns } } as SetListData);
            } else {
                setList(itemListKey, { table: { columns: updatedColumns } });
            }
        },
        [columns, itemListKey, setList, tableKey],
    );

    return useMemo(() => ({ columns: menuColumns, onToggleColumn }), [menuColumns, onToggleColumn]);
};
