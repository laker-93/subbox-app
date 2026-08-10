import { useTranslation } from 'react-i18next';

import { useAppStoreActions } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Center } from '/@/shared/components/center/center';
import { Icon } from '/@/shared/components/icon/icon';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

// Sync (Upload/Download/Watch/External Drive) relies on a file picker and
// wide multi-pane layouts that don't fit a phone-sized viewport. Rather than
// silently hiding the feature (see subbox-app#80), tell the user why it's
// unavailable here and give them a one-tap way back to Library.
export const MobileSyncPlaceholder = () => {
    const { t } = useTranslation();
    const { setAppMode } = useAppStoreActions();

    return (
        <Center style={{ height: '100%', padding: 'var(--theme-spacing-lg)' }}>
            <Stack align="center" gap="sm" maw={320}>
                <Icon icon="refresh" size="xl" />
                <Text fw={600} ta="center">
                    {t('page.modeToggle.mobileSyncTitle', {
                        defaultValue: 'Sync needs a wider screen',
                    })}
                </Text>
                <Text c="dimmed" size="sm" ta="center">
                    {t('page.modeToggle.mobileSyncDescription', {
                        defaultValue:
                            'Uploading, downloading, and watching folders work best with more room. Widen this window or open Sub-box on a desktop to use Sync.',
                    })}
                </Text>
                <Button onClick={() => setAppMode('library')} size="sm" variant="default">
                    {t('page.modeToggle.backToLibrary', {
                        defaultValue: 'Back to Library',
                    })}
                </Button>
            </Stack>
        </Center>
    );
};
