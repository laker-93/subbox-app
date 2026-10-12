import { useEffect } from 'react';

import { DJ_COLUMNS } from '/@/renderer/components/item-list/item-table-list/default-columns';
import { useDjMode } from '/@/renderer/features/dj/hooks/use-dj-mode';
import { useSettingsStore, useSettingsStoreActions } from '/@/renderer/store';
import { TableColumn } from '/@/shared/types/types';

// Subbox-only: the song table's DJ columns (subbox-app#240) exist only in DJ mode
// (design-dj-ui §5.7). Settings keep them, enabled or not, whatever the mode, so
// turning DJ mode back on brings back the columns the user had.

export const isDjColumn = (id: string) => DJ_COLUMNS.includes(id as TableColumn);

export const withoutDjColumns = <T extends { id: string }>(columns: T[]) =>
    columns.filter((column) => !isDjColumn(column.id));

/**
 * Whether tables show the DJ columns: in DJ mode only. The first time they do on this
 * device, Key and Cues are turned on (#259) — whether DJ mode was just switched on here
 * or was already on from another device.
 */
export const useShowDjColumns = () => {
    const enabled = useDjMode().enabled;
    const seeded = useSettingsStore((state) => state.general.djColumnsSeeded);
    const { seedDjColumns } = useSettingsStoreActions();

    useEffect(() => {
        if (enabled && !seeded) seedDjColumns();
    }, [enabled, seeded, seedDjColumns]);

    return enabled;
};
