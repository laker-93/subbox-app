import i18n from '/@/i18n/i18n';
import { WishlistSortBy } from '/@/renderer/store/app.store';
import { SortOrder } from '/@/shared/types/domain-types';

export const WISHLIST_SHEET_TEMPLATE_ID = '1AUS_1Y5xo-HUoGxQkVQRsZFQMYZ6w8KsNeI4VOP9t64';

export const WISHLIST_SHEET_SERVICE_ACCOUNT_EMAIL =
    'claude-sheets@api-access-499608.iam.gserviceaccount.com';

export const WISHLIST_SHEET_TEMPLATE_COPY_URL = `https://docs.google.com/spreadsheets/d/${WISHLIST_SHEET_TEMPLATE_ID}/copy`;

// Client-side only — wishlistList() has no server-side sort, so these describe how
// WishlistContent orders the already-fetched list, not a request parameter.
export const WISHLIST_SORT_FILTERS: Array<{
    defaultOrder: SortOrder;
    name: string;
    value: WishlistSortBy;
}> = [
    {
        defaultOrder: SortOrder.DESC,
        name: i18n.t('filter.dateAdded', { postProcess: 'titleCase' }),
        value: 'createdAt',
    },
    {
        defaultOrder: SortOrder.ASC,
        name: i18n.t('page.wishlist.columns.title', { postProcess: 'titleCase' }),
        value: 'title',
    },
    {
        defaultOrder: SortOrder.ASC,
        name: i18n.t('page.wishlist.columns.artist', { postProcess: 'titleCase' }),
        value: 'artist',
    },
    {
        defaultOrder: SortOrder.ASC,
        name: i18n.t('page.wishlist.columns.album', { postProcess: 'titleCase' }),
        value: 'album',
    },
    {
        defaultOrder: SortOrder.ASC,
        name: i18n.t('page.wishlist.columns.status', { postProcess: 'titleCase' }),
        value: 'status',
    },
];
