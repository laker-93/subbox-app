import { useSeratoOverwrite, useSetSeratoOverwrite } from '/@/renderer/store';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

/**
 * Whether a crate write may replace what the user's files already carry.
 *
 * Writing cues and grids into the user's own audio is timid by default: only into
 * a track that has neither. That is right for a freshly downloaded track and wrong
 * for the workflow the Rekordbox -> Serato direction exists to serve — a track the
 * DJ already has in Serato, re-gridded in Rekordbox, whose file therefore already
 * has a grid. Serato writes one anchor into everything it analyses, so in a real
 * library the guard declines about four files in five, and the only signal was a
 * line on the done screen saying they were "left untouched".
 *
 * Nothing here can tell Serato's guess from a grid the user built by hand — the
 * frame records no provenance — so the question goes to the only party who knows
 * the answer, once, rather than being guessed per track. Both persist.
 *
 * Two checkboxes rather than one because the stakes differ by an order of
 * magnitude: a replaced grid is a re-analysis, replaced cue points are last
 * night's set. Neither has an undo — the encoder replaces the whole tag — which is
 * why both say so rather than only implying it.
 */
export const SeratoOverwriteOptions = () => {
    const overwrite = useSeratoOverwrite();
    const setOverwrite = useSetSeratoOverwrite();

    return (
        <Stack gap="xs">
            <Text fw={500} size="sm">
                Existing Serato Data
            </Text>
            <Checkbox
                checked={overwrite.beatgrid}
                description="Serato writes a beat grid into every track it analyses, so without this your grids from Rekordbox reach almost nothing. Replaced grids cannot be recovered."
                label="Replace beat grids already in Serato"
                onChange={(event) => setOverwrite('beatgrid', event.currentTarget.checked)}
                size="sm"
            />
            <Checkbox
                checked={overwrite.cues}
                description="Your own hot cues and loops in these tracks are overwritten with subbox's, and cannot be recovered."
                label="Replace cues already in Serato"
                onChange={(event) => setOverwrite('cues', event.currentTarget.checked)}
                size="sm"
            />
        </Stack>
    );
};
