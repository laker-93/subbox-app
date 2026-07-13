/**
 * Main-process env vars injected at build time by Vite (see the `.env.*` files).
 * Merges with the `ImportMetaEnv` interface from `electron-vite/node`.
 */
interface ImportMetaEnv {
    readonly VITE_SUBBOX_APP_DIR: string;
}
