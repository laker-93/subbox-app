import { ListSortByDropdown } from '/@/renderer/features/shared/components/list-sort-by-dropdown';
import { ListSortOrderToggleButton } from '/@/renderer/features/shared/components/list-sort-order-toggle-button';
import { useSettingsStore } from '/@/renderer/store';
import { Divider } from '/@/shared/components/divider/divider';
import { LibraryItem, SortOrder } from '/@/shared/types/domain-types';
import { ItemListKey, ListDisplayType } from '/@/shared/types/types';

interface ListSortControlsProps {
    defaultSortByValue: string;
    defaultSortOrder?: SortOrder;
    /**
     * The settings key whose display type decides whether these controls are needed.
     * Not always `listKey` — sort state is per page, display type is per list.
     */
    displayKey: ItemListKey;
    itemType: LibraryItem;
    listKey: ItemListKey;
}

/**
 * The sort field dropdown and its order toggle, for views with no table header.
 *
 * In a table these are dead weight: clicking a column header sorts by it and clicking
 * again flips the direction, and the header's right-click menu holds the sort fields no
 * column maps to. Grid and detail views have no headers, so there they stay.
 */
export const ListSortControls = ({
    defaultSortByValue,
    defaultSortOrder = SortOrder.ASC,
    displayKey,
    itemType,
    listKey,
}: ListSortControlsProps) => {
    const displayType = useSettingsStore(
        (state) => state.lists[displayKey]?.display,
    ) as ListDisplayType;

    if (displayType === ListDisplayType.TABLE) {
        return null;
    }

    return (
        <>
            <ListSortByDropdown
                defaultSortByValue={defaultSortByValue}
                itemType={itemType}
                listKey={listKey}
            />
            <Divider orientation="vertical" />
            <ListSortOrderToggleButton defaultSortOrder={defaultSortOrder} listKey={listKey} />
        </>
    );
};
