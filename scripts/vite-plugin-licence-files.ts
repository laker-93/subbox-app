import { readFileSync } from 'fs';
import path from 'path';
import { Plugin } from 'vite';

/**
 * Copies the repository's LICENSE and NOTICE into a browser build's output.
 *
 * Serving a JavaScript bundle to a browser conveys the program under the
 * GPL-3.0, and §4/§5(a) expect the licence text and the record of modification
 * to travel with what is conveyed. The Electron builds get these through
 * `extraResources` in electron-builder*.yml; the web and remote builds have no
 * equivalent, so without this plugin they ship the code and leave the notices
 * behind in the repository.
 *
 * @param repoRoot absolute path to the directory holding LICENSE and NOTICE.
 */
export const licenceFiles = (repoRoot: string): Plugin => ({
    apply: 'build',
    generateBundle() {
        for (const fileName of ['LICENSE', 'NOTICE']) {
            this.emitFile({
                fileName,
                source: readFileSync(path.resolve(repoRoot, fileName), 'utf8'),
                type: 'asset',
            });
        }
    },
    name: 'subbox:licence-files',
});
