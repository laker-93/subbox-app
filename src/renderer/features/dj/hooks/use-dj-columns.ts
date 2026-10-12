import { DJ_COLUMNS } from '/@/renderer/components/item-list/item-table-list/default-columns';
import { useDjMode } from '/@/renderer/features/dj/hooks/use-dj-mode';
import { TableColumn } from '/@/shared/types/types';

// Subbox-only: the song table's DJ columns (subbox-app#240) exist only in DJ mode
// (design-dj-ui §5.7). Settings keep them, enabled or not, whatever the mode, so
// turning DJ mode back on brings back the columns the user had.

export const isDjColumn = (id: string) => DJ_COLUMNS.includes(id as TableColumn);

export const withoutDjColumns = <T extends { id: string }>(columns: T[]) =>
    columns.filter((column) => !isDjColumn(column.id));

/** Whether tables show the DJ columns: in DJ mode only. */
export const useShowDjColumns = () => useDjMode().enabled;
