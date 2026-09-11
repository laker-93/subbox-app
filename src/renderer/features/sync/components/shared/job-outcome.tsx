import {
    describeJobWork,
    type ImportProgress,
} from '/@/renderer/features/sync/components/shared/job-envelope';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

interface JobOutcomeProps {
    progress?: ImportProgress | null;
}

/**
 * The server's own account of a finished job: what it did, and what it couldn't.
 *
 * Every screen that polls a job renders this, so a new phase or a new kind of
 * shortfall costs one server change rather than an edit to each screen. The
 * failure text stays with the screens: what to *do* about a failed import differs
 * per flow, and that judgement is not this component's to make.
 */
export const JobOutcome = ({ progress }: JobOutcomeProps) => {
    const work = describeJobWork(progress);
    if (work.length === 0 && !progress?.warnings) return null;

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
        </Stack>
    );
};
