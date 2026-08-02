import { useCallback, useMemo, useState } from 'react';
import { Outlet } from 'react-router';

import { demoConfig, isDemoLoginEnabled } from '/@/renderer/config/demo-config';
import { urlConfig } from '/@/renderer/config/url-config';
import { isServerLock } from '/@/renderer/features/action-required/utils/window-properties';
import { LandingPage } from '/@/renderer/features/home/components/landing-page';
import { PymixAuthModal } from '/@/renderer/features/pymix/components/pymix-auth-modal';
import { loginWithPymix } from '/@/renderer/features/pymix/utils/pymix-login';
import { useAuthStoreActions, useCurrentServer } from '/@/renderer/store';
import { toast } from '/@/shared/components/toast/toast';
import { useDisclosure } from '/@/shared/hooks/use-disclosure';

const normalizeUrl = (url: string) => url.replace(/\/$/, '');

export const AppOutlet = () => {
    const currentServer = useCurrentServer();
    const { deleteServer, setCurrentServer } = useAuthStoreActions();
    const [authModalOpened, authModalHandlers] = useDisclosure(false);
    const [showLanding, setShowLanding] = useState(true);
    const [initialView, setInitialView] = useState<'create' | 'login'>('login');
    const [isDemoLoading, setIsDemoLoading] = useState(false);

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

    // One-click public trial. Deliberately not remembered: the demo is shared, so
    // pre-filling its credentials on someone's next visit would be misleading.
    const handleTryDemo = useCallback(async () => {
        try {
            setIsDemoLoading(true);
            await loginWithPymix({
                baseUrl: urlConfig.pymix,
                password: demoConfig.password,
                remember: false,
                username: demoConfig.username,
            });
            setShowLanding(false);
        } catch (err: any) {
            toast.error({ message: err?.message });
        } finally {
            setIsDemoLoading(false);
        }
    }, []);

    if (isActionsRequired) {
        return (
            <>
                {showLanding && (
                    <LandingPage
                        demoLoading={isDemoLoading}
                        onCreateAccount={handleCreateAccount}
                        onLogin={handleLogin}
                        onTryDemo={isDemoLoginEnabled ? handleTryDemo : undefined}
                    />
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
