import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { authenticateServices } from '/@/renderer/features/pymix/utils/authenticate-services';
import { useAuthStore } from '/@/renderer/store';
import { credentialStore } from '/@/renderer/utils/credential-store';
import { ServerListItemWithCredential } from '/@/shared/types/domain-types';
import { ServerType } from '/@/shared/types/types';

// "Remember me" controls whether the login form pre-fills saved credentials on the
// next login. It's independent of token reauth, which always keeps the password.
//
// The pointer (username + serverId) is stored separately from the auth store because
// logging out deletes the server from serverList (app-menu handleLogOff), while the
// saved password survives in credentialStore keyed by serverId. So we remember which
// serverId to look the password up under, independent of the (now-empty) serverList.
const REMEMBER_KEY = 'pymix_remember_credentials';
const REMEMBERED_LOGIN_KEY = 'pymix_remembered_login';

interface RememberedLogin {
    serverId: string;
    username: string;
}

export const getRememberPreference = (): boolean => localStorage.getItem(REMEMBER_KEY) !== 'false';

export const setRememberPreference = (remember: boolean): void => {
    localStorage.setItem(REMEMBER_KEY, remember ? 'true' : 'false');
};

export const getRememberedLogin = (): null | RememberedLogin => {
    try {
        return JSON.parse(localStorage.getItem(REMEMBERED_LOGIN_KEY) || 'null');
    } catch {
        return null;
    }
};

export const setRememberedLogin = (login: null | RememberedLogin): void => {
    if (login) {
        localStorage.setItem(REMEMBERED_LOGIN_KEY, JSON.stringify(login));
    } else {
        localStorage.removeItem(REMEMBERED_LOGIN_KEY);
    }
};

/**
 * Re-login should refresh the existing server entry instead of minting a new one,
 * otherwise stale, credential-stripped entries (and their saved passwords)
 * accumulate. Prefer a live serverList entry; fall back to the remembered pointer so
 * a re-login after logout reuses the same serverId (and its saved password).
 */
export const findExistingServerId = (username: string): string | undefined => {
    const fromList = Object.values(useAuthStore.getState().serverList).find(
        (server) => server.type === ServerType.NAVIDROME && server.username === username,
    )?.id;
    if (fromList) return fromList;

    const remembered = getRememberedLogin();
    return remembered?.username === username ? remembered.serverId : undefined;
};

/**
 * Persist the password so the filebrowser reauth path (and, on desktop, the
 * navidrome 401 interceptor) can silently refresh expired tokens. credentialStore
 * uses encrypted safeStorage on desktop and sessionStorage on web.
 */
export const persistServerPassword = async (password: string, serverId: string): Promise<void> => {
    await credentialStore.set(password, serverId);
};

/**
 * The full login sequence: authenticate with pymix, then with navidrome +
 * filebrowser, then install the resulting server as current. Shared by the login
 * form and the one-click demo button so there is a single implementation.
 */
export const loginWithPymix = async ({
    baseUrl,
    password,
    remember,
    username,
}: {
    baseUrl: string;
    password: string;
    remember: boolean;
    username: string;
}): Promise<ServerListItemWithCredential> => {
    await PymixController.login({ baseUrl, body: { password, username } });

    const serverItem = await authenticateServices({
        id: findExistingServerId(username),
        password,
        username,
    });

    const { addServer, setCurrentServer } = useAuthStore.getState().actions;
    addServer(serverItem);
    setCurrentServer(serverItem);
    await persistServerPassword(password, serverItem.id);

    if (remember) {
        setRememberedLogin({ serverId: serverItem.id, username });
    }

    return serverItem;
};
