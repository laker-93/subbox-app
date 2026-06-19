import debounce from 'lodash/debounce';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FilebrowserController } from '/@/renderer/api/filebrowser/filebrowser-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { reauthenticate } from '/@/renderer/features/pymix/utils/reauthenticate';
import { useAuthStore, useAuthStoreActions, useCurrentServer } from '/@/renderer/store';
import { AuthState, ServerType } from '/@/shared/types/types';

export const useFBServerAuthenticated = () => {
    const priorServerId = useRef<string | undefined>(undefined);
    const server = useCurrentServer();
    const [ready, setReady] = useState(
        server?.type === ServerType.NAVIDROME ? AuthState.LOADING : AuthState.VALID,
    );

    const { setCurrentServer, updateServer } = useAuthStoreActions();

    const authenticateFB = useCallback(async () => {
        const currentServer = useAuthStore.getState().currentServer;

        if (!currentServer?.fbToken) {
            setReady(AuthState.INVALID);
            return;
        }

        try {
            await FilebrowserController.listUploads({
                baseUrl: urlConfig.filebrowser,
                token: currentServer.fbToken,
            });
            setReady(AuthState.VALID);
        } catch {
            // The filebrowser token has no interceptor-driven refresh, so an
            // expired token would otherwise force a logout. Try to silently
            // refresh all tokens with the saved password before giving up.
            try {
                const reauthed = await reauthenticate(currentServer);
                if (reauthed) {
                    setReady(AuthState.VALID);
                    return;
                }
            } catch {
                // fall through to logout below
            }

            setReady(AuthState.INVALID);
            updateServer(currentServer.id, {
                credential: undefined,
                fbToken: undefined,
                ndCredential: undefined,
            });
            setCurrentServer(null);
        }
    }, [setCurrentServer, updateServer]);

    const debouncedAuth = debounce(() => {
        authenticateFB().catch(console.error);
    }, 300);

    useEffect(() => {
        if (priorServerId.current !== server?.id) {
            priorServerId.current = server?.id;

            if (server?.type === ServerType.NAVIDROME) {
                setReady(AuthState.LOADING);
                debouncedAuth();
            } else {
                setReady(AuthState.VALID);
            }
        }
    }, [debouncedAuth, server]);

    return ready;
};
