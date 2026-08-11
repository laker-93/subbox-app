import { useTranslation } from 'react-i18next';

import { Group } from '/@/shared/components/group/group';
import { Text } from '/@/shared/components/text/text';
import { LegalLinks } from '/@/shared/constants/legal-links';

/**
 * The terms, privacy notice and reporting route have to be reachable before a user
 * has an account — that is most of the point of publishing them — so they are linked
 * from the login screen as well as from Settings → About.
 */
export const LegalFooterLinks = () => {
    const { t } = useTranslation();

    const links = [
        { href: LegalLinks.terms, label: t('common.termsOfService', { postProcess: 'titleCase' }) },
        {
            href: LegalLinks.privacy,
            label: t('common.privacyNotice', { postProcess: 'titleCase' }),
        },
        {
            href: LegalLinks.noticeAndAction,
            label: t('common.reportContent', { postProcess: 'titleCase' }),
        },
    ];

    return (
        <Group gap="md" justify="center">
            {links.map((link) => (
                <Text
                    component="a"
                    href={link.href}
                    isLink
                    isMuted
                    key={link.href}
                    rel="noopener noreferrer"
                    size="xs"
                    target="_blank"
                >
                    {link.label}
                </Text>
            ))}
        </Group>
    );
};
