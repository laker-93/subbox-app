import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { WishlistBulkActions } from '/@/renderer/features/wishlist/components/wishlist-bulk-actions';
import { WishlistListControls } from '/@/renderer/features/wishlist/components/wishlist-list-controls';
import { WishlistRow } from '/@/renderer/features/wishlist/components/wishlist-row';
import { useWishlist } from '/@/renderer/features/wishlist/hooks/use-wishlist';
import { useWishlistSort, useWishlistStatusFilter } from '/@/renderer/store/app.store';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Table } from '/@/shared/components/table/table';
import { Text } from '/@/shared/components/text/text';
import { SortOrder } from '/@/shared/types/domain-types';
import { WISHLIST_STATUSES, WishlistItem } from '/@/shared/types/wishlist-types';

const getSortValue = (item: WishlistItem, sortBy: string): number | string => {
    switch (sortBy) {
        case 'album':
            return (item.album ?? '').toLowerCase();
        case 'artist':
            return (item.artist ?? '').toLowerCase();
        case 'createdAt':
            return item.created_at ?? 0;
        case 'status':
            return WISHLIST_STATUSES.indexOf(item.status);
        case 'title':
        default:
            return (item.title ?? item.raw_note ?? '').toLowerCase();
    }
};

export const WishlistContent = () => {
    const { t } = useTranslation();
    const wishlistQuery = useWishlist();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const statusFilter = useWishlistStatusFilter();
    const sort = useWishlistSort();

    const items = useMemo(() => wishlistQuery.data || [], [wishlistQuery.data]);

    // What's actually rendered: the fetched list narrowed to the chosen status and put in
    // the chosen order. "Select all" and bulk actions act on this, not the raw `items`, so
    // filtering down to e.g. "available" and hitting select-all only grabs what's visible.
    const visibleItems = useMemo(() => {
        const filtered =
            statusFilter === 'all' ? items : items.filter((item) => item.status === statusFilter);

        const direction = sort.sortOrder === SortOrder.DESC ? -1 : 1;

        return [...filtered].sort((a, b) => {
            const aValue = getSortValue(a, sort.sortBy);
            const bValue = getSortValue(b, sort.sortBy);

            if (aValue < bValue) return -1 * direction;
            if (aValue > bValue) return 1 * direction;
            return 0;
        });
    }, [items, statusFilter, sort.sortBy, sort.sortOrder]);

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

    const selectedVisibleCount = visibleItems.filter((item) =>
        selectedIds.has(item.wishlist_id),
    ).length;
    const allSelected = visibleItems.length > 0 && selectedVisibleCount === visibleItems.length;
    const someSelected = selectedVisibleCount > 0 && !allSelected;
    const toggleSelectAll = () => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            const visibleIds = visibleItems.map((item) => item.wishlist_id);
            if (allSelected) {
                visibleIds.forEach((id) => next.delete(id));
            } else {
                visibleIds.forEach((id) => next.add(id));
            }
            return next;
        });
    };

    const selectedSet = new Set(selected);

    return (
        <ScrollArea>
            <Stack gap="sm" p="md">
                {items.length > 0 && <WishlistListControls />}
                {selected.length > 0 && (
                    <WishlistBulkActions onClear={clearSelection} selectedIds={selected} />
                )}
                {items.length === 0 ? (
                    <Text isMuted ta="center">
                        {t('page.wishlist.empty', { postProcess: 'sentenceCase' })}
                    </Text>
                ) : visibleItems.length === 0 ? (
                    <Text isMuted ta="center">
                        {t('page.wishlist.noStatusMatches', { postProcess: 'sentenceCase' })}
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
                            {visibleItems.map((item) => (
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
