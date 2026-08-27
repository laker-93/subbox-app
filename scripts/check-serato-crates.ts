import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Builder, Crate, Track, V2Mp3Encoder } from 'tserato';

import {
    CRATE_ZIP_FILENAME,
    crateFileNames,
    nodeKey,
    readCrateTree,
    readTrackCues,
    resolveSeratoFolder,
    SeratoCueWire,
    storedTrackPath,
    volumeRootOf,
    writeCrates,
    writeTrackCues,
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
// Since P4 it also pins the export half, where the stakes are different: these
// crate files are written into the user's own Serato library, so most of those
// checks are about what must NOT be destroyed.
//
// Two sections re-check against pyserato — the implementation pymix actually
// runs — and are skipped when its interpreter isn't available.
//
// Usage: pnpm run check:serato-crates

const PYSERATO_PYTHON =
    process.env.PYSERATO_PYTHON ?? path.join(os.homedir(), 'workspace/pymix/.venv/bin/python');

/**
 * The one irreversible thing this code can do, checked against real analysed files.
 *
 * A Serato-analysed MP3 carries six GEOB frames. Five of them — Analysis,
 * Autotags, BeatGrid, Markers_, Overview — are minutes of the user's work
 * (beatgrid, waveform, key/BPM) that cannot be recovered without re-analysing,
 * losing any manual gridding with it. laker-93/tserato#9 was a write that
 * replaced the whole GEOB array and took all five with it.
 *
 * Skipped when the fixture library isn't on this machine. It has to be real
 * Serato output: a synthesised file has none of the frames whose survival is the
 * thing being checked.
 */
const ANALYSED_FIXTURES =
    process.env.SERATO_QA_LIBRARY ?? path.join(os.homedir(), 'Music', 'SubboxSeratoQA');

// realpath'd, because the write checks below put real files in here and compare
// the paths tserato stored against the ones pyserato reads back. pyserato's
// Track.from_path calls Path.resolve(), which follows symlinks through whatever
// part of the path exists — and on macOS /var is a symlink to /private/var. The
// difference cannot arise on the server, where none of the user's paths exist at
// all, so resolving the fixture's own root is the honest way to remove it.
const workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'serato-crates-check-')));
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

    console.log('\nSerato crate writing');
    checkFileNamesMatchTseratoSave();
    checkCratesAreWritten();
    checkPathsAreStoredSeratoStyle();
    checkAnExistingParentCrateSurvives();
    checkAReplacedCrateIsBackedUp();
    checkNamesThatCannotBeFilenames();
    checkCuesAreWrittenButNeverOverwritten();
    checkCueWritesPreserveTheAnalysis();
    checkWrittenCratesAgainstPyserato();

    console.log('\nAll Serato crate checks passed.');
}
// ── Writing ─────────────────────────────────────────────────────────────────
//
// The export half. Three of these guard damage rather than correctness: the crate
// files go into the user's own Serato library, and a wrong write costs them work
// they cannot get back.

const writeDir = path.join(workDir, 'write');
const writeSerato = path.join(writeDir, '_Serato_');
const musicRoot = path.join(writeDir, 'music');

function checkAnExistingParentCrateSurvives(): void {
    // The damaging case. Writing "Sets / Deep" also writes "Sets.crate", and a
    // user who keeps tracks directly in "Sets" would lose all of them to an empty
    // rewrite they never asked for.
    const keeper = localTrack('Artist/Album/keeper.mp3');
    const sets = new Crate('Sets');
    sets.addTrack(Track.fromPath(keeper));
    new Builder().save(sets, writeSerato, true);

    const result = writeCrates(writeSerato, [
        { pathComponents: ['Sets', 'Deep'], tracks: [{ localPath: localTrack('a/b/deep.mp3') }] },
    ]);

    assert.ok(result.backupFolder, 'the parent it was about to overwrite must be backed up');
    const byKey = new Map(readCrateTree(writeSerato).map((n) => [nodeKey(n.components), n]));
    assert.deepEqual(
        byKey.get('Sets')!.tracks,
        [keeper],
        'a parent crate that already had tracks keeps them',
    );
    assert.deepEqual(byKey.get('Sets / Deep')!.tracks, [path.join(musicRoot, 'a/b/deep.mp3')]);
    console.log('  writing: an existing parent crate keeps its own tracks — OK');
}

function checkAReplacedCrateIsBackedUp(): void {
    const before = fs.readFileSync(path.join(writeSerato, 'SubCrates', 'Subbox%%Peak Time.crate'));

    const result = writeCrates(writeSerato, [
        {
            pathComponents: ['Subbox', 'Peak Time'],
            tracks: [{ localPath: localTrack('Artist/Album/three.mp3') }],
        },
    ]);

    assert.ok(result.backupFolder, 'replacing a crate must leave a copy behind');
    assert.ok(
        !result.backupFolder!.startsWith(path.join(writeSerato, 'SubCrates') + path.sep),
        'the backup must sit outside SubCrates, which Serato reads in full',
    );
    assert.deepEqual(
        fs.readFileSync(path.join(result.backupFolder!, 'Subbox%%Peak Time.crate')),
        before,
        'the backup is the crate exactly as it was',
    );
    const byKey = new Map(readCrateTree(writeSerato).map((n) => [nodeKey(n.components), n]));
    assert.deepEqual(byKey.get('Subbox / Peak Time')!.tracks, [
        path.join(musicRoot, 'Artist/Album/three.mp3'),
    ]);
    console.log('  writing: a replaced crate is backed up outside SubCrates — OK');
}

function checkCratesAreWritten(): void {
    const result = writeCrates(writeSerato, [
        {
            pathComponents: ['Subbox', 'Peak Time'],
            tracks: [
                { localPath: localTrack('Artist/Album/one.mp3') },
                { localPath: localTrack('Artist/Album/two.mp3') },
                { localPath: path.join(musicRoot, 'Artist/Album/gone.mp3') },
            ],
        },
    ]);

    assert.equal(result.cratesWritten, 1);
    assert.equal(result.tracksWritten, 2);
    assert.deepEqual(result.missing, [path.join(musicRoot, 'Artist/Album/gone.mp3')]);
    assert.equal(result.backupFolder, null, 'nothing existed, so nothing was backed up');

    // Read back through the same parse the import uses, so the round trip is the
    // assertion rather than the bytes.
    const nodes = readCrateTree(writeSerato);
    const byKey = new Map(nodes.map((n) => [nodeKey(n.components), n]));
    assert.deepEqual([...byKey.keys()], ['Subbox / Peak Time']);
    assert.deepEqual(byKey.get('Subbox / Peak Time')!.tracks, [
        path.join(musicRoot, 'Artist/Album/one.mp3'),
        path.join(musicRoot, 'Artist/Album/two.mp3'),
    ]);
    console.log('  writing: a nested crate round-trips through the import parse — OK');
}

function checkCuesAreWrittenButNeverOverwritten(): void {
    const fresh = synthMp3('Artist/Album/fresh.mp3');
    const cues = [
        { end_ms: null, index: 0, name: 'in', start_ms: 8000, type: 'cue' as const },
        { end_ms: 188000, index: 0, name: 'tail', start_ms: 180000, type: 'loop' as const },
    ];

    const first = writeTrackCues([{ cues, localPath: fresh }]);
    assert.equal(first.written, 1, 'a track with no cues of its own gets subbox’s');

    const readBack = readTrackCues(fresh)!;
    assert.deepEqual(
        readBack.map((c) => [c.type, c.start_ms, c.end_ms, c.name]),
        [
            ['cue', 8000, null, 'in'],
            ['loop', 180000, 188000, 'tail'],
        ],
        'the loop keeps its end point, which is the tserato#11 signature',
    );

    // The rule that makes this safe to point at a real library: a track the user
    // has already cued is theirs, and subbox’s copy is as old as the last import.
    const second = writeTrackCues([
        {
            cues: [{ index: 0, name: 'clobber', start_ms: 1, type: 'cue' as const }],
            localPath: fresh,
        },
    ]);
    assert.equal(second.written, 0);
    assert.equal(second.alreadyCued, 1);
    assert.deepEqual(readTrackCues(fresh), readBack, 'existing cues are left exactly as they were');

    // Nothing but MP3 has an encoder, on either side.
    const flac = localTrack('Artist/Album/five.flac');
    const skipped = writeTrackCues([{ cues, localPath: flac }]);
    assert.equal(skipped.unsupported, 1);
    assert.equal(readTrackCues(flac), null);

    console.log('  cues: written into an uncued track, never over an existing one — OK');
}

function checkCueWritesPreserveTheAnalysis(): void {
    if (!fs.existsSync(PYSERATO_PYTHON)) {
        console.log(`  GEOB preservation: skipped (no interpreter at ${PYSERATO_PYTHON})`);
        return;
    }
    const analysed = findAnalysedFixtures().filter((f) => geobFrames(f).length >= 6);
    if (analysed.length === 0) {
        console.log(
            `  GEOB preservation: skipped (no analysed fixtures under ${ANALYSED_FIXTURES})`,
        );
        return;
    }

    const dir = path.join(workDir, 'analysed');
    fs.mkdirSync(dir, { recursive: true });
    const cues: SeratoCueWire[] = [
        { end_ms: null, index: 0, name: 'subbox-in', start_ms: 4000, type: 'cue' },
        { end_ms: 20000, index: 0, name: 'subbox-loop', start_ms: 12000, type: 'loop' },
    ];

    // ── An already-cued track is not touched at all ─────────────────────────
    const cued = path.join(dir, 'cued.mp3');
    fs.copyFileSync(analysed[0], cued);
    assert.ok(readTrackCues(cued)!.length > 0, 'fixture should already carry cues');
    const bytesBefore = fs.readFileSync(cued);
    const skipped = writeTrackCues([{ cues, localPath: cued }]);
    assert.equal(skipped.written, 0);
    assert.equal(skipped.alreadyCued, 1);
    assert.deepEqual(fs.readFileSync(cued), bytesBefore, 'the file must not be rewritten at all');
    console.log('  GEOB preservation: an already-cued analysed track is left byte-identical — OK');

    // ── An analysed track with no cues gets them, and keeps everything else ──
    const fresh = path.join(dir, 'fresh.mp3');
    fs.copyFileSync(analysed[0], fresh);
    // Clear just the cues, the way a user who deleted them in Serato would: an
    // empty Markers2, with the other five frames still in place.
    const cleared = Track.fromPath(fresh);
    new V2Mp3Encoder().write(cleared);
    const framesBefore = geobFrames(fresh);
    assert.equal(readTrackCues(fresh)!.length, 0, 'cues cleared, frames kept');
    assert.ok(framesBefore.length >= 6, `expected the full frame set, got ${framesBefore}`);

    const result = writeTrackCues([{ cues, localPath: fresh }]);
    assert.equal(result.written, 1, `write failed: ${JSON.stringify(result.failed)}`);

    const framesAfter = geobFrames(fresh);
    assert.deepEqual(
        framesAfter,
        framesBefore,
        'writing cues must not disturb the beatgrid, waveform or analysis frames',
    );
    const back = readTrackCues(fresh)!;
    assert.deepEqual(
        back.map((c) => [c.type, c.start_ms, c.end_ms ?? null]),
        [
            ['cue', 4000, null],
            ['loop', 12000, 20000],
        ],
        'and the cues it did write must read back intact',
    );
    console.log(
        `  GEOB preservation: cues written into an analysed track, all ` +
            `${framesAfter.length} frames intact — OK`,
    );
}

function checkFileNamesMatchTseratoSave(): void {
    // crateFileNames derives what save() names its files, because the files that
    // are about to be replaced have to be known before anything is written. If
    // tserato ever changes that naming, the backup would protect the wrong files.
    const probe = path.join(writeDir, 'probe', '_Serato_');
    const leaf = new Crate('Deep');
    const mid = new Crate('Peak');
    const root = new Crate('Sets');
    mid.children.set(leaf.name, leaf);
    root.children.set(mid.name, mid);
    new Builder().save(root, probe, true);

    const actual = fs.readdirSync(path.join(probe, 'SubCrates')).sort();
    assert.deepEqual(
        actual,
        [...crateFileNames(['Sets', 'Peak', 'Deep'])].sort(),
        'crateFileNames must name exactly the files tserato writes',
    );
    console.log('  crate filenames: derived names match what tserato writes — OK');
}

function checkNamesThatCannotBeFilenames(): void {
    // A subbox playlist name is free text; a crate name is a filename, and `/` and
    // `%%` are both structural. Renaming has to be reported, or the user goes
    // looking in Serato for a crate that is there under another name.
    const result = writeCrates(writeSerato, [
        {
            pathComponents: ['Deep / Dub', 'a%%b'],
            tracks: [{ localPath: localTrack('Artist/Album/four.mp3') }],
        },
    ]);

    assert.deepEqual(result.renamed, [
        { from: 'Deep / Dub', to: 'Deep - Dub' },
        { from: 'a%%b', to: 'a-b' },
    ]);
    assert.deepEqual(result.crateFiles, ['Deep - Dub%%a-b.crate']);
    const keys = readCrateTree(writeSerato).map((n) => nodeKey(n.components));
    assert.ok(keys.includes('Deep - Dub / a-b'), 'the renamed crate parses back as one branch');
    console.log('  writing: a name that cannot be a filename is renamed and reported — OK');
}

/**
 * Serato resolves `ptrk` against the volume the `_Serato_` folder is on, so that
 * is the form it stores: no leading slash, and nothing of the volume in it.
 *
 * tserato writes `path.resolve()` instead. On the boot volume that only adds a
 * leading slash, which Serato tolerates — but on an external drive it writes
 * `/Volumes/DJ/Music/x.mp3`, which Serato resolves to
 * `/Volumes/DJ/Volumes/DJ/Music/x.mp3` and shows as an empty crate. Confirmed in
 * Serato DJ Pro against a disk image carrying all three forms.
 */
function checkPathsAreStoredSeratoStyle(): void {
    writeCrates(writeSerato, [
        {
            pathComponents: ['Stored'],
            tracks: [{ localPath: localTrack('Artist/Album/stored.mp3') }],
        },
    ]);

    const stored = ptrkOf(path.join(writeSerato, 'SubCrates', 'Stored.crate'));
    assert.ok(!stored.startsWith('/'), `Serato stores no leading slash; got ${stored}`);
    assert.equal(stored, path.join(musicRoot, 'Artist/Album/stored.mp3').replace(/^\/+/, ''));

    // The case the boot volume cannot show: a library on a mounted drive.
    assert.equal(
        storedTrackPath('/Volumes/DJ USB/_Serato_', '/Volumes/DJ USB/Music/x.mp3'),
        'Music/x.mp3',
    );
    assert.equal(volumeRootOf('/Volumes/DJ USB/_Serato_'), '/Volumes/DJ USB');
    assert.equal(volumeRootOf('/Users/someone/Music/_Serato_'), '/');

    // And it still comes back out as an absolute path for everything downstream.
    const node = readCrateTree(writeSerato).find((n) => nodeKey(n.components) === 'Stored');
    assert.deepEqual(node!.tracks, [path.join(musicRoot, 'Artist/Album/stored.mp3')]);
    console.log('  writing: track paths are stored the way Serato stores them — OK');
}

function checkWrittenCratesAgainstPyserato(): void {
    if (!fs.existsSync(PYSERATO_PYTHON)) {
        console.log(`  pyserato write cross-check: skipped (no interpreter at ${PYSERATO_PYTHON})`);
        return;
    }
    const script = `
import json, sys
from pathlib import Path
from pyserato.builder import Builder

def walk(crate, components, out):
    here = components + [crate.name]
    if crate.tracks:
        out[' / '.join(here)] = sorted(str(t.path) for t in crate.tracks)
    for child in crate.children.values():
        walk(child, here, out)
    return out

out = {}
for top in Builder().parse_crates_from_root_path(Path(sys.argv[1])).values():
    walk(top, [], out)
print(json.dumps(out))
`;
    const stdout = execFileSync(
        PYSERATO_PYTHON,
        ['-c', script, path.join(writeSerato, 'SubCrates')],
        { encoding: 'utf8' },
    );
    const fromServer: Record<string, string[]> = JSON.parse(stdout);
    const fromClient = Object.fromEntries(
        readCrateTree(writeSerato).map((n) => [nodeKey(n.components), [...n.tracks].sort()]),
    );

    // The round trip that matters: crates written here get re-imported through
    // pymix, which parses them with pyserato and keys the manifest on these exact
    // paths.
    assert.deepEqual(
        fromServer,
        fromClient,
        'pyserato must read back exactly the crates and paths that were written',
    );
    console.log(
        `  pyserato write cross-check: ${Object.keys(fromServer).length} crates agree — OK`,
    );
}

/** Every analysed mp3 under the fixture library, deepest frame sets first. */
function findAnalysedFixtures(): string[] {
    if (!fs.existsSync(ANALYSED_FIXTURES)) return [];
    return fs
        .readdirSync(ANALYSED_FIXTURES, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.mp3'))
        .map((e) => path.join(e.parentPath ?? (e as any).path, e.name));
}

function geobFrames(file: string): string[] {
    if (!fs.existsSync(PYSERATO_PYTHON)) return [];
    const script = `
import sys
from mutagen.mp3 import MP3
print("\\n".join(sorted(k[5:] for k in MP3(sys.argv[1]).keys() if k.startswith("GEOB:"))))
`;
    return execFileSync(PYSERATO_PYTHON, ['-c', script, file], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);
}

try {
    main();
} finally {
    fs.rmSync(workDir, { force: true, recursive: true });
}

/** A file for a crate to point at. writeCrates leaves out anything not on disk. */
function localTrack(relative: string): string {
    const full = path.join(musicRoot, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '');
    return full;
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

/** The first stored track path in a crate file, exactly as it sits on disk. */
function ptrkOf(cratePath: string): string {
    const buf = fs.readFileSync(cratePath);
    let i = 0;
    while (i + 8 <= buf.length) {
        const tag = buf.toString('ascii', i, i + 4);
        const length = buf.readUInt32BE(i + 4);
        if (tag === 'otrk') {
            // ptrk is the first chunk inside otrk.
            const inner = buf.subarray(i + 8, i + 8 + length);
            const innerLength = inner.readUInt32BE(4);
            return Buffer.from(inner.subarray(8, 8 + innerLength))
                .swap16()
                .toString('utf16le');
        }
        i += 8 + length;
    }
    throw new Error(`no otrk chunk in ${cratePath}`);
}

/** An mp3 real enough for mp3tag.js, after check-taglib-tagging.ts's builder. */
function synthMp3(relative: string): string {
    const full = path.join(musicRoot, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const header = Buffer.alloc(10);
    header.write('ID3', 0, 'latin1');
    header[3] = 3;
    // A 128kbps 44.1kHz mono MPEG-1 Layer III frame, followed by its 417 bytes.
    const frame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x44]), Buffer.alloc(417)]);
    fs.writeFileSync(full, Buffer.concat([header, frame, frame, frame]));
    return full;
}
