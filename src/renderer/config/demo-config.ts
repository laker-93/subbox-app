/**
 * Public demo account configuration.
 *
 * The password is injected at build time via `VITE_DEMO_PASSWORD` (a Docker build
 * arg fed from a repository secret) rather than committed to an env file, so it
 * never lands in this public repo's history. It IS readable in the served bundle,
 * which is unavoidable for a one-click demo: Navidrome and Filebrowser both
 * authenticate from the browser and need the plaintext password.
 *
 * That exposure is acceptable precisely because `demo` is a public trial login —
 * pymix hard-blocks uploads/imports for it (`require_uploader`), and it reads
 * demoadmin's library rather than owning one. Never point this at an account that
 * can write to a real library.
 *
 * When the variable is unset the demo button simply doesn't render, so desktop and
 * self-hosted builds are unaffected.
 */
const password = import.meta.env.VITE_DEMO_PASSWORD as string | undefined;

export const DEMO_USERNAME = 'demo';

export const demoConfig = {
    password: password ?? '',
    username: DEMO_USERNAME,
};

export const isDemoLoginEnabled = Boolean(password);
