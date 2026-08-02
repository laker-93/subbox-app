import { useTranslation } from 'react-i18next';

import { useInviteRequestActions } from '/@/renderer/features/invite/store/invite-request-store';
import { Button } from '/@/shared/components/button/button';
import { Center } from '/@/shared/components/center/center';
import { Icon } from '/@/shared/components/icon/icon';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';

interface InviteLockedPanelProps {
    /** What the user was trying to do, so the panel names it rather than talking in general terms. */
    description?: string;
    title?: string;
}

/**
 * The "locked, not broken" state for anything the demo account can't do.
 *
 * A demo user who tries to upload their library is exactly the person we want as a beta
 * tester, so this must never read as a failure. It states why the action is unavailable
 * and offers the invite in the same breath — a padlock and an ask, not an error.
 */
export const InviteLockedPanel = ({ description, title }: InviteLockedPanelProps) => {
    const { t } = useTranslation();
    const { openInviteRequest } = useInviteRequestActions();

    return (
        <Center style={{ height: '100%' }}>
            <Stack align="center" gap="md" maw={400} p="md">
                <Icon icon="lock" size="3rem" />
                <TextTitle order={3} ta="center">
                    {title ??
                        t('page.invite.lockedTitle', {
                            defaultValue: 'Available with your own library',
                            postProcess: 'sentenceCase',
                        })}
                </TextTitle>
                <Text c="dimmed" size="sm" ta="center">
                    {description ??
                        t('page.invite.lockedDescription', {
                            defaultValue:
                                "You're signed in to the shared demo library, which is read-only. Your own Subbox library gives you uploads, imports and sync.",
                        })}
                </Text>
                <Text c="dimmed" size="sm" ta="center">
                    {t('page.invite.lockedBeta', {
                        defaultValue:
                            'Subbox is in private beta — request an invite and we’ll get you set up.',
                    })}
                </Text>
                <Button
                    fullWidth
                    onClick={() => openInviteRequest('blockedAction')}
                    variant="filled"
                >
                    {t('page.invite.cta', {
                        defaultValue: 'Request an invite',
                        postProcess: 'sentenceCase',
                    })}
                </Button>
            </Stack>
        </Center>
    );
};
