import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import styles from './action-bar.module.css';

import { AppMenu } from '/@/renderer/features/titlebar/components/app-menu';
import { useAppMode, useAppStoreActions, useCommandPalette } from '/@/renderer/store';
import { AppMode } from '/@/renderer/store/app.store';
import { Button } from '/@/shared/components/button/button';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Grid } from '/@/shared/components/grid/grid';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { TextInput } from '/@/shared/components/text-input/text-input';

export const ActionBar = () => {
    const { t } = useTranslation();
    const { open } = useCommandPalette();
    const appMode = useAppMode();
    const { setAppMode } = useAppStoreActions();

    return (
        <div className={styles.container}>
            <Grid
                display="flex"
                gutter="sm"
                style={{ padding: '0 var(--theme-spacing-md)' }}
                w="100%"
            >
                <Grid.Col span="auto">
                    <TextInput
                        leftSection={<Icon icon="search" />}
                        onClick={open}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                open();
                            }
                        }}
                        placeholder={t('common.search', { postProcess: 'titleCase' })}
                        readOnly
                    />
                </Grid.Col>
                <Grid.Col span="content">
                    <Group gap="sm" wrap="nowrap">
                        <SegmentedControl
                            data={[
                                {
                                    label: t('page.sidebar.library', {
                                        defaultValue: 'Library',
                                        postProcess: 'titleCase',
                                    }),
                                    value: 'library',
                                },
                                {
                                    label: t('page.sidebar.sync', {
                                        defaultValue: 'Sync',
                                        postProcess: 'titleCase',
                                    }),
                                    value: 'sync',
                                },
                            ]}
                            onChange={(value) => setAppMode(value as AppMode)}
                            size="xs"
                            value={appMode}
                        />
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
                        <NavigateButtons />
                    </Group>
                </Grid.Col>
            </Grid>
        </div>
    );
};

const NavigateButtons = () => {
    const navigate = useNavigate();

    return (
        <>
            <Button onClick={() => navigate(-1)} p="0">
                <Icon icon="arrowLeftS" size="lg" />
            </Button>
            <Button onClick={() => navigate(1)} p="0">
                <Icon icon="arrowRightS" size="lg" />
            </Button>
        </>
    );
};
