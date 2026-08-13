import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as unzipper from 'unzipper';

import { resolveExtractDestination } from '../src/main/features/core/sync/export-zip-layout';

// Regression check for the Rekordbox web-download path bug: pymix's export zip used to
// have two top-level entries (music/ and subbox_rb_export.xml), so macOS' Archive
// Utility wrapped it in a folder named after the archive and every track ended up one
// level below the Location the XML recorded for it. pymix now writes the XML inside
// music/, giving the zip a single top-level entry.
//
// This checks the *desktop* side of that move: unzipAndMerge must keep routing the XML
// to the user's chosen XML folder — and the tracks into the music tree — under the new
// layout AND the old one, so a client and server on either side of the change agree.
//
// Usage: pnpm run check:export-zip-extraction

const XML_FILENAME = 'subbox_rb_export.xml';
const TRACK_ENTRY = 'Zeropage/Ambient Pills/07 - Ambient Flight.mp3';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-zip-check-'));

/** Build a real zip with the given entry paths, so the check runs on what unzipper
 *  actually reports rather than on hand-written strings. */
function buildZip(name: string, entries: string[]): string {
    const stageDir = path.join(workDir, `${name}-stage`);
    for (const entry of entries) {
        const filePath = path.join(stageDir, entry);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, `contents of ${entry}`);
    }
    const zipPath = path.join(workDir, `${name}.zip`);
    execFileSync('zip', ['-q', '-r', zipPath, '.'], { cwd: stageDir });
    return zipPath;
}

async function entryPathsOf(zipPath: string): Promise<string[]> {
    const directory = await unzipper.Open.file(zipPath);
    return directory.files.filter((f) => f.type === 'File').map((f) => f.path);
}

async function main(): Promise<void> {
    const appPath = path.join(workDir, 'subbox');
    const xmlDestPath = path.join(workDir, 'my-xml-folder', XML_FILENAME);
    // What index.ts passes: keyed by the bare filename.
    const extractTo = { [XML_FILENAME]: xmlDestPath };

    const layouts = {
        // pymix today: one top-level entry, XML inside music/.
        current: buildZip('current', [`music/${XML_FILENAME}`, `music/${TRACK_ENTRY}`]),
        // pymix before this change: XML at the zip root, next to music/.
        legacy: buildZip('legacy', [XML_FILENAME, `music/${TRACK_ENTRY}`]),
    };

    for (const [label, zipPath] of Object.entries(layouts)) {
        const entryPaths = await entryPathsOf(zipPath);
        assert.equal(entryPaths.length, 2, `${label}: expected 2 files in the zip`);

        const destinations = new Map(
            entryPaths.map((entryPath) => [
                entryPath,
                resolveExtractDestination(entryPath, appPath, extractTo),
            ]),
        );

        const xmlEntry = entryPaths.find((p) => p.endsWith(XML_FILENAME))!;
        const xmlDestination = destinations.get(xmlEntry)!;
        assert.equal(
            xmlDestination.redirected,
            true,
            `${label}: the XML was not redirected out of the music tree (entry ${xmlEntry})`,
        );
        assert.equal(
            xmlDestination.path,
            xmlDestPath,
            `${label}: the XML landed somewhere other than the user's XML folder`,
        );

        const trackEntry = entryPaths.find((p) => p.endsWith('.mp3'))!;
        const trackDestination = destinations.get(trackEntry)!;
        assert.equal(
            trackDestination.redirected,
            false,
            `${label}: a track was redirected out of the music tree`,
        );
        // The path the XML's Locations are built from: <appPath>/music/<artist>/...
        assert.equal(
            trackDestination.path,
            path.join(appPath, 'music', TRACK_ENTRY),
            `${label}: the track did not land under <appPath>/music`,
        );
    }

    // The property that made the bug possible in the first place: more than one
    // top-level entry is what makes macOS add a wrapper folder.
    const currentTopLevel = new Set(
        (await entryPathsOf(layouts.current)).map((p) => p.split('/')[0]),
    );
    assert.deepEqual(
        [...currentTopLevel],
        ['music'],
        'the current layout must have exactly one top-level entry',
    );

    console.log('✓ export zip extraction routes the XML and tracks correctly in both layouts');
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
        fs.rmSync(workDir, { force: true, recursive: true });
    });
