import {
    createContext,
    MouseEvent,
    ReactNode,
    useCallback,
    useContext,
    useMemo,
    useRef,
} from 'react';

import { TableColumnHeaderMenu } from '/@/renderer/components/item-list/item-table-list/table-column-header-menu';
import { ItemListColumnVisibility } from '/@/renderer/components/item-list/types';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';

type OpenColumnMenu = ((event: MouseEvent<HTMLElement>) => void) | null;

const TableColumnMenuContext = createContext<OpenColumnMenu>(null);

/** Returns an opener for the header menu, or null when this table has no menu. */
export const useTableColumnMenu = () => useContext(TableColumnMenuContext);

interface TableColumnMenuProviderProps {
    children: ReactNode;
    columnVisibility?: ItemListColumnVisibility;
}

/**
 * Hosts the header's right-click menu above the virtualized grid.
 *
 * It cannot live inside a header cell: toggling a column changes the column set, the
 * grid rebuilds its cells, and a menu owned by one of them would close on its own
 * first click. Held here it survives, so several columns can be toggled in one go.
 *
 * Opening it works the way `ContextMenuController` does — a zero-sized trigger takes a
 * synthetic contextmenu event at the pointer, which is what Radix positions against.
 */
export const TableColumnMenuProvider = ({
    children,
    columnVisibility,
}: TableColumnMenuProviderProps) => {
    const triggerRef = useRef<HTMLDivElement>(null);
    const hasMenu = Boolean(columnVisibility);

    const openColumnMenu = useCallback((event: MouseEvent<HTMLElement>) => {
        event.preventDefault();

        triggerRef.current?.dispatchEvent(
            new window.MouseEvent('contextmenu', {
                bubbles: true,
                clientX: event.clientX,
                clientY: event.clientY,
            }),
        );
    }, []);

    const value = useMemo(() => (hasMenu ? openColumnMenu : null), [hasMenu, openColumnMenu]);

    if (!hasMenu) {
        return (
            <TableColumnMenuContext.Provider value={null}>
                {children}
            </TableColumnMenuContext.Provider>
        );
    }

    return (
        <TableColumnMenuContext.Provider value={value}>
            {children}
            <ContextMenu>
                <ContextMenu.Target>
                    <div
                        ref={triggerRef}
                        style={{
                            height: 0,
                            left: 0,
                            pointerEvents: 'none',
                            position: 'absolute',
                            top: 0,
                            userSelect: 'none',
                            width: 0,
                        }}
                    />
                </ContextMenu.Target>
                <TableColumnHeaderMenu
                    columnVisibility={columnVisibility as ItemListColumnVisibility}
                />
            </ContextMenu>
        </TableColumnMenuContext.Provider>
    );
};
