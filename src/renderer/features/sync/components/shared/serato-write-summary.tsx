import type { SeratoWriteResult } from '/@/renderer/features/sync/components/shared/use-serato-crates';

import { useDisclosure } from '@mantine/hooks';

import { PathText } from '/@/renderer/features/sync/components/shared/path-text';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Modal } from '/@/shared/components/modal/modal';
import { Stack } from '/@/shared/components/stack/stack';
import { Table } from '/@/shared/components/table/table';
import { Text } from '/@/shared/components/text/text';

interface SeratoWriteSummaryProps {
    onShowFolder: () => void;
    result: SeratoWriteResult;
}

/** `1 track's` / `4 tracks'` — the possessive the counted lines below need. */
const tracksPossessive = (n: number) => (n === 1 ? "1 track's" : `${n} tracks'`);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface DetailRow {
    /** Yellow, for a row that took something away or left something out. */
    attention?: boolean;
    label: string;
    /** The sentence that says what to do about it, or what it cost. */
    note?: string;
    value: string;
}

/** At most three, named: a reason list long enough to scroll is not a summary. */
const failureNote = (failed: Array<{ reason: string; trackName: string }>) =>
    failed
        .slice(0, 3)
        .map((f) => `${f.trackName}: ${f.reason}`)
        .join('; ') + (failed.length > 3 ? `; and ${failed.length - 3} more` : '');

/**
 * Every number this run produced, as the report behind the info button.
 *
 * Built here rather than in the modal's markup so the on-screen line and the table
 * can never disagree: both read the same rows. Rows with nothing to report are
 * left out entirely — a table of zeroes is the clutter this replaced.
 */
const detailRows = (result: SeratoWriteResult): DetailRow[] => {
    const { beatgrid, cues } = result;
    const rows: DetailRow[] = [
        { label: 'Crates written', value: String(result.cratesWritten) },
        { label: 'Tracks in crates', value: String(result.tracksWritten) },
    ];

    if (cues.written > 0) {
        rows.push({
            attention: cues.replaced > 0,
            label: 'Cues written',
            note:
                cues.replaced > 0
                    ? `${cues.replaced} of them replaced cues the track already had in Serato. There is no undo — the whole tag is rewritten.`
                    : undefined,
            value: String(cues.written),
        });
    }
    if (cues.alreadyCued > 0) {
        rows.push({
            label: 'Cues left untouched',
            note: 'These tracks already had cues of their own in Serato. Turn on "Replace cues already in Serato" under the cog to overwrite them.',
            value: String(cues.alreadyCued),
        });
    }
    if (beatgrid.written > 0) {
        rows.push({
            attention: beatgrid.replaced > 0,
            label: 'Beat grids written',
            note:
                beatgrid.replaced > 0
                    ? `${beatgrid.replaced} of them replaced a grid the track already had in Serato. There is no undo — the whole tag is rewritten.`
                    : undefined,
            value: String(beatgrid.written),
        });
    }
    if (beatgrid.alreadyGridded > 0) {
        rows.push({
            label: 'Beat grids left untouched',
            note: 'Serato writes a grid into every track it analyses, so this catches tracks nobody gridded by hand. Turn on "Replace beat grids already in Serato" under the cog to send yours anyway.',
            value: String(beatgrid.alreadyGridded),
        });
    }
    // One row for both: the format, not the kind of tag, is what was unsupported.
    const unsupported = Math.max(cues.unsupported, beatgrid.unsupported);
    if (unsupported > 0) {
        rows.push({
            label: 'Skipped, unsupported format',
            note: 'WAV, AIFF and M4A cannot be tagged yet. The tracks are in the crates; only their cues and grid were skipped.',
            value: String(unsupported),
        });
    }
    if (cues.failed.length > 0) {
        rows.push({
            attention: true,
            label: 'Cue writes failed',
            note: failureNote(cues.failed),
            value: String(cues.failed.length),
        });
    }
    if (beatgrid.failed.length > 0) {
        rows.push({
            attention: true,
            label: 'Beat grid writes failed',
            note: failureNote(beatgrid.failed),
            value: String(beatgrid.failed.length),
        });
    }
    if (result.renamed.length > 0) {
        rows.push({
            attention: true,
            label: 'Crates renamed',
            note: result.renamed.map((r) => `${r.from} → ${r.to}`).join(', '),
            value: String(result.renamed.length),
        });
    }
    if (result.missing.length > 0) {
        rows.push({
            attention: true,
            label: 'Tracks not on disk',
            note: 'Left out of the crates — the crate in Serato is smaller than the playlist.',
            value: String(result.missing.length),
        });
    }

    return rows;
};

/**
 * What was written into Serato, on the done screen of every flow that writes crates.
 *
 * One line of outcome, one line of anything that needs the user's attention, and
 * every remaining number behind the info button. The long form this replaced put
 * eight sentences and a backup path on a screen whose job is to say "done": the
 * detail was real, but nobody reads a wall of grey text, which is the same way the
 * writeback guard stayed invisible for so long.
 *
 * The lines that aren't successes are still the point, so they stay on the screen
 * in short form — a renamed crate, a track that wasn't on disk and a replaced grid
 * all change what the user finds when they open Serato. What moves behind the
 * button is the explanation, not the fact.
 */
export const SeratoWriteSummary = ({ onShowFolder, result }: SeratoWriteSummaryProps) => {
    const [detailsOpened, detailsHandlers] = useDisclosure(false);
    const rows = detailRows(result);
    const { beatgrid, cues } = result;

    // Things this run took away or left out. Yellow, and never behind a click.
    //
    // Cues and grids are counted separately because a file can have one without the
    // other, but the same run usually replaces both in the same tracks -- so when
    // the counts agree they share a clause rather than saying "4 tracks'" twice.
    const attention: string[] = [];
    if (cues.replaced > 0 && cues.replaced === beatgrid.replaced) {
        attention.push(`${tracksPossessive(cues.replaced)} cues and beat grids replaced`);
    } else {
        if (cues.replaced > 0) attention.push(`${tracksPossessive(cues.replaced)} cues replaced`);
        if (beatgrid.replaced > 0) {
            attention.push(
                `${tracksPossessive(beatgrid.replaced)} beat grid${beatgrid.replaced === 1 ? '' : 's'} replaced`,
            );
        }
    }
    if (result.missing.length > 0) {
        attention.push(`${plural(result.missing.length, 'track', 'tracks')} not on disk`);
    }
    if (result.renamed.length > 0) {
        attention.push(`${plural(result.renamed.length, 'crate', 'crates')} renamed`);
    }
    const failed = cues.failed.length + beatgrid.failed.length;
    if (failed > 0) attention.push(`${plural(failed, 'write', 'writes')} failed`);

    // What the guard declined. Quiet, but it keeps the pointer to the setting: a
    // count the user cannot act on is what made this invisible in the first place.
    const untouched: string[] = [];
    if (cues.alreadyCued > 0 && cues.alreadyCued === beatgrid.alreadyGridded) {
        untouched.push(`cues and beat grids in ${plural(cues.alreadyCued, 'track', 'tracks')}`);
    } else {
        if (cues.alreadyCued > 0) {
            untouched.push(`cues in ${plural(cues.alreadyCued, 'track', 'tracks')}`);
        }
        if (beatgrid.alreadyGridded > 0) {
            untouched.push(`beat grids in ${plural(beatgrid.alreadyGridded, 'track', 'tracks')}`);
        }
    }

    return (
        // Bounded and breakable: the backup folder is a full path with no spaces in
        // it, and unconstrained it ran off both edges of the window rather than
        // wrapping.
        <Stack align="center" gap={4} maw={620} style={{ overflowWrap: 'anywhere' }} ta="center">
            <Group align="center" gap="xs" justify="center" wrap="nowrap">
                <Text size="sm">
                    {`${plural(result.cratesWritten, 'Serato crate', 'Serato crates')} written with ${plural(result.tracksWritten, 'track', 'tracks')}.`}
                </Text>
                <ActionIcon
                    aria-label="Serato write details"
                    icon="info"
                    iconProps={{ size: 'sm' }}
                    onClick={detailsHandlers.open}
                    size="xs"
                    tooltip={{ label: 'What was written into Serato' }}
                    variant="subtle"
                />
            </Group>

            {attention.length > 0 && (
                <Text c="yellow" size="xs">
                    {`${attention.join(' · ')}.`}
                </Text>
            )}

            {untouched.length > 0 && (
                <Text c="dimmed" size="xs">
                    {`Left untouched: ${untouched.join(', ')} — turn replacement on under the cog.`}
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

            <Modal
                handlers={detailsHandlers}
                opened={detailsOpened}
                size="lg"
                title="Serato Write Report"
            >
                <Stack gap="md" ta="left">
                    <Table horizontalSpacing="sm" verticalSpacing="xs">
                        <Table.Tbody>
                            {rows.map((row) => (
                                <Table.Tr key={row.label}>
                                    <Table.Td>
                                        <Text size="sm">{row.label}</Text>
                                        {row.note && (
                                            <Text c="dimmed" size="xs">
                                                {row.note}
                                            </Text>
                                        )}
                                    </Table.Td>
                                    <Table.Td style={{ verticalAlign: 'top', width: '4rem' }}>
                                        <Text
                                            c={row.attention ? 'yellow' : undefined}
                                            size="sm"
                                            ta="right"
                                        >
                                            {row.value}
                                        </Text>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>

                    {result.backupFolder && (
                        <Stack gap={2}>
                            <Text size="xs">Crates that were replaced were backed up to</Text>
                            <PathText value={result.backupFolder} />
                        </Stack>
                    )}
                </Stack>
            </Modal>
        </Stack>
    );
};
