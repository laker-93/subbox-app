import { openModal } from '@mantine/modals';
import isElectron from 'is-electron';
import { Fragment, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { HelpModalContent } from '/@/renderer/features/help/components/help-modal-content';
import { openSettingsModal } from '/@/renderer/features/settings/utils/open-settings-modal';
import {
    useAppStore,
    useAppStoreActions,
    useAuthStoreActions,
    useCommandPalette,
    useCurrentServer,
    useGeneralSettings,
    useSettingsStoreActions,
} from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { DropdownMenu, MenuItemProps } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';

const browser = isElectron() ? window.api.browser : null;

interface BaseMenuItem {
    id: string;
    type: 'conditional-group' | 'conditional-item' | 'custom' | 'divider' | 'item';
}

interface ConditionalGroupItem extends BaseMenuItem {
    condition: boolean;
    items: MenuItem[];
    type: 'conditional-group';
}

interface ConditionalItem extends BaseMenuItem {
    condition: boolean;
    item: Omit<MenuItem, 'id' | 'type'>;
    type: 'conditional-item';
}

interface CustomItem extends BaseMenuItem {
    component: ReactNode;
    type: 'custom';
}

interface DividerItem extends BaseMenuItem {
    type: 'divider';
}

type MenuItem = ConditionalGroupItem | ConditionalItem | CustomItem | DividerItem | RegularMenuItem;

interface RegularMenuItem extends BaseMenuItem {
    component?: 'a' | typeof Link;
    href?: string;
    icon?: keyof typeof import('/@/shared/components/icon/icon').AppIcon;
    iconColor?:
        | 'contrast'
        | 'default'
        | 'error'
        | 'info'
        | 'inherit'
        | 'muted'
        | 'primary'
        | 'success'
        | 'warn';
    label: string;
    leftSection?: ReactNode;
    onClick?: () => void;
    rightSection?: ReactNode;
    target?: string;
    to?: string;
    type: 'item';
}

export const AppMenu = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const collapsed = useAppStore((state) => state.sidebar.collapsed);
    const { setSideBar } = useAppStoreActions();
    const { setSettings } = useSettingsStoreActions();
    const settings = useGeneralSettings();
    const { open: openCommandPalette } = useCommandPalette();
    const currentServer = useCurrentServer();
    const { deleteServer, setCurrentServer } = useAuthStoreActions();

    const handleBrowserDevTools = () => {
        browser?.devtools();
    };

    const handleCollapseSidebar = () => {
        setSideBar({ collapsed: true });
    };

    const handleExpandSidebar = () => {
        setSideBar({ collapsed: false });
    };

    const handleLogOff = () => {
        if (currentServer) {
            deleteServer(currentServer.id);
            setCurrentServer(null);
        }
    };

    const handleQuit = () => {
        browser?.quit();
    };

    const handleHelpModal = () => {
        openModal({
            children: <HelpModalContent />,
            title: t('page.appMenu.help', { postProcess: 'sentenceCase' }),
        });
    };

    const handleSetSideQueueLayout = (sideQueueLayout: 'horizontal' | 'vertical') => {
        setSettings({
            general: {
                ...settings,
                sideQueueLayout,
            },
        });
    };

    const menuConfig: MenuItem[] = [
        {
            icon: 'search',
            id: 'command-palette',
            label: t('page.appMenu.commandPalette', { postProcess: 'sentenceCase' }),
            onClick: openCommandPalette,
            type: 'item',
        },
        {
            id: 'divider-1',
            type: 'divider',
        },
        {
            condition: collapsed,
            id: 'navigation-group',
            items: [
                {
                    icon: 'arrowLeftS',
                    id: 'go-back',
                    label: t('page.appMenu.goBack', { postProcess: 'sentenceCase' }),
                    onClick: () => navigate(-1),
                    type: 'item',
                },
                {
                    icon: 'arrowRightS',
                    id: 'go-forward',
                    label: t('page.appMenu.goForward', { postProcess: 'sentenceCase' }),
                    onClick: () => navigate(1),
                    type: 'item',
                },
            ],
            type: 'conditional-group',
        },
        {
            condition: collapsed,
            id: 'sidebar-expand',
            item: {
                icon: 'panelRightOpen',
                id: 'expand-sidebar',
                label: t('page.appMenu.expandSidebar', { postProcess: 'sentenceCase' }),
                onClick: handleExpandSidebar,
                type: 'item',
            },
            type: 'conditional-item',
        },
        {
            condition: !collapsed,
            id: 'sidebar-collapse',
            item: {
                icon: 'panelRightClose',
                id: 'collapse-sidebar',
                label: t('page.appMenu.collapseSidebar', { postProcess: 'sentenceCase' }),
                onClick: handleCollapseSidebar,
                type: 'item',
            },
            type: 'conditional-item',
        },
        {
            id: 'divider-2',
            type: 'divider',
        },
        {
            icon: 'signOut',
            id: 'log-off',
            label: t('page.appMenu.logOff', { postProcess: 'sentenceCase' }),
            onClick: handleLogOff,
            type: 'item',
        },
        {
            id: 'divider-3',
            type: 'divider',
        },
        {
            icon: 'settings',
            id: 'settings',
            label: t('page.appMenu.settings', { postProcess: 'sentenceCase' }),
            onClick: () => openSettingsModal(),
            type: 'item',
        },
        {
            icon: 'info',
            id: 'help',
            label: t('page.appMenu.help', { postProcess: 'sentenceCase' }),
            onClick: handleHelpModal,
            type: 'item',
        },
        {
            id: 'divider-4',
            type: 'divider',
        },
        {
            condition: isElectron(),
            id: 'devtools',
            item: {
                icon: 'appWindow',
                id: 'open-devtools',
                label: t('page.appMenu.openBrowserDevtools', { postProcess: 'sentenceCase' }),
                onClick: handleBrowserDevTools,
                type: 'item',
            },
            type: 'conditional-item',
        },
        {
            condition: isElectron(),
            id: 'quit',
            item: {
                icon: 'x',
                id: 'quit-app',
                label: t('page.appMenu.quit', { postProcess: 'sentenceCase' }),
                onClick: handleQuit,
                type: 'item',
            },
            type: 'conditional-item',
        },
        {
            id: 'divider-5',
            type: 'divider',
        },
        {
            condition: settings.sideQueueType === 'sideQueue',
            id: 'layout-toggle-group',
            items: [
                {
                    component: (
                        <Group gap="xs" grow pb="xs" pt="sm" px="xs" w="100%">
                            <ActionIcon
                                icon="layoutPanelRight"
                                iconProps={{
                                    size: 'xl',
                                }}
                                onClick={() => handleSetSideQueueLayout('horizontal')}
                                tooltip={{
                                    label: t('setting.sidePlayQueueLayout', {
                                        context: 'optionHorizontal',
                                        postProcess: 'sentenceCase',
                                    }),
                                    openDelay: 0,
                                    position: 'bottom',
                                }}
                                variant={
                                    settings.sideQueueLayout === 'horizontal'
                                        ? 'default'
                                        : 'transparent'
                                }
                            />
                            <ActionIcon
                                icon="layoutPanelBottom"
                                iconProps={{
                                    size: 'xl',
                                }}
                                onClick={() => handleSetSideQueueLayout('vertical')}
                                tooltip={{
                                    label: t('setting.sidePlayQueueLayout', {
                                        context: 'optionVertical',
                                        postProcess: 'sentenceCase',
                                    }),
                                    openDelay: 0,
                                    position: 'bottom',
                                }}
                                variant={
                                    settings.sideQueueLayout === 'vertical'
                                        ? 'default'
                                        : 'transparent'
                                }
                            />
                        </Group>
                    ),
                    id: 'layout-toggle',
                    type: 'custom',
                },
            ],
            type: 'conditional-group',
        },
    ];

    const renderMenuItem = (item: MenuItem): ReactNode => {
        switch (item.type) {
            case 'conditional-group':
                if (!item.condition) return null;
                return (
                    <div key={item.id}>
                        {item.items.map((subItem) => {
                            return <Fragment key={subItem.id}>{renderMenuItem(subItem)}</Fragment>;
                        })}
                    </div>
                );

            case 'conditional-item':
                if (!item.condition) return null;
                return <Fragment key={item.id}>{renderMenuItem(item.item as MenuItem)}</Fragment>;

            case 'custom':
                return <div key={item.id}>{item.component}</div>;

            case 'divider':
                return <DropdownMenu.Divider key={item.id} />;

            case 'item': {
                const leftSection =
                    item.leftSection ||
                    (item.icon && <Icon color={item.iconColor} icon={item.icon} />);

                const props = {
                    leftSection,
                    ...(item.rightSection && { rightSection: item.rightSection }),
                    ...(item.onClick && { onClick: item.onClick }),
                    ...(item.component && { component: item.component }),
                    ...(item.to && { to: item.to }),
                    ...(item.href && { href: item.href }),
                    ...(item.target && { target: item.target }),
                } as MenuItemProps;

                return (
                    <DropdownMenu.Item key={item.id} {...props}>
                        {item.label}
                    </DropdownMenu.Item>
                );
            }

            default:
                return null;
        }
    };

    return <>{menuConfig.map((item) => renderMenuItem(item))}</>;
};
