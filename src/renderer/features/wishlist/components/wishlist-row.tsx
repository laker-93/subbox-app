import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { WishlistItemDetail } from '/@/renderer/features/wishlist/components/wishlist-item-detail';
import { WishlistStatusBadge } from '/@/renderer/features/wishlist/components/wishlist-status-badge';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Table } from '/@/shared/components/table/table';
import { Text } from '/@/shared/components/text/text';
import { WishlistItem } from '/@/shared/types/wishlist-types';

interface WishlistRowProps {
    item: WishlistItem;
    onToggleSelect: (id: string) => void;
    selected: boolean;
}

export const WishlistRow = ({ item, onToggleSelect, selected }: WishlistRowProps) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const isInbox = item.status === 'inbox';
    const unknown = t('common.unknown', { postProcess: 'sentenceCase' }) as string;

    return (
        <>
            <Table.Tr
                onClick={() => setExpanded((prev) => !prev)}
                style={{
                    backgroundColor: selected ? 'var(--theme-colors-hover)' : undefined,
                    cursor: 'pointer',
                }}
            >
                <Table.Td onClick={(e) => e.stopPropagation()} style={{ width: 40 }}>
                    <Checkbox
                        aria-label={
                            t('page.wishlist.selectRow', { postProcess: 'sentenceCase' }) as string
                        }
                        checked={selected}
                        onChange={() => onToggleSelect(item.wishlist_id)}
                    />
                </Table.Td>
                <Table.Td>
                    <Text fw={500} size="sm" truncate>
                        {isInbox ? item.raw_note : item.title || unknown}
                    </Text>
                </Table.Td>
                <Table.Td>
                    <Text isMuted size="sm" truncate>
                        {isInbox ? '' : item.artist || unknown}
                    </Text>
                </Table.Td>
                <Table.Td>
                    <Text isMuted size="sm" truncate>
                        {item.album ?? ''}
                    </Text>
                </Table.Td>
                <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                        {item.resolve_state === 'pending' && (
                            <Text isMuted size="xs">
                                {t('page.wishlist.resolving', { postProcess: 'sentenceCase' })}
                            </Text>
                        )}
                        <WishlistStatusBadge status={item.status} />
                    </Group>
                </Table.Td>
                <Table.Td style={{ width: 40 }}>
                    <Icon color="muted" icon={expanded ? 'arrowUpS' : 'arrowDownS'} size="sm" />
                </Table.Td>
            </Table.Tr>
            {expanded && (
                <Table.Tr>
                    <Table.Td colSpan={6} style={{ padding: 0 }}>
                        <WishlistItemDetail item={item} />
                    </Table.Td>
                </Table.Tr>
            )}
        </>
    );
};
