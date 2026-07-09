import path from 'path';
import { _electron as electron } from 'playwright';

import { ROOT } from '../ui-snapshot-shared.mjs';

// Diagnostic: prints app.getName()/app.getPath('userData') for a bare
// Electron launch of out/main/index.js.
//
// KNOWN LIMITATION: this always reports appName "Electron", not "subbox" —
// out/main/index.js has no adjacent package.json for Electron to resolve a
// real app identity from (confirmed: unaffected by passing `cwd`). That's a
// property of this bare launch harness, not of the real app — `pnpm dev`
// and packaged builds correctly resolve "subbox" from package.json very
// early in Electron's own bootstrap. Don't use this script's app name/userData
// output as evidence of an app-identity bug without corroborating against a
// real `pnpm dev` session first (see docs/qa/features/sync.md, "Investigated,
// turned out to be a false lead" — this exact mistake already happened once).

const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.js');

async function main() {
    const electronApp = await electron.launch({
        args: [MAIN_ENTRY],
        cwd: ROOT,
        env: {
            ...process.env,
            DISABLE_AUTO_UPDATES: '1',
            NODE_ENV: 'development',
        },
    });
    const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    const appName = await electronApp.evaluate(({ app }) => app.getName());
    console.log('userData:', userData);
    console.log('appName:', appName);
    await electronApp.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
