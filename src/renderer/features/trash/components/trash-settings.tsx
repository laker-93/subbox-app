import { closeAllModals } from '@mantine/modals';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useIsDemoSession } from '/@/renderer/config/demo-config';
import { useTrash } from '/@/renderer/features/trash/hooks/use-trash';
import { AppRoute } from '/@/renderer/router/routes';
import { formatSizeString } from '/@/renderer/utils/format';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

// Subbox-only: the way to the Trash screen from Settings (subbox-app#152). demo has no
// trash, so it sees nothing here.
export const TrashSettings = () => {
    const { t } = useTranslation();
    const isDemo = useIsDemoSession();
    const trash = useTrash({ enabled: !isDemo });
    if (isDemo) return null;

    return (
        <Group justify="space-between" wrap="nowrap">
            <Stack gap="xs">
                <Text isNoSelect size="md">
                    {t('page.trash.title', { postProcess: 'sentenceCase' })}
                </Text>
                <Text isMuted size="sm">
                    {trash.data?.trash_bytes
                        ? t('page.trash.explainerHeld', {
                              size: formatSizeString(trash.data.trash_bytes),
                          })
                        : t('page.trash.explainer')}
                </Text>
            </Stack>
            {/* Settings can be a modal: close it on the way. */}
            <Button
                component={Link}
                onClick={() => closeAllModals()}
                to={AppRoute.TRASH}
                variant="default"
            >
                {t('page.trash.open', { postProcess: 'sentenceCase' })}
            </Button>
        </Group>
    );
};
