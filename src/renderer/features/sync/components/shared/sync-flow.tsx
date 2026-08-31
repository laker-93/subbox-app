import type { ReactNode } from 'react';

import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';

interface SyncFlowProps {
    children: ReactNode;
    /**
     * The last error, shown under the header rather than as a toast: these are
     * states the screen is still sitting in, not events that have passed.
     */
    error?: null | string;
    /** The full-width primary button at the bottom, outside the scrolling area. */
    footer?: ReactNode;
    /** Extra controls in the header, left of Back (the info button on Download). */
    headerAction?: ReactNode;
    /** Back, or whatever this step's way out is. Omitted on the first step. */
    onBack?: () => void;
    /**
     * `hidden` for a screen whose own list scrolls, `auto` to let the whole screen
     * scroll. Getting this wrong costs the footer button: under `hidden` a list
     * with no scroll container of its own pushes it off the bottom.
     */
    overflow?: 'auto' | 'hidden';
    /** A line under the title: the folder being read, or what this step is for. */
    subtitle?: ReactNode;
    title: string;
}

/**
 * Eats the space between a short screen's content and its footer.
 *
 * A list-shaped step fills the pane on its own, so the footer button lands at the
 * bottom. The screens that open a flow are two lines and a control, and without
 * this their button floats halfway up the page: the one thing that made them read
 * as a different kind of screen from the ones they lead to.
 */
export const SyncFlowFill = () => <div style={{ flex: 1 }} />;

/** The framing every list-shaped Sync step shares: header, Back, error slot, footer. */
export const SyncFlow = ({
    children,
    error,
    footer,
    headerAction,
    onBack,
    overflow = 'hidden',
    subtitle,
    title,
}: SyncFlowProps) => (
    <Stack gap="md" p="xl" style={{ height: '100%', overflow }}>
        <Group justify="space-between">
            <Group gap="xs">
                <TextTitle order={3}>{title}</TextTitle>
                {headerAction}
            </Group>
            {onBack && (
                <Button onClick={onBack} size="sm" variant="subtle">
                    Back
                </Button>
            )}
        </Group>

        {subtitle}

        {error && (
            <Text c="red" size="sm">
                {error}
            </Text>
        )}

        {children}

        {footer}
    </Stack>
);
