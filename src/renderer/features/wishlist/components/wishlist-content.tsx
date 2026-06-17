import { useTranslation } from 'react-i18next';

import { WishlistCard } from '/@/renderer/features/wishlist/components/wishlist-card';
import { useWishlist } from '/@/renderer/features/wishlist/hooks/use-wishlist';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

export const WishlistContent = () => {
    const { t } = useTranslation();
    const wishlistQuery = useWishlist();

    if (wishlistQuery.isLoading) {
        return <Spinner container />;
    }

    const items = wishlistQuery.data || [];

    return (
        <ScrollArea>
            <Stack p="md">
                {items.length === 0 ? (
                    <Text isMuted ta="center">
                        {t('page.wishlist.empty', { postProcess: 'sentenceCase' })}
                    </Text>
                ) : (
                    items.map((item) => <WishlistCard item={item} key={item.wishlist_id} />)
                )}
            </Stack>
        </ScrollArea>
    );
};
