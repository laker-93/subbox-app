/// <reference types="vite/client" />

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

interface ImportMetaEnv {
    readonly VITE_FILEBROWSER_URL: string;
    readonly VITE_NAVIDROME_USER_URL: string;
    readonly VITE_PYMIX_URL: string;
}
