import type { ReactNode } from 'react';

import { Center } from '/@/shared/components/center/center';
import { Stack } from '/@/shared/components/stack/stack';

/**
 * Min height, in px, for the one-line-or-two intro under a Sync title.
 *
 * Two lines of `size="sm"` text. The Rekordbox and Serato intros are written to the
 * same length so they wrap the same way, and this holds the block open at two lines
 * even if a translation runs to one — without it, toggling the format could still
 * shift the control by a line.
 */
export const SYNC_INTRO_MIH = 44;

interface SyncCenteredStateProps {
    /**
     * Where the column sits vertically.
     *
     * `center` for the status screens, which are one block of content and nothing else.
     * `top` for the screens carrying the Rekordbox/Serato control: a vertically centred
     * column re-centres itself whenever the two flows differ in height, so toggling the
     * format nudged the icon, the title and the very control that was just clicked.
     * Anchored to the top they hold their place and only the content below them changes.
     */
    anchor?: 'center' | 'top';
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
export const SyncCenteredState = ({
    anchor = 'center',
    children,
    gap = 'md',
    maw = 400,
}: SyncCenteredStateProps) => (
    <Center
        style={{
            alignItems: anchor === 'top' ? 'flex-start' : undefined,
            height: '100%',
            // Anchoring to the top means a column too tall for the pane runs off the
            // bottom rather than off both ends, so it can be scrolled back into view.
            overflowY: anchor === 'top' ? 'auto' : undefined,
            // Roughly where centring used to leave these screens, but fixed: the offset
            // is measured from the top of the pane rather than from content that grows.
            paddingTop: anchor === 'top' ? 'min(10vh, 5rem)' : undefined,
        }}
    >
        <Stack align="center" gap={gap} maw={maw}>
            {children}
        </Stack>
    </Center>
);
