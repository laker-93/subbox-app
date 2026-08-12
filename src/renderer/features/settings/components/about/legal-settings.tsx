import { useTranslation } from 'react-i18next';

import { useLegalLinks } from '/@/renderer/features/shared/hooks/use-legal-links';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

/**
 * Links out to the hosted legal pages (static HTML in src/renderer/public/legal/).
 * They are deliberately not in-app routes — a rightsholder or regulator has to be
 * able to read them without an account, and the desktop build has no origin of its
 * own to serve them from.
 */
export const LegalSettings = () => {
    const { t } = useTranslation();
    const links = useLegalLinks();

    return (
        <Stack gap="md">
            <Stack gap="xs">
                <Text isNoSelect size="md">
                    {t('page.setting.legal', { postProcess: 'sentenceCase' })}
                </Text>
                <Text isMuted size="sm">
                    {t('page.setting.legalDescription')}
                </Text>
            </Stack>

            <Group gap="lg" px="md">
                {links.map((link) => (
                    <Text
                        component="a"
                        href={link.href}
                        isLink
                        key={link.href}
                        rel="noopener noreferrer"
                        size="sm"
                        target="_blank"
                    >
                        {link.label}
                    </Text>
                ))}
            </Group>
        </Stack>
    );
};
