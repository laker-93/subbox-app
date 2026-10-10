import { useTranslation } from 'react-i18next';

import { useDjMode } from '/@/renderer/features/dj/hooks/use-dj-mode';
import {
    SettingOption,
    SettingsSection,
} from '/@/renderer/features/settings/components/settings-section';
import { Switch } from '/@/shared/components/switch/switch';

// Subbox-only: Settings → DJ mode (subbox-app#236, design-dj-ui §5.7).
export const DjModeSettings = () => {
    const { t } = useTranslation();
    const djMode = useDjMode();

    const options: SettingOption[] = [
        {
            control: (
                <Switch
                    aria-label="Toggle DJ mode"
                    checked={djMode.enabled}
                    disabled={djMode.isLoading}
                    onChange={(e) => djMode.setEnabled(e.currentTarget.checked)}
                />
            ),
            description: t('page.djMode.description'),
            title: t('page.djMode.title'),
        },
    ];

    return <SettingsSection options={options} />;
};
