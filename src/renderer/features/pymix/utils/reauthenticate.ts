import isElectron from 'is-electron';

import { authenticateServices } from '/@/renderer/features/pymix/utils/authenticate-services';
import { useAuthStore } from '/@/renderer/store';
import { ServerListItemWithCredential } from '/@/shared/types/domain-types';

const localSettings = isElectron() ? window.api.localSettings : null;

/**
 * Re-authenticates an existing server using its saved password, refreshing the
 * navidrome (`credential`, `ndCredential`) and filebrowser (`fbToken`) tokens
 * together and updating the server entry in place (same id).
 *
 * Returns true on success. Returns false (without throwing) when running outside
 * electron, when the server has no saved password, or when no password is stored.
 * Reauth network/auth failures propagate so callers can fall back to logout.
 */
export const reauthenticate = async (server: ServerListItemWithCredential): Promise<boolean> => {
    if (!localSettings || !server.savePassword) {
        return false;
    }

    const password = await localSettings.passwordGet(server.id);
    if (!password) {
        return false;
    }

    const refreshed = await authenticateServices({
        id: server.id,
        password,
        username: server.username,
    });

    useAuthStore.getState().actions.updateServer(server.id, {
        credential: refreshed.credential,
        fbToken: refreshed.fbToken,
        ndCredential: refreshed.ndCredential,
    });

    return true;
};
