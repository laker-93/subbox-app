import { useEffect, useState } from 'react';

import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

/**
 * How long an import's phase and counts can sit still before the screen says so.
 *
 * Long on purpose. Nothing moves while pymix copies the upload into staging, or
 * while the import waits behind the user's own watch-folder import, and on a large
 * library either takes minutes. Anything shorter would cry wolf on imports that are
 * fine.
 */
export const IMPORT_STALL_MS = 20 * 60 * 1000;

const TICK_MS = 30 * 1000;

interface ImportStalledProps {
    /** When the import last moved (ms since epoch), from the upload run. */
    movedAt: null | number;
}

/**
 * Said under the import's progress once nothing has moved for IMPORT_STALL_MS
 * (laker-93/subbox-app#296).
 *
 * On staging, pymix was OOM-killed mid-import and the job stayed "in progress" for
 * good, so this screen sat on 0 / 957 with nothing to say anything was wrong.
 * pymix now fails such a job when it starts again (laker-93/pymix#327), and this
 * screen then shows that job's reason with a Retry. This notice covers the gap: a
 * pymix that hasn't come back, or an older one that never fails the job. It is
 * advice, not a verdict, since a slow import looks exactly the same, so it offers
 * no retry. A retry would be refused while the job is still marked running anyway.
 */
export const ImportStalled = ({ movedAt }: ImportStalledProps) => {
    const [now, setNow] = useState(() => Date.now());
    // Its own clock: the store only re-renders this on a successful poll, and a
    // pymix that is down answers none.
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(id);
    }, []);

    if (movedAt === null || now - movedAt < IMPORT_STALL_MS) return null;
    const minutes = Math.floor((now - movedAt) / 60000);

    return (
        <Stack align="center" gap={2} maw={360}>
            <Text c="yellow" fw={600} size="sm" ta="center">
                No progress for {minutes} minutes
            </Text>
            <Text c="dimmed" size="xs" ta="center">
                A large import can stay on one step for a while, so it may still be running. If the
                server restarted, this screen will show that the import stopped and let you retry.
                You can leave this screen: the import carries on without it. If it hasn&apos;t moved
                in an hour, contact the Sub-box team.
            </Text>
        </Stack>
    );
};
