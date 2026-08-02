import { useTranslation } from 'react-i18next';

import { ListSortByDropdownControlled } from '/@/renderer/features/shared/components/list-sort-by-dropdown';
import { ListSortOrderToggleButtonControlled } from '/@/renderer/features/shared/components/list-sort-order-toggle-button';
import { WISHLIST_SORT_FILTERS } from '/@/renderer/features/wishlist/constants';
import {
    useAppStoreActions,
    useWishlistSort,
    useWishlistStatusFilter,
} from '/@/renderer/store/app.store';
import { Divider } from '/@/shared/components/divider/divider';
import { Group } from '/@/shared/components/group/group';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { LibraryItem, SortOrder } from '/@/shared/types/domain-types';
import { WISHLIST_STATUSES } from '/@/shared/types/wishlist-types';

export const WishlistListControls = () => {
    const { t } = useTranslation();
    const statusFilter = useWishlistStatusFilter();
    const sort = useWishlistSort();
    const { setWishlistSort, setWishlistStatusFilter } = useAppStoreActions();

    const statusOptions = [
        { label: t('page.wishlist.status.all', { postProcess: 'sentenceCase' }), value: 'all' },
        ...WISHLIST_STATUSES.map((status) => ({
            label: t(`page.wishlist.status.${status}`, { postProcess: 'sentenceCase' }),
            value: status,
        })),
    ];

    return (
        <Group gap="sm" wrap="wrap">
            <SegmentedControl
                data={statusOptions}
                onChange={(value) => setWishlistStatusFilter(value as typeof statusFilter)}
                value={statusFilter}
            />
            <Divider orientation="vertical" />
            <Group gap="xs" wrap="nowrap">
                <ListSortByDropdownControlled
                    filters={WISHLIST_SORT_FILTERS}
                    // itemType is unused when `filters` is supplied — the wishlist isn't a
                    // LibraryItem, but the prop is required. Same dummy-value pattern used by
                    // album-artist-detail-favorite-songs-list-header-filters.tsx for its
                    // client-side-only sort.
                    itemType={LibraryItem.SONG}
                    setSortBy={(value) =>
                        setWishlistSort(value as typeof sort.sortBy, sort.sortOrder)
                    }
                    sortBy={sort.sortBy}
                />
                <ListSortOrderToggleButtonControlled
                    setSortOrder={(value: SortOrder) => setWishlistSort(sort.sortBy, value)}
                    sortOrder={sort.sortOrder}
                />
            </Group>
        </Group>
    );
};
