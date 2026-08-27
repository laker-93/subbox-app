import { useTranslation } from 'react-i18next';

import styles from './mode-toggle.module.css';

import { AppMenu } from '/@/renderer/features/titlebar/components/app-menu';
import { useAppMode, useAppStoreActions } from '/@/renderer/store';
import { AppMode } from '/@/renderer/store/app.store';
import { Button } from '/@/shared/components/button/button';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Icon } from '/@/shared/components/icon/icon';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';

interface ModeToggleProps {
    withAppMenu?: boolean;
}

export const ModeToggle = ({ withAppMenu = true }: ModeToggleProps) => {
    const { t } = useTranslation();
    const appMode = useAppMode();
    const { setAppMode } = useAppStoreActions();

    return (
        <div className={styles.modeToggleBar}>
            {withAppMenu && appMode === 'sync' && (
                <DropdownMenu position="bottom-start">
                    <DropdownMenu.Target>
                        <Button p="0">
                            <Icon icon="menu" size="lg" />
                        </Button>
                    </DropdownMenu.Target>
                    <DropdownMenu.Dropdown>
                        <AppMenu />
                    </DropdownMenu.Dropdown>
                </DropdownMenu>
            )}
            <SegmentedControl
                data={[
                    {
                        label: (
                            <Tooltip
                                label={t('page.modeToggle.libraryTooltip', {
                                    defaultValue:
                                        'Browse and play the music already in your Sub-box library.',
                                })}
                                multiline
                                openDelay={300}
                                w={260}
                            >
                                <span>
                                    {t('page.sidebar.library', {
                                        defaultValue: 'Library',
                                        postProcess: 'titleCase',
                                    })}
                                </span>
                            </Tooltip>
                        ),
                        value: 'library',
                    },
                    {
                        label: (
                            <Tooltip
                                label={t('page.modeToggle.syncTooltip', {
                                    defaultValue:
                                        'Move music between your DJ software and Sub-box. Upload tracks from Rekordbox or Serato, or download playlists back out as a Rekordbox XML or Serato crates.',
                                })}
                                multiline
                                openDelay={300}
                                w={260}
                            >
                                <span>
                                    {t('page.sidebar.sync', {
                                        defaultValue: 'Sync',
                                        postProcess: 'titleCase',
                                    })}
                                </span>
                            </Tooltip>
                        ),
                        value: 'sync',
                    },
                ]}
                onChange={(value) => setAppMode(value as AppMode)}
                size="xs"
                value={appMode}
            />
        </div>
    );
};
