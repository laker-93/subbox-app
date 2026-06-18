import { useTranslation } from 'react-i18next';

import { PageHeader } from '/@/renderer/components/page-header/page-header';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { openCreateWishlistModal } from '/@/renderer/features/wishlist/components/create-wishlist-modal';
import { openOfflineWishlistModal } from '/@/renderer/features/wishlist/components/offline-wishlist-modal';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { Flex } from '/@/shared/components/flex/flex';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';

export const WishlistHeader = () => {
    const { t } = useTranslation();

    return (
        <PageHeader>
            <Flex justify="space-between" w="100%">
                <LibraryHeaderBar ignoreMaxWidth>
                    <LibraryHeaderBar.Title>
                        {t('page.sidebar.wishlist', { postProcess: 'titleCase' })}
                    </LibraryHeaderBar.Title>
                </LibraryHeaderBar>
                <Group wrap="nowrap">
                    <Button
                        leftSection={<Icon icon="externalLink" size="sm" />}
                        onClick={openOfflineWishlistModal}
                        variant="default"
                    >
                        {t('page.wishlist.offlineWishlist.title', { postProcess: 'titleCase' })}
                    </Button>
                    <ActionIcon
                        icon="add"
                        iconProps={{ size: 'lg' }}
                        onClick={openCreateWishlistModal}
                        size="lg"
                        tooltip={{
                            label: t('action.addToWishlist', { postProcess: 'sentenceCase' }),
                        }}
                        variant="default"
                    />
                </Group>
            </Flex>
        </PageHeader>
    );
};
