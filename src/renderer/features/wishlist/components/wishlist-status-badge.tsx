import { useTranslation } from 'react-i18next';

import { Badge } from '/@/shared/components/badge/badge';
import { WishlistStatus } from '/@/shared/types/wishlist-types';

interface WishlistStatusBadgeProps {
    status: WishlistStatus;
}

const STATUS_COLORS: Record<WishlistStatus, string> = {
    available: 'green',
    downloaded: 'blue',
    ignored: 'gray',
    imported: 'teal',
    inbox: 'orange',
    wishlist: 'yellow',
};

export const WishlistStatusBadge = ({ status }: WishlistStatusBadgeProps) => {
    const { t } = useTranslation();

    return (
        <Badge color={STATUS_COLORS[status]} variant="light">
            {t(`page.wishlist.status.${status}`, { postProcess: 'titleCase' })}
        </Badge>
    );
};
