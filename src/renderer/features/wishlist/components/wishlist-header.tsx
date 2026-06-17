import { useTranslation } from 'react-i18next';

import { PageHeader } from '/@/renderer/components/page-header/page-header';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { openCreateWishlistModal } from '/@/renderer/features/wishlist/components/create-wishlist-modal';
import { openOfflineWishlistModal } from '/@/renderer/features/wishlist/components/offline-wishlist-modal';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';

export const WishlistHeader = () => {
    const { t } = useTranslation();

    return (
        <PageHeader>
            <LibraryHeaderBar ignoreMaxWidth>
                <LibraryHeaderBar.Title>
                    {t('page.sidebar.wishlist', { postProcess: 'titleCase' })}
                </LibraryHeaderBar.Title>
            </LibraryHeaderBar>
            <Group>
                <Button onClick={openOfflineWishlistModal} variant="subtle">
                    {t('page.wishlist.offlineWishlist.title', { postProcess: 'titleCase' })}
                </Button>
                <Button onClick={openCreateWishlistModal} variant="subtle">
                    {t('action.addToWishlist', { postProcess: 'sentenceCase' })}
                </Button>
            </Group>
        </PageHeader>
    );
};
