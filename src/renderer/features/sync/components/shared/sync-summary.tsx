import { Badge } from '/@/shared/components/badge/badge';
import { Group } from '/@/shared/components/group/group';

export interface SyncSummaryItem {
    /** Omit for the neutral badge. Colour carries meaning here: green is "nothing to do". */
    color?: string;
    label: string;
}

interface SyncSummaryProps {
    items: SyncSummaryItem[];
}

/**
 * The count row at the top of a preview.
 *
 * Kept as badges for now: this is the substrate extraction, and collapsing them to
 * one tabular-figures sentence (design-sync-ui.md §3) is a visible change that
 * belongs to the step after this one. Everything that reads these counts now goes
 * through one component, so that change lands here rather than in four files.
 */
export const SyncSummary = ({ items }: SyncSummaryProps) => (
    <Group gap="sm" wrap="wrap">
        {items.map((item) => (
            <Badge color={item.color} key={item.label} size="lg" variant="light">
                {item.label}
            </Badge>
        ))}
    </Group>
);
