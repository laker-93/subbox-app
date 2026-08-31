import type { ReactNode } from 'react';

import { Button } from '/@/shared/components/button/button';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Group } from '/@/shared/components/group/group';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

export interface SelectableItem {
    /** Trailing right-aligned text: a track count, a size. */
    detail?: ReactNode;
    id: string;
    label: string;
    /** Dimmed text before the label, for a crate's parent path. */
    prefix?: string;
}

interface SelectableListProps {
    items: SelectableItem[];
    onSelectAll: () => void;
    onSelectNone: () => void;
    onToggle: (id: string) => void;
    /**
     * Controls that apply to the whole selection, between the toolbar and the rows.
     * They sit here rather than in a row because a row's checkbox is `readOnly`:
     * anything with a label of its own has to stay out of the click target.
     */
    options?: ReactNode;
    /**
     * A control above the list has claimed the whole set: External Drive's "All
     * server tracks". Every row reads as ticked and stops responding, because the
     * per-row selection no longer decides anything.
     */
    overriddenAll?: boolean;
    /**
     * `area` uses the app's overlay scrollbar, `native` the plain one. Both exist
     * in Sync today and this preserves each screen's own; there is no behavioural
     * reason to prefer one, so it is not worth a visible change to unify them here.
     */
    scroll?: 'area' | 'native';
    selected: Set<string>;
    /** Replaces Select all · Select none, for a screen with more modes than two. */
    toolbar?: ReactNode;
}

interface SelectionToolbarProps {
    onSelectAll: () => void;
    onSelectNone: () => void;
}

/** Select all · Select none, on its own for the screens that put other controls beside it. */
export const SelectionToolbar = ({ onSelectAll, onSelectNone }: SelectionToolbarProps) => (
    <>
        <Button onClick={onSelectAll} size="xs" variant="subtle">
            Select all
        </Button>
        <Button onClick={onSelectNone} size="xs" variant="subtle">
            Select none
        </Button>
    </>
);

/**
 * The playlist / crate picker, rows and toolbar.
 *
 * The whole row is the hit target, so the Checkbox inside it is `readOnly` and the
 * row owns the change. That is only safe because there is no `<label>` here: a
 * labelled checkbox inside a clickable wrapper fires twice (once for the label,
 * once for the click the label forwards to its input) and the tick never moves.
 * Anything with a label of its own belongs outside this list, not in a row.
 */
export const SelectableList = ({
    items,
    onSelectAll,
    onSelectNone,
    onToggle,
    options,
    overriddenAll = false,
    scroll = 'native',
    selected,
    toolbar,
}: SelectableListProps) => {
    const rows = (
        <Stack gap="xs">
            {items.map((item) => (
                <Group
                    gap="md"
                    key={item.id}
                    onClick={() => !overriddenAll && onToggle(item.id)}
                    style={{
                        borderRadius: 'var(--theme-radius-sm)',
                        cursor: overriddenAll ? 'default' : 'pointer',
                        opacity: overriddenAll ? 0.4 : 1,
                        padding: 'var(--theme-spacing-xs) var(--theme-spacing-sm)',
                    }}
                >
                    <Checkbox checked={overriddenAll || selected.has(item.id)} readOnly size="sm" />
                    <Text fw={500} size="sm" style={{ flex: 1 }}>
                        {item.prefix && (
                            <Text c="dimmed" component="span" size="xs">
                                {item.prefix}
                            </Text>
                        )}
                        {item.label}
                    </Text>
                    {item.detail != null && (
                        <Text c="dimmed" size="xs">
                            {item.detail}
                        </Text>
                    )}
                </Group>
            ))}
        </Stack>
    );

    return (
        <>
            <Group gap="xs">
                {toolbar ?? (
                    <SelectionToolbar onSelectAll={onSelectAll} onSelectNone={onSelectNone} />
                )}
            </Group>
            {options}
            {scroll === 'area' ? (
                <ScrollArea style={{ flex: 1 }}>{rows}</ScrollArea>
            ) : (
                <Stack gap="xs" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                    {rows}
                </Stack>
            )}
        </>
    );
};
