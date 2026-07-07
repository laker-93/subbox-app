import { useTranslation } from 'react-i18next';

import {
    useBulkDeleteWishlistItems,
    useBulkUpdateWishlistStatus,
} from '/@/renderer/features/wishlist/hooks/use-wishlist-bulk';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals, ConfirmModal, openModal } from '/@/shared/components/modal/modal';
import { Paper } from '/@/shared/components/paper/paper';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

interface WishlistBulkActionsProps {
    onClear: () => void;
    selectedIds: string[];
}

// Toolbar shown while one or more rows are selected: apply a status transition to, or
// delete, the whole selection at once. Rendered above the datagrid; hidden when nothing
// is selected.
export const WishlistBulkActions = ({ onClear, selectedIds }: WishlistBulkActionsProps) => {
    const { t } = useTranslation();
    const updateStatus = useBulkUpdateWishlistStatus({});
    const deleteItems = useBulkDeleteWishlistItems({});

    const count = selectedIds.length;
    const pending = updateStatus.isPending || deleteItems.isPending;

    const handleError = (error: Error) => {
        toast.error({
            message: error.message,
            title: t('error.genericError', { postProcess: 'sentenceCase' }) as string,
        });
    };

    const setStatus = (status: 'downloaded' | 'ignored' | 'wishlist') => {
        updateStatus.mutate(
            { ids: selectedIds, status },
            { onError: handleError, onSuccess: onClear },
        );
    };

    const handleDelete = () => {
        openModal({
            children: (
                <ConfirmModal
                    labels={{
                        cancel: t('common.cancel', { postProcess: 'sentenceCase' }),
                        confirm: t('common.delete', { postProcess: 'sentenceCase' }),
                    }}
                    loading={deleteItems.isPending}
                    onConfirm={() => {
                        deleteItems.mutate(
                            { ids: selectedIds },
                            { onError: handleError, onSuccess: onClear },
                        );
                        closeAllModals();
                    }}
                >
                    <Text>
                        {t('page.wishlist.confirmBulkDelete', {
                            count,
                            postProcess: 'sentenceCase',
                        })}
                    </Text>
                </ConfirmModal>
            ),
            title: t('common.delete', { postProcess: 'titleCase' }) as string,
        });
    };

    return (
        <Paper p="xs">
            <Group gap="xs" justify="space-between" wrap="wrap">
                <Text fw={500} size="sm">
                    {t('page.wishlist.selectedCount', { count, postProcess: 'sentenceCase' })}
                </Text>
                <Group gap="xs" wrap="wrap">
                    <Button
                        disabled={pending}
                        onClick={() => setStatus('downloaded')}
                        size="sm"
                        variant="default"
                    >
                        {t('action.markDownloaded', { postProcess: 'sentenceCase' })}
                    </Button>
                    <Button
                        disabled={pending}
                        onClick={() => setStatus('ignored')}
                        size="sm"
                        variant="default"
                    >
                        {t('action.ignore', { postProcess: 'sentenceCase' })}
                    </Button>
                    <Button
                        disabled={pending}
                        onClick={handleDelete}
                        size="sm"
                        variant="state-error"
                    >
                        {t('common.delete', { postProcess: 'sentenceCase' })}
                    </Button>
                    <Button disabled={pending} onClick={onClear} size="sm" variant="subtle">
                        {t('action.clearSelection', { postProcess: 'sentenceCase' })}
                    </Button>
                </Group>
            </Group>
        </Paper>
    );
};
