import { useMemo } from 'react';

import { parseTableColumns } from '/@/renderer/components/item-list/helpers/parse-table-columns';
import { AUTO_FIT_MIN_WIDTHS } from '/@/renderer/components/item-list/item-table-list/default-columns';
import { ItemTableListColumnConfig } from '/@/renderer/components/item-list/types';
import { useShowDjColumns, withoutDjColumns } from '/@/renderer/features/dj/hooks/use-dj-columns';

const minWidthOf = (column: ItemTableListColumnConfig) => AUTO_FIT_MIN_WIDTHS[column.id] ?? 0;

export const useTableColumnModel = ({
    autoFitColumns,
    centerContainerWidth,
    columns,
    totalContainerWidth,
}: {
    autoFitColumns: boolean;
    centerContainerWidth: number;
    columns: ItemTableListColumnConfig[];
    totalContainerWidth: number;
}) => {
    const showDj = useShowDjColumns();
    const parsedColumns = useMemo(
        () => parseTableColumns(showDj ? columns : withoutDjColumns(columns)),
        [columns, showDj],
    );

    const calculatedColumnWidths = useMemo(() => {
        const baseWidths = parsedColumns.map((c) => c.width);

        // When autoSizeColumns is enabled, treat unpinned widths as proportions and scale to fit container.
        // Pinned columns keep their base width so they don't get squeezed.
        if (autoFitColumns) {
            const pinnedWidth = parsedColumns.reduce(
                (sum, col, idx) => (col.pinned !== null ? sum + baseWidths[idx] : sum),
                0,
            );
            const unpinnedIndices: number[] = [];
            parsedColumns.forEach((col, idx) => {
                if (col.pinned === null) {
                    unpinnedIndices.push(idx);
                }
            });

            const unpinnedReferenceWidth = unpinnedIndices.reduce(
                (sum, idx) => sum + baseWidths[idx],
                0,
            );
            const availableForUnpinned = totalContainerWidth - pinnedWidth;

            if (unpinnedReferenceWidth === 0 || availableForUnpinned <= 0) {
                return baseWidths.map((width) => Math.round(width));
            }

            // A column with a minimum (AUTO_FIT_MIN_WIDTHS) is held there rather than
            // squeezed below it, and the rest share what is left. Holding one shrinks the
            // others, which can take another below its minimum, so repeat until none is.
            const floored = new Set<number>();
            let scaleFactor = availableForUnpinned / unpinnedReferenceWidth;
            for (;;) {
                const free = unpinnedIndices.filter((idx) => !floored.has(idx));
                const freeReference = free.reduce((sum, idx) => sum + baseWidths[idx], 0);
                const flooredWidth = [...floored].reduce(
                    (sum, idx) => sum + minWidthOf(parsedColumns[idx]),
                    0,
                );
                if (freeReference === 0) break;
                scaleFactor = Math.max(0, availableForUnpinned - flooredWidth) / freeReference;
                const below = free.filter(
                    (idx) => baseWidths[idx] * scaleFactor < minWidthOf(parsedColumns[idx]),
                );
                if (below.length === 0) break;
                below.forEach((idx) => floored.add(idx));
            }

            const scaledWidths = baseWidths.map((width, idx) => {
                if (parsedColumns[idx].pinned !== null) {
                    return Math.round(width);
                }
                if (floored.has(idx)) {
                    return minWidthOf(parsedColumns[idx]);
                }
                return Math.round(width * scaleFactor);
            });

            // Adjust for rounding errors on unpinned, unfloored columns only
            const totalScaled = scaledWidths.reduce((sum, width) => sum + width, 0);
            const difference = totalContainerWidth - totalScaled;
            const adjustable = unpinnedIndices.filter((idx) => !floored.has(idx));

            if (difference !== 0 && adjustable.length > 0) {
                const sortedIndices = adjustable
                    .map((idx) => ({ idx, width: scaledWidths[idx] }))
                    .sort((a, b) => b.width - a.width);

                const adjustmentPerColumn = Math.sign(difference);
                const adjustmentCount = Math.abs(difference);

                for (let i = 0; i < adjustmentCount && i < sortedIndices.length; i++) {
                    scaledWidths[sortedIndices[i].idx] += adjustmentPerColumn;
                }
            }

            return scaledWidths;
        }

        // Original behavior: distribute extra space to auto-size columns
        const distributed = baseWidths.slice();
        const unpinnedIndices: number[] = [];
        const autoUnpinnedIndices: number[] = [];

        parsedColumns.forEach((col, idx) => {
            if (col.pinned === null) {
                unpinnedIndices.push(idx);
                if (col.autoSize) {
                    autoUnpinnedIndices.push(idx);
                }
            }
        });

        if (unpinnedIndices.length === 0 || autoUnpinnedIndices.length === 0) {
            return distributed.map((width) => Math.round(width));
        }

        const unpinnedBaseTotal = unpinnedIndices.reduce((sum, idx) => sum + baseWidths[idx], 0);
        const extra = Math.max(0, centerContainerWidth - unpinnedBaseTotal);
        if (extra <= 0) {
            return distributed.map((width) => Math.round(width));
        }

        const extraPer = extra / autoUnpinnedIndices.length;
        autoUnpinnedIndices.forEach((idx) => {
            distributed[idx] = Math.round(baseWidths[idx] + extraPer);
        });

        return distributed.map((width) => Math.round(width));
    }, [autoFitColumns, centerContainerWidth, parsedColumns, totalContainerWidth]);

    const pinnedLeftColumnCount = useMemo(
        () => parsedColumns.filter((col) => col.pinned === 'left').length,
        [parsedColumns],
    );
    const pinnedRightColumnCount = useMemo(
        () => parsedColumns.filter((col) => col.pinned === 'right').length,
        [parsedColumns],
    );

    const columnCount = parsedColumns.length;
    const totalColumnCount = columnCount - pinnedLeftColumnCount - pinnedRightColumnCount;

    return useMemo(
        () => ({
            calculatedColumnWidths,
            columnCount,
            parsedColumns,
            pinnedLeftColumnCount,
            pinnedRightColumnCount,
            totalColumnCount,
        }),
        [
            calculatedColumnWidths,
            columnCount,
            parsedColumns,
            pinnedLeftColumnCount,
            pinnedRightColumnCount,
            totalColumnCount,
        ],
    );
};
