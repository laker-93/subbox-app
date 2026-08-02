import { useShallow } from 'zustand/react/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

/**
 * Where the user was when they asked for an invite. Only used to pick the modal's
 * opening line — the request payload is identical either way — but that line is the
 * whole point of the funnel: someone who just hit a locked upload needs a different
 * first sentence from someone idly clicking a banner.
 */
export type InviteRequestSource = 'blockedAction' | 'createAccount' | 'demoBanner' | 'landing';

/**
 * Session-scoped, deliberately not persisted to localStorage: a dismissal should last
 * as long as the visit, not forever. Someone returning a week later is a fresh
 * opportunity to ask, and re-showing it then isn't nagging.
 */
const BANNER_DISMISSED_KEY = 'subbox-demo-banner-dismissed';

const readBannerDismissed = (): boolean => {
    try {
        return sessionStorage.getItem(BANNER_DISMISSED_KEY) === 'true';
    } catch {
        // Private browsing / storage disabled — showing the banner is the safe default.
        return false;
    }
};

interface InviteRequestActions {
    closeInviteRequest: () => void;
    dismissDemoBanner: () => void;
    openInviteRequest: (source: InviteRequestSource) => void;
}

interface InviteRequestState {
    /** Whether the demo banner has been dismissed for this browser session. */
    bannerDismissed: boolean;
    opened: boolean;
    source: InviteRequestSource;
}

export const useInviteRequestStore = createWithEqualityFn<
    InviteRequestActions & InviteRequestState
>()((set) => ({
    bannerDismissed: readBannerDismissed(),

    closeInviteRequest: () => {
        set({ opened: false });
    },

    dismissDemoBanner: () => {
        try {
            sessionStorage.setItem(BANNER_DISMISSED_KEY, 'true');
        } catch {
            // Non-fatal: the banner still hides for this render, it just comes back on
            // a reload. Better than crashing the shell.
        }
        set({ bannerDismissed: true });
    },

    opened: false,

    openInviteRequest: (source: InviteRequestSource) => {
        set({ opened: true, source });
    },

    source: 'landing',
}));

export const useInviteRequestOpened = () => useInviteRequestStore((s) => s.opened);
export const useInviteRequestSource = () => useInviteRequestStore((s) => s.source);
export const useDemoBannerDismissed = () => useInviteRequestStore((s) => s.bannerDismissed);

export const useInviteRequestActions = () =>
    useInviteRequestStore(
        useShallow((s) => ({
            closeInviteRequest: s.closeInviteRequest,
            dismissDemoBanner: s.dismissDemoBanner,
            openInviteRequest: s.openInviteRequest,
        })),
    );

/**
 * Imperative opener, for the handful of call sites that aren't React components (and to
 * keep one-line onClick handlers from having to subscribe to the store).
 */
export const openInviteRequest = (source: InviteRequestSource) =>
    useInviteRequestStore.getState().openInviteRequest(source);
