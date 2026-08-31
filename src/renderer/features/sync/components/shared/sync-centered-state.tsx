import type { ReactNode } from 'react';

import { Center } from '/@/shared/components/center/center';
import { Stack } from '/@/shared/components/stack/stack';

interface SyncCenteredStateProps {
    children: ReactNode;
    /** Max width. Long prose and full file paths need the wider one. */
    maw?: number;
}

/**
 * The full-height centred column the Sync status screens are built from.
 *
 * Fifteen screens across the five flows opened with the same `<Center
 * style={{height:'100%'}}><Stack align="center">` pair, and drifted: two of them
 * had lost the height, so they sat at the top of an empty page rather than in the
 * middle of it. One place to get it right.
 *
 * Only the status screens now: spinner, done, blocked. The screens that *open* a
 * flow used to centre here too, and that was the thing that made Upload look
 * nothing like Download: a floating 420px column where every other Sync screen is
 * a titled page anchored top-left. Those are `SyncFlow`s now.
 */
export const SyncCenteredState = ({ children, maw = 400 }: SyncCenteredStateProps) => (
    <Center style={{ height: '100%' }}>
        <Stack align="center" gap="md" maw={maw}>
            {children}
        </Stack>
    </Center>
);
