import { useTranslation } from 'react-i18next';

import { useDjMode } from '/@/renderer/features/dj/hooks/use-dj-mode';
import { useOpenPrep } from '/@/renderer/features/dj/hooks/use-open-prep';
import { subboxIdOf } from '/@/renderer/features/dj/utils/subbox-id';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { Song } from '/@/shared/types/domain-types';

interface PrepTrackActionProps {
    items: Song[];
    /** The list the menu was opened on, so prep's prev/next can walk it. */
    list?: readonly unknown[];
}

// Subbox-only (subbox-app#239): open one track in the prep view. DJ mode only, and only
// for a song with a subbox_id, since that's what its DJ data hangs off.
export const PrepTrackAction = ({ items, list }: PrepTrackActionProps) => {
    const { t } = useTranslation();
    const djMode = useDjMode();
    const openPrep = useOpenPrep();

    if (!djMode.enabled || items.length !== 1) return null;

    return (
        <>
            <ContextMenu.Item
                disabled={!subboxIdOf(items[0])}
                leftIcon="djPrep"
                onSelect={() => openPrep(items[0], list)}
            >
                {t('page.contextMenu.prepTrack')}
            </ContextMenu.Item>
            <ContextMenu.Divider />
        </>
    );
};
