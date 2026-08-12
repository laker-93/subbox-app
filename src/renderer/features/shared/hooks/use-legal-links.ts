import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { urlConfig } from '/@/renderer/config/url-config';

export interface LegalLink {
    href: string;
    label: string;
}

/**
 * The same three links are surfaced on the landing page, in the auth modal and in
 * Settings → About. One list keeps the set — and its order — identical everywhere,
 * so a fourth page can't quietly drop the reporting route.
 *
 * The pages themselves are static HTML rather than app routes: a rightsholder or
 * regulator has to be able to read them without an account. `urlConfig.legal` resolves
 * to the origin actually serving them (see its own note on the Electron exception).
 */
export const useLegalLinks = (): LegalLink[] => {
    const { t } = useTranslation();

    return useMemo(
        () => [
            {
                href: `${urlConfig.legal}/terms.html`,
                label: t('common.termsOfService', { postProcess: 'titleCase' }),
            },
            {
                href: `${urlConfig.legal}/privacy.html`,
                label: t('common.privacyNotice', { postProcess: 'titleCase' }),
            },
            {
                href: `${urlConfig.legal}/notice-and-action.html`,
                label: t('common.reportContent', { postProcess: 'titleCase' }),
            },
        ],
        [t],
    );
};
