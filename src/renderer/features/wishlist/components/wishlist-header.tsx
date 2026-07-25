import { useTranslation } from 'react-i18next';

import { PageHeader } from '/@/renderer/components/page-header/page-header';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { openCreateWishlistModal } from '/@/renderer/features/wishlist/components/create-wishlist-modal';
import { openOfflineWishlistModal } from '/@/renderer/features/wishlist/components/offline-wishlist-modal';
import { WishlistSheetStatusBadge } from '/@/renderer/features/wishlist/components/wishlist-sheet-status-badge';
import { useWishlistSheetStatus } from '/@/renderer/features/wishlist/hooks/use-wishlist-sheet-status';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { Flex } from '/@/shared/components/flex/flex';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';

export const WishlistHeader = () => {
    const { t } = useTranslation();
    const { data: sheetStatus } = useWishlistSheetStatus();

    const handleOfflineWishlistClick = () => {
        if (sheetStatus?.status === 'ok' && sheetStatus.sheet_url) {
            window.open(sheetStatus.sheet_url, '_blank');
        } else {
            openOfflineWishlistModal();
        }
    };

    return (
        <PageHeader>
            <Flex justify="space-between" w="100%">
                <LibraryHeaderBar ignoreMaxWidth>
                    <LibraryHeaderBar.Title>
                        {t('page.sidebar.wishlist', { postProcess: 'titleCase' })}
                    </LibraryHeaderBar.Title>
                </LibraryHeaderBar>
                <Group wrap="nowrap">
                    <WishlistSheetStatusBadge />
                    <Button
                        leftSection={<Icon icon="externalLink" size="sm" />}
                        onClick={handleOfflineWishlistClick}
                        tooltip={{
                            label: t('page.wishlist.offlineWishlist.tooltip', {
                                defaultValue:
                                    'Capture tracks on the go using a linked Google Sheet — add a note, an artist and title, or a YouTube link from your phone, even offline, and Subbox pulls them into your wishlist.',
                            }),
                            multiline: true,
                            openDelay: 300,
                            w: 300,
                        }}
                        variant="default"
                    >
                        {t('page.wishlist.offlineWishlist.title', { postProcess: 'titleCase' })}
                    </Button>
                    <ActionIcon
                        aria-label={
                            t('action.addToWishlist', { postProcess: 'sentenceCase' }) as string
                        }
                        icon="add"
                        iconProps={{ size: 'lg' }}
                        onClick={openCreateWishlistModal}
                        size="lg"
                        tooltip={{
                            label: t('action.addToWishlistTooltip', {
                                defaultValue:
                                    'Add a track you want to your wishlist — paste a YouTube/streaming link or type an artist and title, and Subbox finds and adds it to your library.',
                            }),
                            multiline: true,
                            openDelay: 300,
                            w: 300,
                        }}
                        variant="default"
                    />
                </Group>
            </Flex>
        </PageHeader>
    );
};
