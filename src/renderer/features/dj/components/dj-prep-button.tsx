import { useTranslation } from 'react-i18next';

import { useDjMode } from '/@/renderer/features/dj/hooks/use-dj-mode';
import { useOpenPrep } from '/@/renderer/features/dj/hooks/use-open-prep';
import { usePlayerbarPrepSession } from '/@/renderer/features/dj/prep/prep-session.store';
import { subboxIdOf } from '/@/renderer/features/dj/utils/subbox-id';
import { usePlayerSong, usePlayerStoreBase } from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';

// Subbox-only (subbox-app#239): the full-screen player's way into prep, for the track
// playing now. Prev/next then walk the queue in play order. DJ mode only, and hidden
// while prep already holds the player bar: the full-screen player then shows the prep
// track, and the button would only reopen prep on the app player's.
export const DjPrepButton = () => {
    const { t } = useTranslation();
    const djMode = useDjMode();
    const openPrep = useOpenPrep();
    const song = usePlayerSong();
    const prepSession = usePlayerbarPrepSession();

    if (!djMode.enabled || prepSession || !subboxIdOf(song)) return null;

    return (
        <ActionIcon
            aria-label={t('page.contextMenu.prepTrack')}
            icon="djPrep"
            iconProps={{ size: 'lg' }}
            onClick={() => openPrep(song, usePlayerStoreBase.getState().getQueueOrder().items)}
            tooltip={{ label: t('page.contextMenu.prepTrack') }}
            variant="subtle"
        />
    );
};
