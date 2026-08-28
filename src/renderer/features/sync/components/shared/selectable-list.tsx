import type { ReactNode } from 'react';

import { Button } from '/@/shared/components/button/button';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

export interface SelectableItem {
    /** Trailing right-aligned text — a track count, a size. */
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
     * They sit here rather than in a row because a row's checkbox is `readOnly` —
     * anything with a label of its own has to stay out of the click target.
     */
    options?: ReactNode;
    selected: Set<string>;
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
 * labelled checkbox inside a clickable wrapper fires twice — once for the label,
 * once for the click the label forwards to its input — and the tick never moves.
 * Anything with a label of its own belongs outside this list, not in a row.
 */
export const SelectableList = ({
    items,
    onSelectAll,
    onSelectNone,
    onToggle,
    options,
    selected,
}: SelectableListProps) => (
    <>
        <Group gap="xs">
            <SelectionToolbar onSelectAll={onSelectAll} onSelectNone={onSelectNone} />
        </Group>
        {options}
        <Stack gap="xs" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {items.map((item) => (
                <Group
                    gap="md"
                    key={item.id}
                    onClick={() => onToggle(item.id)}
                    style={{
                        borderRadius: 'var(--theme-radius-sm)',
                        cursor: 'pointer',
                        padding: 'var(--theme-spacing-xs) var(--theme-spacing-sm)',
                    }}
                >
                    <Checkbox checked={selected.has(item.id)} readOnly size="sm" />
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
    </>
);
