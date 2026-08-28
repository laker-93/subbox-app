import type { ReactNode } from 'react';

import { Center } from '/@/shared/components/center/center';
import { Stack } from '/@/shared/components/stack/stack';

interface SyncCenteredStateProps {
    children: ReactNode;
    /**
     * Stack gap. `md` for the status screens (spinner, done, blocked); `lg` for the
     * screens that open a flow, which are mostly prose and need the air.
     */
    gap?: 'lg' | 'md';
    /** Max width. Long prose and full file paths need the wider one. */
    maw?: number;
}

/**
 * The full-height centred column every non-list Sync screen is built from.
 *
 * Fifteen screens across the five flows opened with the same `<Center
 * style={{height:'100%'}}><Stack align="center">` pair, and drifted: two of them
 * had lost the height, so they sat at the top of an empty page rather than in the
 * middle of it. One place to get it right.
 */
export const SyncCenteredState = ({ children, gap = 'md', maw = 400 }: SyncCenteredStateProps) => (
    <Center style={{ height: '100%' }}>
        <Stack align="center" gap={gap} maw={maw}>
            {children}
        </Stack>
    </Center>
);
