import type { SeratoWriteResult } from '/@/renderer/features/sync/components/shared/use-serato-crates';

import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

interface SeratoWriteSummaryProps {
    onShowFolder: () => void;
    result: SeratoWriteResult;
}

/**
 * What was written into Serato, on the done screen of every flow that writes crates.
 *
 * The lines that aren't successes are the point. A renamed crate and a track that
 * wasn't on disk both change what the user finds when they open Serato, and both
 * are otherwise silent -- the crate is simply smaller than they asked for, with
 * nothing on screen having said so.
 */
export const SeratoWriteSummary = ({ onShowFolder, result }: SeratoWriteSummaryProps) => (
    // Bounded and breakable: the backup folder is a full path with no spaces in it,
    // and unconstrained it ran off both edges of the window rather than wrapping.
    <Stack align="center" gap={4} maw={620} style={{ overflowWrap: 'anywhere' }} ta="center">
        <Text size="sm">
            {`${result.cratesWritten} Serato crate${result.cratesWritten === 1 ? '' : 's'} written with ${result.tracksWritten} track${result.tracksWritten === 1 ? '' : 's'}.`}
        </Text>
        {result.cues.written > 0 && (
            <Text c="dimmed" size="xs">
                {`Cues written into ${result.cues.written} track${result.cues.written === 1 ? '' : 's'}.`}
            </Text>
        )}
        {/* Not a failure, and worth saying out loud: subbox deliberately never
            overwrites cues you already have. */}
        {result.cues.alreadyCued > 0 && (
            <Text c="dimmed" size="xs">
                {`${result.cues.alreadyCued} track${result.cues.alreadyCued === 1 ? ' already had' : 's already had'} cues in Serato and ${result.cues.alreadyCued === 1 ? 'was' : 'were'} left untouched.`}
            </Text>
        )}
        {result.beatgrid.written > 0 && (
            <Text c="dimmed" size="xs">
                {`Beat grids written into ${result.beatgrid.written} track${result.beatgrid.written === 1 ? '' : 's'}.`}
            </Text>
        )}
        {/* Same promise as the cue line above, and worth making separately: a
            track can have a grid and no cues, so one being left alone says
            nothing about the other. */}
        {result.beatgrid.alreadyGridded > 0 && (
            <Text c="dimmed" size="xs">
                {`${result.beatgrid.alreadyGridded} track${result.beatgrid.alreadyGridded === 1 ? ' already had a beat grid' : 's already had beat grids'} in Serato and ${result.beatgrid.alreadyGridded === 1 ? 'was' : 'were'} left untouched.`}
            </Text>
        )}
        {result.renamed.length > 0 && (
            <Text c="yellow" size="xs">
                {`Renamed to fit a filename: ${result.renamed
                    .map((r) => `${r.from} → ${r.to}`)
                    .join(', ')}`}
            </Text>
        )}
        {result.missing.length > 0 && (
            <Text c="yellow" size="xs">
                {`${result.missing.length} track${result.missing.length === 1 ? ' was' : 's were'} not on disk and left out of the crates.`}
            </Text>
        )}
        {result.backupFolder && (
            <Text c="dimmed" size="xs">
                {`Crates that were replaced were backed up to ${result.backupFolder}`}
            </Text>
        )}
        <Text c="dimmed" size="xs">
            Restart Serato to see them.
        </Text>
        <Button
            leftSection={<Icon icon="folder" />}
            onClick={onShowFolder}
            size="xs"
            variant="default"
        >
            Show Serato Folder
        </Button>
    </Stack>
);
