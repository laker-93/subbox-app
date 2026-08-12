import isElectron from 'is-electron';

/**
 * Base URL for the static legal pages (`src/renderer/public/legal/`, built to
 * `out/web/legal/`).
 *
 * Unlike every other URL here these pages ship *inside the web image itself*, so in a
 * browser they are always on the same origin as the running app — dev, staging and prod
 * alike. Deriving the origin at runtime rather than pinning a host per environment means
 * local dev opens the copy it is actually serving instead of jumping to production, and
 * there is no fourth hostname to keep in step when one moves.
 *
 * Electron is the exception: the renderer is loaded off the filesystem and has no origin
 * of its own, so a desktop user has to be sent to the hosted copy.
 */
const legalBaseUrl = (): string => {
    if (!isElectron() && typeof window !== 'undefined' && window.location.origin) {
        return `${window.location.origin}/legal`;
    }

    return (import.meta.env.VITE_LEGAL_URL as string) || 'https://www.sub-box.net/legal';
};

/**
 * Centralized URL configuration.
 *
 * Values are injected at build time via Vite env files
 * (.env.development, .env.staging, .env.production) — except `legal`, which is
 * resolved at runtime (see `legalBaseUrl` above).
 *
 * The `{user}` placeholder in NAVIDROME_USER is replaced at runtime
 * with the actual username via `getNavidromeUrl()`.
 */
export const urlConfig = {
    discord: 'https://discord.gg/mqrRbex3hs',
    filebrowser: import.meta.env.VITE_FILEBROWSER_URL as string,
    legal: legalBaseUrl(),
    navidromeUser: import.meta.env.VITE_NAVIDROME_USER_URL as string,
    pymix: import.meta.env.VITE_PYMIX_URL as string,
};

/**
 * Returns the Navidrome URL for a specific user by replacing the `{user}`
 * placeholder in the template URL.
 */
export const getNavidromeUrl = (username: string): string => {
    return urlConfig.navidromeUser.replace('{user}', username);
};
