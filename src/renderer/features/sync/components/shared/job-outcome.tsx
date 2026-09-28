import {
    describeJobWork,
    type ImportProgress,
} from '/@/renderer/features/sync/components/shared/job-envelope';
import { ReimportUndo } from '/@/renderer/features/trash/components/reimport-undo';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

interface JobOutcomeProps {
    progress?: ImportProgress | null;
    /** Where the import came from, for its Undo: "3 playlists updated from Rekordbox". */
    source?: 'Rekordbox' | 'Serato';
}

/**
 * The server's own account of a finished job: what it did, and what it couldn't.
 *
 * Every screen that polls a job renders this, so a new phase or a new kind of
 * shortfall costs one server change rather than an edit to each screen. The
 * failure text stays with the screens: what to *do* about a failed import differs
 * per flow, and that judgement is not this component's to make.
 */
export const JobOutcome = ({ progress, source }: JobOutcomeProps) => {
    const work = describeJobWork(progress);
    const undoBatch = source ? progress?.trash_batch_id : null;
    if (work.length === 0 && !progress?.warnings && !undoBatch) return null;

    return (
        <Stack align="center" gap={2}>
            {work.map((line) => (
                <Text key={line} size="sm" ta="center">
                    {line}
                </Text>
            ))}
            {/* A job can succeed and still not have done everything asked of it.
                Nothing else on these screens would show that. */}
            {progress?.warnings && (
                <Text c="dimmed" size="sm" ta="center">
                    {progress.warnings}
                </Text>
            )}
            {/* A re-import that replaced playlists can be undone (#151). */}
            {undoBatch && source && <ReimportUndo batchId={undoBatch} source={source} />}
        </Stack>
    );
};
