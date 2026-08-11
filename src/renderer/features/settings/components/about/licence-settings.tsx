import { useTranslation } from 'react-i18next';

import packageJson from '../../../../../../package.json';

import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

/**
 * Subbox is GPL-3.0 and is conveyed to users both as a built binary and as a
 * JavaScript bundle downloaded by a browser. GPLv3 §5(a) expects the licence
 * notice, the record of modification, and a route to the corresponding source
 * to travel with the conveyed work — publishing them in the repository alone
 * never reaches anyone running the app.
 *
 * The verbatim LICENSE and NOTICE ship alongside the code (electron-builder's
 * `extraResources` for the desktop builds, scripts/vite-plugin-licence-files.ts
 * and the Dockerfile for the web build). This section is how a user finds them,
 * which is why it states the version: that is what identifies which source
 * corresponds to the binary they are running. Don't drop it when editing.
 */
const SOURCE_URL = 'https://github.com/laker-93/subbox-app';

export const LicenceSettings = () => {
    const { t } = useTranslation();

    const links = [
        {
            label: t('page.setting.licenceLinkFullText'),
            url: 'https://www.gnu.org/licenses/gpl-3.0.html',
        },
        { label: t('page.setting.licenceLinkSource'), url: SOURCE_URL },
        {
            label: t('page.setting.licenceLinkNotice'),
            url: `${SOURCE_URL}/blob/development/NOTICE`,
        },
        {
            label: t('page.setting.licenceLinkUpstream'),
            url: 'https://github.com/jeffvli/feishin',
        },
    ];

    return (
        <Stack gap="md">
            <Stack gap="xs">
                <Text isNoSelect size="md">
                    {t('page.setting.licence', { postProcess: 'sentenceCase' })}
                </Text>
                <Text isMuted size="sm">
                    {t('page.setting.licenceDescription')}
                </Text>
                <Text isMuted size="sm">
                    {t('page.setting.licenceVersion', { version: packageJson.version })}
                </Text>
                <Text isMuted size="sm">
                    {t('page.setting.licenceUpstream')}
                </Text>
            </Stack>

            <Stack gap="sm" px="md">
                {links.map(({ label, url }) => (
                    <Text
                        component="a"
                        href={url}
                        isLink
                        key={url}
                        rel="noopener noreferrer"
                        size="sm"
                        target="_blank"
                    >
                        {label}
                    </Text>
                ))}
            </Stack>
        </Stack>
    );
};
