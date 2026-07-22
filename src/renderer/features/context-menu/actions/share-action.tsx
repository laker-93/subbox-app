import { LibraryItem } from '/@/shared/types/domain-types';

interface ShareActionProps {
    ids: string[];
    itemType: LibraryItem;
}

// Subbox's per-user Navidrome instances run with sharing disabled server-side
// (no ND_ENABLESHARING), so this Feishin-inherited action always fails with a
// "Failed to create share" toast. Hidden until sharing is enabled server-side.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const ShareAction = (_props: ShareActionProps) => {
    return null;
};
