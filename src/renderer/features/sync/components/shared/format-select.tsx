import isElectron from 'is-electron';

import { type LibraryFormat } from '/@/renderer/store';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

interface FormatSelectProps {
    /** A line under the control saying what this choice means on this screen. */
    description?: string;
    onChange: (format: LibraryFormat) => void;
    value: LibraryFormat;
}

/**
 * Rekordbox or Serato, in the same slot on every screen that has a format.
 *
 * Going in it picks the source, coming out it picks the output — but the user
 * never has to know that. What they get is one control, always in the same
 * place, holding whatever they chose last.
 *
 * A `SegmentedControl` rather than a stack of radios: Mantine renders it from
 * real `<input type="radio">`s, so it is a radio group to a screen reader and to
 * a test, and a two-option mode switch to everyone else. It is also the shared
 * component that already exists, which is worth more than matching the design
 * sketch's dot-and-label drawing.
 */
export const FormatSelect = ({ description, onChange, value }: FormatSelectProps) => {
    // Serato means reading and writing crate files on this machine, which a
    // browser can neither reach nor be told about. Disabled with the reason
    // attached, rather than absent: a Serato DJ on the web player should find out
    // that the desktop app does this, not that subbox doesn't.
    const seratoUnavailable = !isElectron();

    return (
        <Stack gap={4}>
            <SegmentedControl
                data={[
                    { label: 'Rekordbox', value: 'rekordbox' },
                    { disabled: seratoUnavailable, label: 'Serato', value: 'serato' },
                ]}
                onChange={(next) => onChange(next as LibraryFormat)}
                value={value}
                w="fit-content"
            />
            {seratoUnavailable ? (
                <Text c="dimmed" size="xs">
                    Serato crates are written to this computer, so they need the desktop app.
                </Text>
            ) : (
                description && (
                    <Text c="dimmed" size="xs">
                        {description}
                    </Text>
                )
            )}
        </Stack>
    );
};
