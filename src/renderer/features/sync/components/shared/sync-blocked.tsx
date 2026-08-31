import type { ReactNode } from 'react';

import { useTranslation } from 'react-i18next';

import { urlConfig } from '/@/renderer/config/url-config';
import { SyncCenteredState } from '/@/renderer/features/sync/components/shared/sync-centered-state';
import { Button } from '/@/shared/components/button/button';
import { Center } from '/@/shared/components/center/center';
import { Icon } from '/@/shared/components/icon/icon';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';

interface SyncDesktopOnlyProps {
    /** Why this one needs the desktop app, in the flow's own terms. */
    children: ReactNode;
}

interface SyncStorageExceededProps {
    /** The server's own explanation, if it gave one. */
    error?: null | string;
    /**
     * The way out that is specific to this flow: Serato's "Playlists only"
     * escape hatch, Rekordbox's Discord paragraph.
     */
    note?: ReactNode;
    onBack: () => void;
    storageInfo: null | { currentUsageBytes: number; maxStorageBytes: number };
}

const MB = 1024 * 1024;

/**
 * The "not here, but not broken either" notice for a flow that needs the filesystem.
 *
 * Deliberately plain: on web this is a permanent fact about the build, not a
 * failure the user can act on, so it gets a sentence rather than a warning glyph.
 */
export const SyncDesktopOnly = ({ children }: SyncDesktopOnlyProps) => (
    <Center style={{ height: '100%' }}>
        <Text c="dimmed">{children}</Text>
    </Center>
);

/**
 * The upload-would-not-fit screen.
 *
 * Ends on the ask rather than the refusal: the numbers are there so the user can
 * see how far over they are, but the button is the upgrade, not the retry.
 */
export const SyncStorageExceeded = ({
    error,
    note,
    onBack,
    storageInfo,
}: SyncStorageExceededProps) => {
    const { t } = useTranslation();

    const currentMB = storageInfo ? Math.round(storageInfo.currentUsageBytes / MB) : null;
    const maxMB = storageInfo ? Math.round(storageInfo.maxStorageBytes / MB) : null;

    return (
        <SyncCenteredState>
            <Icon color="warn" icon="error" size="3rem" />
            <TextTitle order={3}>
                {t('page.sync.storageLimitTitle', {
                    defaultValue: 'Storage Limit Reached',
                    postProcess: 'titleCase',
                })}
            </TextTitle>
            <Text c="dimmed" size="sm" ta="center">
                {error ||
                    t('page.sync.storageLimitDescription', {
                        defaultValue: 'Your upload would exceed your storage limit.',
                    })}
            </Text>
            {note}
            {currentMB !== null && maxMB !== null && (
                <Text size="sm" ta="center">
                    Current usage: {currentMB} MB / {maxMB} MB
                </Text>
            )}
            <Button
                component="a"
                fullWidth
                href={urlConfig.discord}
                rel="noopener noreferrer"
                target="_blank"
                variant="filled"
            >
                {t('page.sync.requestStorage', {
                    defaultValue: 'Request More Storage',
                    postProcess: 'titleCase',
                })}
            </Button>
            <Button fullWidth onClick={onBack} variant="subtle">
                {t('common.back', { defaultValue: 'Back', postProcess: 'titleCase' })}
            </Button>
        </SyncCenteredState>
    );
};
