import { useCallback, useMemo, useState } from 'react';
import { Outlet } from 'react-router';

import { urlConfig } from '/@/renderer/config/url-config';
import { isServerLock } from '/@/renderer/features/action-required/utils/window-properties';
import { LandingPage } from '/@/renderer/features/home/components/landing-page';
import { PymixAuthModal } from '/@/renderer/features/pymix/components/pymix-auth-modal';
import { useAuthStoreActions, useCurrentServer } from '/@/renderer/store';
import { useDisclosure } from '/@/shared/hooks/use-disclosure';

const normalizeUrl = (url: string) => url.replace(/\/$/, '');

export const AppOutlet = () => {
    const currentServer = useCurrentServer();
    const { deleteServer, setCurrentServer } = useAuthStoreActions();
    const [authModalOpened, authModalHandlers] = useDisclosure(false);
    const [showLanding, setShowLanding] = useState(true);
    const [initialView, setInitialView] = useState<'create' | 'login'>('login');

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
        setShowLanding(false);
    }, [authModalHandlers]);

    const handleLogin = useCallback(() => {
        setInitialView('login');
        authModalHandlers.open();
    }, [authModalHandlers]);

    const handleCreateAccount = useCallback(() => {
        setInitialView('create');
        authModalHandlers.open();
    }, [authModalHandlers]);

    if (isActionsRequired) {
        return (
            <>
                {showLanding && (
                    <LandingPage onCreateAccount={handleCreateAccount} onLogin={handleLogin} />
                )}
                <PymixAuthModal
                    baseUrl={urlConfig.pymix}
                    handlers={authModalHandlers}
                    initialView={initialView}
                    onSuccess={handleAuthSuccess}
                    opened={authModalOpened}
                />
            </>
        );
    }

    return <Outlet />;
};
