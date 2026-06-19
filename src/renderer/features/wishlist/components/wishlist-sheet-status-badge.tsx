import { useTranslation } from 'react-i18next';

import { useWishlistSheetStatus } from '/@/renderer/features/wishlist/hooks/use-wishlist-sheet-status';
import { Icon } from '/@/shared/components/icon/icon';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';

export const WishlistSheetStatusBadge = () => {
    const { t } = useTranslation();
    const { data } = useWishlistSheetStatus();

    if (!data?.configured) {
        return null;
    }

    if (data.status === 'ok') {
        return (
            <Tooltip
                label={t('page.wishlist.offlineWishlist.statusOk', { postProcess: 'sentenceCase' })}
                withinPortal
            >
                <Icon color="success" icon="success" />
            </Tooltip>
        );
    }

    if (data.status === 'error') {
        return (
            <Tooltip
                label={
                    data.error ??
                    (t('page.wishlist.offlineWishlist.statusError', {
                        postProcess: 'sentenceCase',
                    }) as string)
                }
                withinPortal
            >
                <Icon color="error" icon="error" />
            </Tooltip>
        );
    }

    return (
        <Tooltip
            label={t('page.wishlist.offlineWishlist.statusChecking', {
                postProcess: 'sentenceCase',
            })}
            withinPortal
        >
            <Icon color="muted" icon="info" />
        </Tooltip>
    );
};
