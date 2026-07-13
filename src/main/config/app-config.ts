/**
 * Centralized main-process config.
 *
 * Values are injected at build time via Vite env files
 * (.env.development, .env.staging, .env.production). Mirrors the renderer's
 * `url-config.ts` so both processes resolve their environment the same way.
 */
export const appConfig = {
    /**
     * Directory name for the local library, a sibling of Electron's userData
     * dir. `subbox-dev` in the development config isolates the dev library from
     * a staging/production `subbox` collection on the same machine; staging and
     * production both use `subbox`.
     */
    subboxDir: import.meta.env.VITE_SUBBOX_APP_DIR as string,
};
