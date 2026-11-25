import { useCallback } from 'react';

import { useSettingsStore, useSettingsStoreActions } from '/@/renderer/store';
import { ItemListKey, TableColumn } from '/@/shared/types/types';

interface UseItemListColumnResizeProps {
    itemListKey: ItemListKey;
    tableKey?: 'detail' | 'main';
}

export const useItemListColumnResize = ({
    itemListKey,
    tableKey = 'main',
}: UseItemListColumnResizeProps) => {
    const { setList } = useSettingsStoreActions();
    const columns = useSettingsStore((state) => {
        const list = state.lists[itemListKey];
        return tableKey === 'detail' ? list?.detail?.columns : list?.table?.columns;
    });

    const handleColumnResized = useCallback(
        (
            columnId: TableColumn,
            width: number,
            renderedWidths?: Partial<Record<TableColumn, number>>,
        ) => {
            if (!columns) return;

            // From an auto-fitting table: keep every column at the width it has on
            // screen and stop auto-fitting, so this resize only changes this column
            // (and a wide column scrolls the table rather than squeezing the rest).
            const freeze = Boolean(renderedWidths) && tableKey === 'main';

            const updatedColumns = columns.map((column) => {
                if (column.id === columnId) return { ...column, width };
                const rendered = freeze ? renderedWidths?.[column.id] : undefined;
                return rendered ? { ...column, width: rendered } : column;
            });

            if (tableKey === 'detail') {
                type SetListData = Parameters<
                    ReturnType<typeof useSettingsStoreActions>['setList']
                >[1];
                setList(itemListKey, { detail: { columns: updatedColumns } } as SetListData);
            } else {
                setList(itemListKey, {
                    table: {
                        ...(freeze ? { autoFitColumns: false } : {}),
                        columns: updatedColumns,
                    },
                });
            }
        },
        [columns, itemListKey, setList, tableKey],
    );

    return { handleColumnResized };
};
