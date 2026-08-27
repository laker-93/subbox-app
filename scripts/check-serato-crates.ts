import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Builder, Crate, Track } from 'tserato';

import {
    CRATE_ZIP_FILENAME,
    nodeKey,
    readCrateTree,
    resolveSeratoFolder,
} from '../src/main/features/core/sync/serato-crates';
import { writeFlatZip } from '../src/main/features/core/sync/write-zip';

// Pins the two things about the Serato import that fail obscurely on the server
// when the client gets them wrong, and which nothing in the app itself would
// catch:
//
//   1. The crate tree. pymix builds one playlist per crate that has tracks of its
//      own, named by its full ancestry. If the preview disagrees, the user ticks
//      one set of playlists and gets another.
//   2. `all-crates.zip`. pymix extracts it and lists the directory with iterdir(),
//      not rglob(), so a `.crate` one level down parses to *zero* crates and the
//      import fails with nothing pointing at the cause.
//
// The last section re-checks both against pyserato — the implementation pymix
// actually runs — and is skipped when its interpreter isn't available.
//
// Usage: pnpm run check:serato-crates

const PYSERATO_PYTHON =
    process.env.PYSERATO_PYTHON ?? path.join(os.homedir(), 'workspace/pymix/.venv/bin/python');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serato-crates-check-'));
const seratoFolder = path.join(workDir, '_Serato_');

/**
 * Absolute paths that exist nowhere — which is both convenient and the honest
 * case: a crate stores a path, not a file, and pymix parses these crates in a
 * container that has none of the user's music on it.
 *
 * It has to be a path that exists on neither side. pyserato resolves a track path
 * through `Path.resolve()`, which follows symlinks in whatever part of the path
 * does exist, so a temp path under /var would come back /private/var on macOS and
 * stop matching the client's key — a difference that cannot arise on the server,
 * where the path resolves to nothing at all.
 */
const trackPath = (name: string) => `/subbox-check/music/${name}.mp3`;

function buildLibrary(): void {
    const builder = new Builder();

    // "Sets" holds tracks itself *and* two children — the case that decides
    // whether a crate is a playlist, a folder, or both.
    const sets = new Crate('Sets');
    sets.addTrack(Track.fromPath(trackPath('shared')));
    sets.addTrack(Track.fromPath(trackPath('sets-only')));

    const warmup = new Crate('Warmup');
    warmup.addTrack(Track.fromPath(trackPath('shared')));
    sets.children.set(warmup.name, warmup);

    const peak = new Crate('Peak');
    const deep = new Crate('Deep');
    deep.addTrack(Track.fromPath(trackPath('deep-one')));
    peak.children.set(deep.name, deep);
    sets.children.set(peak.name, peak);

    builder.save(sets, seratoFolder, true);

    // A top-level crate with no tracks anywhere: pure folder, no playlist.
    const empty = new Crate('Empty Folder');
    const emptyChild = new Crate('Nothing Here');
    empty.children.set(emptyChild.name, emptyChild);
    builder.save(empty, seratoFolder, true);
}

/** Cross-check against pyserato, which is what pymix actually parses the zip with. */
function checkAgainstPyserato(zipPath: string): void {
    if (!fs.existsSync(PYSERATO_PYTHON)) {
        console.log(`  pyserato cross-check: skipped (no interpreter at ${PYSERATO_PYTHON})`);
        return;
    }

    const script = `
import json, sys, tempfile, zipfile
from pathlib import Path
from pyserato.builder import Builder

dest = Path(tempfile.mkdtemp())
with zipfile.ZipFile(sys.argv[1]) as z:
    z.extractall(dest)

def walk(crate, components, out):
    here = components + [crate.name]
    if crate.tracks:
        out[' / '.join(here)] = sorted(str(t.path) for t in crate.tracks)
    for child in crate.children.values():
        walk(child, here, out)
    return out

out = {}
for top in Builder().parse_crates_from_root_path(dest).values():
    walk(top, [], out)
print(json.dumps(out))
`;
    const stdout = execFileSync(PYSERATO_PYTHON, ['-c', script, zipPath], { encoding: 'utf8' });
    const fromServer: Record<string, string[]> = JSON.parse(stdout);

    const selected = readCrateTree(seratoFolder).filter(
        (n) => nodeKey(n.components) !== 'Sets / Warmup',
    );
    const fromClient = Object.fromEntries(
        selected.map((n) => [nodeKey(n.components), [...n.tracks].sort()]),
    );

    // Playlist names AND track paths must agree: the paths are the manifest keys
    // pymix looks up `track_identities` by, so a difference of a single character
    // silently un-identifies every track in the crate.
    assert.deepEqual(
        fromServer,
        fromClient,
        'pymix must see the same playlists, and the same track paths, that the preview showed',
    );
    console.log(
        `  pyserato cross-check: ${Object.keys(fromServer).length} playlists and every track path agree — OK`,
    );
}

function checkCrateTree(): void {
    const nodes = readCrateTree(seratoFolder);
    const byKey = new Map(nodes.map((n) => [nodeKey(n.components), n]));

    assert.deepEqual(
        [...byKey.keys()].sort(),
        ['Sets', 'Sets / Peak / Deep', 'Sets / Warmup'],
        'a crate becomes a playlist only when it has tracks of its own',
    );
    assert.ok(!byKey.has('Sets / Peak'), 'Peak holds only a child crate, so it is a folder');
    assert.ok(!byKey.has('Empty Folder'), 'a crate tree with no tracks yields no playlist');

    assert.deepEqual(byKey.get('Sets')!.files, ['Sets.crate']);
    assert.deepEqual(byKey.get('Sets / Peak / Deep')!.files, ['Sets%%Peak%%Deep.crate']);
    assert.deepEqual(byKey.get('Sets / Warmup')!.components, ['Sets', 'Warmup']);

    assert.deepEqual(
        byKey.get('Sets')!.tracks,
        [trackPath('shared'), trackPath('sets-only')],
        'crate order is preserved, and the path is the absolute one the crate stores',
    );
    // The same track in two crates is one upload and one manifest entry; the
    // renderer needs the paths to work that out.
    assert.deepEqual(byKey.get('Sets / Warmup')!.tracks, [trackPath('shared')]);

    console.log(`  crate tree: ${nodes.length} playlists from 4 crate files — OK`);
}

function checkFolderResolution(): void {
    for (const [label, picked] of [
        ['the _Serato_ folder itself', seratoFolder],
        ['its parent', workDir],
        ['SubCrates inside it', path.join(seratoFolder, 'SubCrates')],
    ] as const) {
        assert.equal(resolveSeratoFolder(picked), seratoFolder, `picking ${label} should resolve`);
    }
    assert.equal(
        resolveSeratoFolder(path.join(workDir, 'music')),
        null,
        'a folder with no _Serato_ anywhere near it is rejected',
    );
    console.log('  folder resolution: all three ways of picking it — OK');
}

function checkZipLayout(): string {
    const nodes = readCrateTree(seratoFolder);
    // What the upload does when the user ticks two of the three playlists.
    const selected = nodes.filter((n) => nodeKey(n.components) !== 'Sets / Warmup');
    const files = Array.from(new Set(selected.flatMap((n) => n.files))).sort();
    const zipPath = packSelected(files);

    const listed = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .sort();
    assert.deepEqual(listed, files, 'the zip holds exactly the ticked crates');
    for (const name of listed) {
        assert.ok(!name.includes('/'), `"${name}" must sit at the zip root, not in a folder`);
    }

    assert.throws(
        () =>
            writeFlatZip(path.join(workDir, 'bad.zip'), [
                { data: Buffer.from('x'), name: 'SubCrates/a.crate' },
            ]),
        /bare filenames at the zip root/,
        'a nested entry is rejected rather than silently producing an archive pymix reads as empty',
    );

    console.log(`  ${CRATE_ZIP_FILENAME}: ${listed.length} entries, all at the root — OK`);
    return zipPath;
}

function main(): void {
    console.log('Serato crate reading and packing');
    buildLibrary();
    checkCrateTree();
    checkFolderResolution();
    const zipPath = checkZipLayout();
    checkAgainstPyserato(zipPath);
    console.log('\nAll Serato crate checks passed.');
}

function packSelected(files: string[]): string {
    const subcrates = path.join(seratoFolder, 'SubCrates');
    const zipPath = path.join(workDir, CRATE_ZIP_FILENAME);
    writeFlatZip(
        zipPath,
        files.map((name) => ({ data: fs.readFileSync(path.join(subcrates, name)), name })),
    );
    return zipPath;
}

try {
    main();
} finally {
    fs.rmSync(workDir, { force: true, recursive: true });
}
