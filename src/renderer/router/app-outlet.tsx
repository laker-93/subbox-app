import { useCallback, useMemo } from 'react';
import { Outlet } from 'react-router';

import { urlConfig } from '/@/renderer/config/url-config';
import { isServerLock } from '/@/renderer/features/action-required/utils/window-properties';
import { PymixAuthModal } from '/@/renderer/features/pymix/components/pymix-auth-modal';
import { useAuthStoreActions, useCurrentServer } from '/@/renderer/store';
import { useDisclosure } from '/@/shared/hooks/use-disclosure';

const normalizeUrl = (url: string) => url.replace(/\/$/, '');

export const AppOutlet = () => {
    const currentServer = useCurrentServer();
    const { deleteServer, setCurrentServer } = useAuthStoreActions();
    const [authModalOpened, authModalHandlers] = useDisclosure(true);

    const isActionsRequired = useMemo(() => {
        // When SERVER_LOCK is enabled and the configured URL has changed,
        // clear the stale session so the user re-authenticates against the new server.
        if (isServerLock() && currentServer && window.SERVER_URL) {
            const configuredUrl = normalizeUrl(window.SERVER_URL);
            const persistedUrl = normalizeUrl(currentServer.url);

            if (configuredUrl !== persistedUrl) {
                deleteServer(currentServer.id);
                setCurrentServer(null);
                return true;
            }
        }

        const isServerRequired = !currentServer;

        return isServerRequired;
    }, [currentServer, deleteServer, setCurrentServer]);

    const handleAuthSuccess = useCallback(() => {
        authModalHandlers.close();
    }, [authModalHandlers]);

    if (isActionsRequired) {
        return (
            <PymixAuthModal
                baseUrl={urlConfig.pymix}
                handlers={authModalHandlers}
                opened={authModalOpened}
                onSuccess={handleAuthSuccess}
            />
        );
    }

    return <Outlet />;
};
