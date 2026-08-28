import type { ReactNode } from 'react';

import { PathText } from '/@/renderer/features/sync/components/shared/path-text';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';

interface DestinationPathProps {
    /** Shown in place of the path when nothing is chosen and there is no default. */
    emptyLabel?: string;
    /** Extra controls beside the chooser — the Reset to default button. */
    extra?: ReactNode;
    /** What is being chosen, as it reads inside the button: "XML Folder". */
    label: string;
    onChoose: () => void;
    /** The chosen path, or the default that applies until one is chosen. */
    path: null | string;
    tooltip?: string;
}

/**
 * "Where this goes": one button and the resulting path, in the same shape wherever
 * Sync writes to disk.
 *
 * The path is always rendered, never only on hover or in the button. It is the one
 * thing that decides whether the user finds the file afterwards, and every variant
 * of this control that hid it produced a support question.
 */
export const DestinationPath = ({
    emptyLabel,
    extra,
    label,
    onChoose,
    path,
    tooltip,
}: DestinationPathProps) => (
    <Stack gap={4}>
        <Group gap="sm">
            <Button
                onClick={onChoose}
                size="xs"
                tooltip={
                    tooltip
                        ? { label: tooltip, multiline: true, openDelay: 300, w: 300 }
                        : undefined
                }
                variant="subtle"
            >
                {path ? `Change ${label}` : `Choose ${label}`}
            </Button>
            {extra}
        </Group>
        <PathText placeholder={emptyLabel} value={path} />
    </Stack>
);
