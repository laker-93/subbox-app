import { useTranslation } from 'react-i18next';

import { useDjMode } from '/@/renderer/features/dj/hooks/use-dj-mode';
import { useKeyNotation } from '/@/renderer/features/dj/hooks/use-key-notation';
import { useWaveformColors } from '/@/renderer/features/dj/hooks/use-waveform-colors';
import { WaveformColors } from '/@/renderer/features/dj/utils/draw-waveform';
import { KeyNotation } from '/@/renderer/features/dj/utils/musical-key';
import {
    SettingOption,
    SettingsSection,
} from '/@/renderer/features/settings/components/settings-section';
import { Select } from '/@/shared/components/select/select';
import { Switch } from '/@/shared/components/switch/switch';

// Subbox-only: Settings → DJ mode (subbox-app#236, design-dj-ui §5.7).
export const DjModeSettings = () => {
    const { t } = useTranslation();
    const djMode = useDjMode();
    const [keyNotation, setKeyNotation] = useKeyNotation();
    const [waveformColors, setWaveformColors] = useWaveformColors();

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
        {
            control: (
                <Select
                    data={[
                        { label: t('page.djMode.keyNotationBoth'), value: 'both' },
                        { label: t('page.djMode.keyNotationCamelot'), value: 'camelot' },
                        { label: t('page.djMode.keyNotationMusical'), value: 'musical' },
                    ]}
                    onChange={(value) => value && setKeyNotation(value as KeyNotation)}
                    value={keyNotation}
                />
            ),
            description: t('page.djMode.keyNotationDescription'),
            isHidden: !djMode.enabled,
            title: t('page.djMode.keyNotation'),
        },
        {
            control: (
                <Select
                    data={[
                        { label: t('page.djMode.waveformColorsBands'), value: 'bands' },
                        { label: t('page.djMode.waveformColorsRgb'), value: 'rgb' },
                        { label: t('page.djMode.waveformColorsBlue'), value: 'blue' },
                    ]}
                    onChange={(value) => value && setWaveformColors(value as WaveformColors)}
                    value={waveformColors}
                />
            ),
            description: t('page.djMode.waveformColorsDescription'),
            isHidden: !djMode.enabled,
            title: t('page.djMode.waveformColors'),
        },
    ];

    return <SettingsSection options={options} />;
};
