import { useTranslation } from 'react-i18next';

import styles from './demo-banner.module.css';

import { useIsDemoSession } from '/@/renderer/config/demo-config';
import {
    useDemoBannerDismissed,
    useInviteRequestActions,
} from '/@/renderer/features/invite/store/invite-request-store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { Text } from '/@/shared/components/text/text';

/**
 * The ask, at the moment someone is actually exploring the product.
 *
 * Renders only for the public `demo` login, so a real account never sees it. Dismissal
 * is session-scoped (see the store) — the point is to be answerable once, not to nag.
 */
export const DemoBanner = () => {
    const { t } = useTranslation();
    const isDemo = useIsDemoSession();
    const dismissed = useDemoBannerDismissed();
    const { dismissDemoBanner, openInviteRequest } = useInviteRequestActions();

    if (!isDemo || dismissed) return null;

    return (
        <div className={styles['fs-demo-banner']}>
            <Text className={styles['fs-demo-banner-text']} size="sm">
                {t('page.demoBanner.message', {
                    defaultValue:
                        "You're exploring a sample library. Sub-box is in private beta — get an invite to upload your own.",
                })}
            </Text>
            <Button
                onClick={() => openInviteRequest('demoBanner')}
                size="compact-sm"
                variant="filled"
            >
                {t('page.invite.cta', {
                    defaultValue: 'Request an invite',
                    postProcess: 'sentenceCase',
                })}
            </Button>
            <ActionIcon
                aria-label={t('common.dismiss', {
                    defaultValue: 'Dismiss',
                    postProcess: 'sentenceCase',
                })}
                icon="x"
                onClick={dismissDemoBanner}
                size="sm"
                variant="subtle"
            />
        </div>
    );
};
