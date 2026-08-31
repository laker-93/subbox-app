import type { ReactNode } from 'react';

import { SyncCenteredState } from '/@/renderer/features/sync/components/shared/sync-centered-state';
import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';
import { TextTitle } from '/@/shared/components/text-title/text-title';

interface SyncResultProps {
    /**
     * The primary button, when the flow needs one this component can't spell:
     * a different size, an anchor, two of them. Overrides `actionLabel`.
     */
    action?: ReactNode;
    /** The one thing to do next: "Start Over", "Sync Another Library", "Back". */
    actionLabel?: string;
    /** Everything between the heading and the button: counts, warnings, folder buttons. */
    children?: ReactNode;
    maw?: number;
    onAction?: () => void;
    /** Rendered above the primary button (the Copy details button on a failure). */
    secondaryAction?: ReactNode;
    /**
     * `success` and `warn` get the glyph; `none` omits it.
     *
     * A finished job that left tracks out is `warn`, not `success`; the counts
     * underneath are the only place that shortfall is ever explained, and a green
     * tick above them tells the user not to read.
     */
    status?: 'none' | 'success' | 'warn';
    title: string;
}

/** The end of a flow: what happened, in what detail it needs, and the way back. */
export const SyncResult = ({
    action,
    actionLabel,
    children,
    maw = 400,
    onAction,
    secondaryAction,
    status = 'none',
    title,
}: SyncResultProps) => (
    <SyncCenteredState maw={maw}>
        {status === 'success' && <Icon color="success" icon="success" size="3rem" />}
        {status === 'warn' && <Icon color="warn" icon="error" size="3rem" />}
        <TextTitle order={3}>{title}</TextTitle>
        {children}
        {secondaryAction}
        {action ??
            (actionLabel && (
                <Button fullWidth onClick={onAction} variant="filled">
                    {actionLabel}
                </Button>
            ))}
    </SyncCenteredState>
);
