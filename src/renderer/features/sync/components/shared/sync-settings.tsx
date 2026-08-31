import type { ReactNode } from 'react';

import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Modal } from '/@/shared/components/modal/modal';
import { Stack } from '/@/shared/components/stack/stack';

interface Handlers {
    close: () => void;
    open: () => void;
    toggle: () => void;
}

interface SyncSettingsButtonProps {
    onClick: () => void;
}

/**
 * The cog beside a Sync screen's title.
 *
 * Everything a screen can be told to do differently lives behind this, so the
 * screen itself is the plan and one button. The controls were on the screen
 * before, each with a label and a line of prose under it, and between them they
 * pushed the thing the user came for (the track list) off the fold.
 */
export const SyncSettingsButton = ({ onClick }: SyncSettingsButtonProps) => (
    <ActionIcon
        // The tooltip is not an accessible name -- it renders in a portal and is
        // never wired to the button. Without this the cog is an unnamed button to a
        // screen reader and unaddressable to a test.
        aria-label="Settings"
        icon="settings2"
        iconProps={{ size: 'md' }}
        onClick={onClick}
        size="sm"
        tooltip={{ label: 'Settings' }}
        variant="subtle"
    />
);

interface SyncSettingsModalProps {
    children: ReactNode;
    handlers: Handlers;
    opened: boolean;
    title?: string;
}

/**
 * Where those controls went. A plain modal with a column inside it: the room the
 * screen didn't have, so a folder chooser can show its path and an option can say
 * what it means without either of them costing the main screen a line.
 */
export const SyncSettingsModal = ({
    children,
    handlers,
    opened,
    title = 'Settings',
}: SyncSettingsModalProps) => (
    <Modal handlers={handlers} opened={opened} size="md" title={title}>
        <Stack gap="lg">{children}</Stack>
    </Modal>
);
