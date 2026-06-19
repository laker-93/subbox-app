import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { WishlistContent } from '/@/renderer/features/wishlist/components/wishlist-content';
import { WishlistHeader } from '/@/renderer/features/wishlist/components/wishlist-header';

const WishlistRoute = () => {
    return (
        <AnimatedPage>
            <WishlistHeader />
            <WishlistContent />
        </AnimatedPage>
    );
};

const WishlistRouteWithBoundary = () => {
    return (
        <PageErrorBoundary>
            <WishlistRoute />
        </PageErrorBoundary>
    );
};

export default WishlistRouteWithBoundary;
