import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useIsDemoSession } from '/@/renderer/config/demo-config';
import { useTrash } from '/@/renderer/features/trash/hooks/use-trash';
import { AppRoute } from '/@/renderer/router/routes';
import { useSetAppMode } from '/@/renderer/store/app.store';
import { formatSizeString } from '/@/renderer/utils/format';
import { Button } from '/@/shared/components/button/button';
import { Text } from '/@/shared/components/text/text';

// Subbox-only: on the storage-limit screen, say that deleted tracks still use space
// until the trash is emptied, and how much they hold (subbox-app#152, design §11.4).
export const TrashSpaceNote = () => {
    const { t } = useTranslation();
    const isDemo = useIsDemoSession();
    const navigate = useNavigate();
    const setAppMode = useSetAppMode();
    const trash = useTrash({ enabled: !isDemo, refetchOnMount: 'always' });
    const bytes = trash.data?.trash_bytes ?? 0;
    if (isDemo) return null;

    return (
        <>
            <Text c="dimmed" size="sm" ta="center">
                {bytes > 0
                    ? t('page.trash.storageNoteHeld', { size: formatSizeString(bytes) })
                    : t('page.trash.storageNote')}
            </Text>
            {bytes > 0 && (
                <Button
                    fullWidth
                    onClick={() => {
                        // The trash is a library screen; this one is in Sync.
                        setAppMode('library');
                        navigate(AppRoute.TRASH);
                    }}
                    variant="default"
                >
                    {t('page.trash.open', { postProcess: 'titleCase' })}
                </Button>
            )}
        </>
    );
};
