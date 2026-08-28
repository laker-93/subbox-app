import { Text } from '/@/shared/components/text/text';

interface PathTextProps {
    /** Shown when there is no path yet — say what choosing one would do, not "none". */
    placeholder?: string;
    value: null | string | undefined;
}

/**
 * A filesystem path, in the one style Sync shows them in.
 *
 * Monospace because these are paths the user compares against what they see in
 * Finder, and `overflowWrap: anywhere` because a long path with no spaces in it
 * otherwise runs off both edges of the window instead of wrapping.
 */
export const PathText = ({ placeholder, value }: PathTextProps) => (
    <Text c="dimmed" size="xs" style={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
        {value ?? placeholder ?? ''}
    </Text>
);
