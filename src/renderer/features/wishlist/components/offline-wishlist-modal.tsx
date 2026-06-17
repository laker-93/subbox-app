import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    WISHLIST_SHEET_SERVICE_ACCOUNT_EMAIL,
    WISHLIST_SHEET_TEMPLATE_COPY_URL,
} from '/@/renderer/features/wishlist/constants';
import { useSetWishlistSheet } from '/@/renderer/features/wishlist/hooks/use-set-wishlist-sheet';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { CopyButton } from '/@/shared/components/copy-button/copy-button';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { closeAllModals, openModal } from '/@/shared/components/modal/modal';
import { ModalButton } from '/@/shared/components/modal/model-shared';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';

const SHEET_ID_RE = /\/d\/([a-zA-Z0-9-_]+)/;

const OfflineWishlistContent = () => {
    const { t } = useTranslation();
    const mutation = useSetWishlistSheet({});
    const [sheetUrl, setSheetUrl] = useState('');

    const handleSave = () => {
        const match = sheetUrl.match(SHEET_ID_RE);
        if (!match) {
            toast.error({
                message: t('page.wishlist.offlineWishlist.sheetUrlInvalid', {
                    postProcess: 'sentenceCase',
                }) as string,
            });
            return;
        }

        mutation.mutate(
            { body: { sheet_id: match[1] } },
            {
                onError: () => {
                    toast.error({
                        message: t('page.wishlist.offlineWishlist.saveError', {
                            postProcess: 'sentenceCase',
                        }) as string,
                    });
                },
                onSuccess: () => {
                    toast.success({
                        message: t('page.wishlist.offlineWishlist.saveSuccess', {
                            postProcess: 'sentenceCase',
                        }) as string,
                    });
                    closeAllModals();
                },
            },
        );
    };

    return (
        <Stack gap="md">
            <Text isMuted size="sm">
                {t('page.wishlist.offlineWishlist.description', { postProcess: 'sentenceCase' })}
            </Text>
            <Button
                onClick={() => window.open(WISHLIST_SHEET_TEMPLATE_COPY_URL, '_blank')}
                variant="default"
            >
                {t('action.createOfflineWishlist', { postProcess: 'sentenceCase' })}
            </Button>
            <Text size="sm">
                {t('page.wishlist.offlineWishlist.step1', { postProcess: 'sentenceCase' })}
            </Text>
            <Group gap="xs">
                <Text size="sm">
                    {t('page.wishlist.offlineWishlist.step2', { postProcess: 'sentenceCase' })}
                </Text>
                <Text fw={500} size="sm">
                    {WISHLIST_SHEET_SERVICE_ACCOUNT_EMAIL}
                </Text>
                <CopyButton timeout={2000} value={WISHLIST_SHEET_SERVICE_ACCOUNT_EMAIL}>
                    {({ copied, copy }) => (
                        <Tooltip
                            label={t(
                                copied
                                    ? 'page.wishlist.offlineWishlist.emailCopied'
                                    : 'common.copy',
                                { postProcess: 'sentenceCase' },
                            )}
                            withinPortal
                        >
                            <ActionIcon onClick={copy} variant="transparent">
                                {copied ? <Icon icon="check" /> : <Icon icon="clipboardCopy" />}
                            </ActionIcon>
                        </Tooltip>
                    )}
                </CopyButton>
            </Group>
            <Text size="sm">
                {t('page.wishlist.offlineWishlist.step3', { postProcess: 'sentenceCase' })}
            </Text>
            <TextInput
                label={t('page.wishlist.offlineWishlist.sheetUrlLabel', {
                    postProcess: 'sentenceCase',
                })}
                onChange={(event) => setSheetUrl(event.currentTarget.value)}
                placeholder={t('page.wishlist.offlineWishlist.sheetUrlPlaceholder') as string}
                value={sheetUrl}
            />
            <Group justify="flex-end">
                <ModalButton onClick={closeAllModals} variant="subtle">
                    {t('common.cancel', { postProcess: 'sentenceCase' })}
                </ModalButton>
                <ModalButton loading={mutation.isPending} onClick={handleSave} variant="filled">
                    {t('action.saveWishlistSheet', { postProcess: 'sentenceCase' })}
                </ModalButton>
            </Group>
        </Stack>
    );
};

export const openOfflineWishlistModal = () => {
    openModal({
        children: <OfflineWishlistContent />,
        title: t('page.wishlist.offlineWishlist.title', { postProcess: 'titleCase' }) as string,
    });
};
