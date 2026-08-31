import type { ReactNode } from 'react';

import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

interface TrackRowProps {
    album?: null | string;
    artist: string;
    /** The right-hand side: a status badge, a duration and size, a reason. */
    detail?: ReactNode;
    title: string;
}

/**
 * One track in a review list.
 *
 * Every list in Sync (missing, already present, metadata updates, conflicts)
 * is this row with something different on the right. Six handwritten copies had
 * already drifted on whether the album is shown at all.
 */
export const TrackRow = ({ album, artist, detail, title }: TrackRowProps) => (
    <Group
        gap="md"
        style={{
            borderRadius: 'var(--theme-radius-sm)',
            padding: 'var(--theme-spacing-xs) var(--theme-spacing-sm)',
        }}
    >
        <Stack gap={2} style={{ flex: 1 }}>
            <Text fw={500} size="sm">
                {title}
            </Text>
            <Text c="dimmed" size="xs">
                {artist}
                {album ? ` · ${album}` : ''}
            </Text>
        </Stack>
        {detail}
    </Group>
);
