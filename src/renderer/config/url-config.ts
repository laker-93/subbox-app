/**
 * Centralized URL configuration.
 *
 * Values are injected at build time via Vite env files
 * (.env.development, .env.staging, .env.production).
 *
 * The `{user}` placeholder in NAVIDROME_USER is replaced at runtime
 * with the actual username via `getNavidromeUrl()`.
 */
export const urlConfig = {
    filebrowser: import.meta.env.VITE_FILEBROWSER_URL as string,
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
