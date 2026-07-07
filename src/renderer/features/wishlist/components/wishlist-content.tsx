import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { WishlistBulkActions } from '/@/renderer/features/wishlist/components/wishlist-bulk-actions';
import { WishlistRow } from '/@/renderer/features/wishlist/components/wishlist-row';
import { useWishlist } from '/@/renderer/features/wishlist/hooks/use-wishlist';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Table } from '/@/shared/components/table/table';
import { Text } from '/@/shared/components/text/text';

export const WishlistContent = () => {
    const { t } = useTranslation();
    const wishlistQuery = useWishlist();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const items = useMemo(() => wishlistQuery.data || [], [wishlistQuery.data]);

    // Keep the selection in sync with what's actually on screen — an item removed by a
    // background refetch (e.g. a bulk delete) shouldn't linger as a phantom selection.
    const selected = useMemo(() => {
        const present = new Set(items.map((item) => item.wishlist_id));
        return [...selectedIds].filter((id) => present.has(id));
    }, [items, selectedIds]);

    if (wishlistQuery.isLoading) {
        return <Spinner container />;
    }

    const toggleSelect = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const clearSelection = () => setSelectedIds(new Set());

    const allSelected = items.length > 0 && selected.length === items.length;
    const someSelected = selected.length > 0 && !allSelected;
    const toggleSelectAll = () => {
        setSelectedIds(allSelected ? new Set() : new Set(items.map((item) => item.wishlist_id)));
    };

    const selectedSet = new Set(selected);

    return (
        <ScrollArea>
            <Stack gap="sm" p="md">
                {selected.length > 0 && (
                    <WishlistBulkActions onClear={clearSelection} selectedIds={selected} />
                )}
                {items.length === 0 ? (
                    <Text isMuted ta="center">
                        {t('page.wishlist.empty', { postProcess: 'sentenceCase' })}
                    </Text>
                ) : (
                    <Table highlightOnHover verticalSpacing="xs">
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th style={{ width: 40 }}>
                                    <Checkbox
                                        aria-label={
                                            t('page.wishlist.selectAll', {
                                                postProcess: 'sentenceCase',
                                            }) as string
                                        }
                                        checked={allSelected}
                                        indeterminate={someSelected}
                                        onChange={toggleSelectAll}
                                    />
                                </Table.Th>
                                <Table.Th>
                                    {t('page.wishlist.columns.title', { postProcess: 'titleCase' })}
                                </Table.Th>
                                <Table.Th>
                                    {t('page.wishlist.columns.artist', {
                                        postProcess: 'titleCase',
                                    })}
                                </Table.Th>
                                <Table.Th>
                                    {t('page.wishlist.columns.album', { postProcess: 'titleCase' })}
                                </Table.Th>
                                <Table.Th>
                                    {t('page.wishlist.columns.status', {
                                        postProcess: 'titleCase',
                                    })}
                                </Table.Th>
                                <Table.Th style={{ width: 40 }} />
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {items.map((item) => (
                                <WishlistRow
                                    item={item}
                                    key={item.wishlist_id}
                                    onToggleSelect={toggleSelect}
                                    selected={selectedSet.has(item.wishlist_id)}
                                />
                            ))}
                        </Table.Tbody>
                    </Table>
                )}
            </Stack>
        </ScrollArea>
    );
};
