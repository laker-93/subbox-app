import isElectron from 'is-electron';

// Cross-platform password store backing the silent token-reauth flows.
//
// Desktop (Electron): the OS-encrypted store via safeStorage (window.api.localSettings).
// Web: sessionStorage — there is no encrypted store in the browser, so the password
//   is kept in plaintext for the lifetime of the tab only (cleared when it closes).
//   Switch WEB_STORAGE to localStorage if reauth needs to survive a full restart, at
//   the cost of persisting the plaintext password to disk.
const localSettings = isElectron() ? window.api.localSettings : null;
const WEB_STORAGE: Storage | undefined =
    typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
const WEB_KEY_PREFIX = 'server_password_';

export const credentialStore = {
    get: async (serverId: string): Promise<null | string> => {
        if (localSettings) return localSettings.passwordGet(serverId);
        return WEB_STORAGE?.getItem(WEB_KEY_PREFIX + serverId) ?? null;
    },
    remove: (serverId: string): void => {
        if (localSettings) {
            localSettings.passwordRemove(serverId);
            return;
        }
        WEB_STORAGE?.removeItem(WEB_KEY_PREFIX + serverId);
    },
    set: async (password: string, serverId: string): Promise<boolean> => {
        if (localSettings) return localSettings.passwordSet(password, serverId);
        if (!WEB_STORAGE) return false;
        try {
            WEB_STORAGE.setItem(WEB_KEY_PREFIX + serverId, password);
            return true;
        } catch {
            return false;
        }
    },
};
