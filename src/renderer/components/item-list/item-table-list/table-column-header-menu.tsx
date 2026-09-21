import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

import styles from './table-column-header-menu.module.css';

import { ItemListColumnVisibility } from '/@/renderer/components/item-list/types';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { Icon } from '/@/shared/components/icon/icon';

interface TableColumnHeaderMenuProps {
    columnVisibility: ItemListColumnVisibility;
}

/**
 * The right-click menu on a table header: which columns are shown, and nothing else.
 *
 * Sorting is not here on purpose — the header row itself is the sort control, so a
 * sort section would be a second way to do what a click on the column already does.
 */
export const TableColumnHeaderMenu = ({ columnVisibility }: TableColumnHeaderMenuProps) => {
    const { t } = useTranslation();

    return (
        <ContextMenu.Content>
            <ContextMenu.Label>
                {t('common.tableColumns', { postProcess: 'titleCase' })}
            </ContextMenu.Label>
            {columnVisibility.columns.map((column) => (
                <ContextMenu.Item
                    key={column.id}
                    onSelect={(event) => {
                        // Columns are usually toggled a few at a time, so keep the menu
                        // open instead of letting the select close it.
                        event.preventDefault();
                        columnVisibility.onToggleColumn(column.id);
                    }}
                >
                    <span className={styles.columnItem}>
                        <Icon
                            className={clsx(styles.columnCheck, {
                                [styles.columnCheckHidden]: !column.isEnabled,
                            })}
                            icon="check"
                        />
                        <span className={styles.columnLabel}>{column.label}</span>
                    </span>
                </ContextMenu.Item>
            ))}
        </ContextMenu.Content>
    );
};
