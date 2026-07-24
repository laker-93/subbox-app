import { openModal } from '@mantine/modals';
import { t } from 'i18next';
import isElectron from 'is-electron';
import { memo, useCallback } from 'react';

import { ExportImportSettingsModal } from '/@/renderer/components/export-import-settings-modal/export-import-settings-modal';
import {
    SettingOption,
    SettingsSection,
} from '/@/renderer/features/settings/components/settings-section';
import { useSettingsForExport } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';

const utils = isElectron() ? window.api.utils : null;

export const ExportImportSettings = memo(() => {
    const settingForExport = useSettingsForExport();

    const onExportSettings = useCallback(() => {
        const fileName = 'subbox-settings.json';
        const json = JSON.stringify(settingForExport);

        // Electron: webContents.downloadURL() never completed for a blob: URL in
        // this app (no will-download handler was firing) -- no file appeared
        // until the whole app quit. A data: URL goes through the same,
        // already-proven main-process download path the song-download feature
        // uses (window.api.utils.download -> 'download-url' IPC ->
        // webContents.downloadURL); a will-download handler names the file since
        // a data: URL carries no filename of its own.
        if (isElectron() && utils) {
            const base64 = btoa(unescape(encodeURIComponent(json)));
            utils.download(`data:application/json;base64,${base64}`, fileName);
            return;
        }

        const settingsFile = new File([json], fileName, {
            type: 'application/json',
        });

        const settingsFileLink = document.createElement('a');
        const settingsFilesUrl = URL.createObjectURL(settingsFile);
        settingsFileLink.href = settingsFilesUrl;
        settingsFileLink.download = settingsFile.name;
        settingsFileLink.click();

        URL.revokeObjectURL(settingsFilesUrl);
    }, [settingForExport]);

    const openImportModal = () => {
        openModal({
            children: <ExportImportSettingsModal />,
            size: 'lg',
            title: t('setting.exportImportSettings_importModalTitle', {
                postProcess: 'sentenceCase',
            }),
        });
    };

    const options: SettingOption[] = [
        {
            control: (
                <>
                    <Button onClick={onExportSettings} size="compact-sm">
                        {t('setting.exportImportSettings_control_exportText', {
                            postProcess: 'sentenceCase',
                        })}
                    </Button>
                    <Button onClick={openImportModal} size="compact-sm">
                        {t('setting.exportImportSettings_control_importText', {
                            postProcess: 'sentenceCase',
                        })}
                    </Button>
                </>
            ),
            description: t('setting.exportImportSettings_control_description', {
                postProcess: 'sentenceCase',
            }),
            title: t('setting.exportImportSettings_control_title', {
                postProcess: 'sentenceCase',
            }),
        },
    ];

    return (
        <SettingsSection
            options={options}
            title={t('page.setting.exportImport', { postProcess: 'sentenceCase' })}
        />
    );
});
