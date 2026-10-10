import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDjMode } from '/@/renderer/features/dj/hooks/use-dj-mode';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Paper } from '/@/shared/components/paper/paper';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

// Subbox-only: DJ mode is offered, never switched on for the user (subbox-app#236,
// design-dj-ui §5.7), and offered once: `dj_mode_offered` is set as soon as an offer
// shows, and neither offer shows again after that.

/** Only once the settings have answered, so someone already on is never offered it. */
const useOfferOnce = () => {
    const djMode = useDjMode();
    const eligible = !djMode.isLoading && !djMode.enabled && !djMode.offered;
    const [shown, setShown] = useState(false);
    const { setOffered } = djMode;

    useEffect(() => {
        if (eligible && !shown) {
            setShown(true);
            setOffered();
        }
    }, [eligible, setOffered, shown]);

    return { djMode, shown };
};

/** On the done screen of a Rekordbox or Serato import. */
export const DjModeImportOffer = () => {
    const { t } = useTranslation();
    const { djMode, shown } = useOfferOnce();
    if (!shown) return null;

    return (
        <Paper p="md" w="100%" withBorder>
            <Stack align="center" gap="xs">
                <Text size="sm" ta="center">
                    {djMode.enabled ? t('page.djMode.turnedOn') : t('page.djMode.importOffer')}
                </Text>
                {!djMode.enabled && (
                    <Button onClick={() => djMode.setEnabled(true)} size="xs" variant="default">
                        {t('page.djMode.turnOn')}
                    </Button>
                )}
            </Stack>
        </Paper>
    );
};

/**
 * Above the Sync tabs. Unlike the import offer it stays until it's answered (or the
 * import offer has been made), because Sync is the page every new user opens before
 * anything has been imported.
 */
export const DjModeSyncHint = () => {
    const { t } = useTranslation();
    const djMode = useDjMode();
    if (djMode.isLoading || djMode.enabled || djMode.offered) return null;

    return (
        <Group
            gap="sm"
            justify="space-between"
            px="sm"
            py="xs"
            style={{ borderBottom: '1px solid var(--theme-border-color)' }}
            wrap="nowrap"
        >
            <Text isMuted size="sm">
                {t('page.djMode.syncHint')}
            </Text>
            <Group gap="xs" wrap="nowrap">
                <Button onClick={() => djMode.setEnabled(true)} size="compact-sm" variant="default">
                    {t('page.djMode.turnOn')}
                </Button>
                <ActionIcon
                    aria-label={t('common.dismiss', { postProcess: 'sentenceCase' })}
                    icon="x"
                    iconProps={{ size: 'sm' }}
                    onClick={djMode.setOffered}
                    size="sm"
                    variant="subtle"
                />
            </Group>
        </Group>
    );
};
