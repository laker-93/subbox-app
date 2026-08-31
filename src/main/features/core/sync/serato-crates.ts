import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Builder, Crate, HotCue, HotCueType, Track, V2Mp3Encoder } from 'tserato';

// ── Reading a Serato library ────────────────────────────────────────────────
//
// The parts of the Serato import that only touch the filesystem. Deliberately
// free of electron imports, so scripts/check-serato-crates.ts can drive them
// directly — the crate tree and the shape of `all-crates.zip` are exactly the
// things worth pinning outside a running app, because pymix fails obscurely when
// either is wrong.

/** Where Serato keeps its library. Only ever a default — the user can pick another. */
export const DEFAULT_SERATO_FOLDER = path.join(os.homedir(), 'Music', '_Serato_');

/** pymix looks for this exact filename in the user's uploads directory. */
export const CRATE_ZIP_FILENAME = 'all-crates.zip';

export interface CrateNode {
    /** Full ancestry including this crate's own name, outermost first. */
    components: string[];
    /** `.crate` files whose contents landed in this node. */
    files: string[];
    /** Absolute track paths, in crate order, deduped. */
    tracks: string[];
}

/**
 * One crate that would become one Subsonic playlist, as the renderer sees it.
 *
 * Mirrors pymix's rule exactly: a crate becomes a playlist only if it has tracks
 * of its own, and its name is its full ancestry joined with " / ". A crate that
 * only holds child crates is a folder, and shows up here only through its
 * children.
 */
export interface CratePreview {
    /** Basenames of the `.crate` files that feed this crate. Usually one; two
     *  crates whose names differ only in a character Serato rewrites can merge. */
    files: string[];
    name: string;
    /** Ancestor crate names, outermost first. Empty for a top-level crate. */
    path: string[];
    trackCount: number;
    /** Absolute paths of this crate's tracks, so the renderer can count unique
     *  tracks across a selection rather than summing counts that overlap. */
    trackKeys: string[];
}

export interface CrateToWrite {
    /** Root first. One `.crate` file per level, which is how Serato spells a folder. */
    pathComponents: string[];
    tracks: Array<{ cues?: SeratoCueWire[]; localPath: string }>;
}

/** One cue or loop, in the shape pymix sends and receives. Positions in ms. */
export interface SeratoCueWire {
    end_ms?: null | number;
    index: number;
    name: string;
    start_ms: number;
    type: 'cue' | 'loop';
}

export interface WriteCratesResult {
    /** Where the `.crate` files that were replaced were copied first, or null if
     *  none were. The user's undo. */
    backupFolder: null | string;
    crateFiles: string[];
    cratesWritten: number;
    /** Tracks left out because the file wasn't where the download put it. */
    missing: string[];
    /** Crates whose name had to change to be a filename, so the UI can say so
     *  rather than leaving the user to find a renamed crate in Serato. */
    renamed: Array<{ from: string; to: string }>;
    tracksWritten: number;
}

// ── Writing a Serato library ────────────────────────────────────────────────
//
// pymix used to write these files. It couldn't: a `.crate` stores an absolute
// path per track and nothing else, and the server has never seen this
// filesystem, so every path in them was a prediction. Here the paths are known
// — these are the files that were just downloaded.

export function nodeKey(components: string[]): string {
    return components.join(' / ');
}

/**
 * Read every `.crate` file under `_Serato_/SubCrates` and merge them into the
 * crate tree, recording which file each node's tracks came from.
 *
 * Each file is parsed on its own, in a scratch directory, rather than parsing the
 * whole folder in one call. Two reasons, and they are the same reason: nesting is
 * encoded in the *filename* (`parent%%child.crate`), and tserato rewrites a name
 * that contains a character Serato disallows in a filename. Parsing per file is
 * the only way to know which file feeds which node without reimplementing that
 * rewrite here — and knowing that is what lets the upload zip exactly the crates
 * the user ticked.
 */
export function readCrateTree(seratoFolder: string): CrateNode[] {
    const subcrates = path.join(seratoFolder, 'SubCrates');
    if (!fs.existsSync(subcrates)) {
        throw new Error(`no SubCrates folder in ${seratoFolder} — is this a _Serato_ folder?`);
    }

    const crateFiles = fs
        .readdirSync(subcrates, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.crate'))
        .map((e) => e.name)
        .sort();

    const builder = new Builder();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'subbox-crates-'));
    // Insertion order is the on-disk order, so the preview lists crates the way
    // the folder does rather than in whatever order a hash lands them.
    const nodes = new Map<string, CrateNode>();

    try {
        for (const fileName of crateFiles) {
            const staged = path.join(scratch, fileName);
            fs.copyFileSync(path.join(subcrates, fileName), staged);
            let parsed: Map<string, Crate>;
            try {
                parsed = builder.parseCratesFromRootPath(scratch);
            } catch (err) {
                // One unreadable crate must not cost the user every other crate.
                console.warn(`[serato] could not parse ${fileName}, skipping:`, err);
                continue;
            } finally {
                fs.rmSync(staged, { force: true });
            }

            // A single file parses to a single root with a single branch; walk to
            // the end of it, collecting the names as we go.
            for (const root of parsed.values()) {
                let crate: Crate | undefined = root;
                const components: string[] = [];
                while (crate) {
                    components.push(crate.name);
                    const [child] = crate.children.values();
                    if (!child) break;
                    crate = child;
                }
                if (!crate) continue;

                const key = nodeKey(components);
                let node = nodes.get(key);
                if (!node) {
                    node = { components, files: [], tracks: [] };
                    nodes.set(key, node);
                }
                node.files.push(fileName);
                const seen = new Set(node.tracks);
                for (const track of crate.tracks) {
                    if (seen.has(track.path)) continue;
                    seen.add(track.path);
                    node.tracks.push(track.path);
                }
            }
        }
    } finally {
        fs.rmSync(scratch, { force: true, recursive: true });
    }

    // A crate with no tracks of its own is a folder, not a playlist — pymix builds
    // nothing for it, so neither do we.
    return Array.from(nodes.values()).filter((n) => n.tracks.length > 0);
}

/**
 * Resolve whatever folder the user picked to the `_Serato_` folder itself.
 *
 * Serato's own file dialogs talk about "the _Serato_ folder", but users reach for
 * the enclosing Music folder or drill all the way into SubCrates just as often.
 * Accept all three rather than rejecting two of them with a message about the
 * layout of a folder they have never had reason to look inside.
 */
export function resolveSeratoFolder(picked: string): null | string {
    const candidates = [picked, path.join(picked, '_Serato_'), path.dirname(picked)];
    for (const candidate of candidates) {
        if (fs.existsSync(path.join(candidate, 'SubCrates'))) return candidate;
    }
    return null;
}

/** Anything that would break the filename layout, and nothing else. */
// eslint-disable-next-line no-control-regex
const UNSAFE_IN_CRATE_NAME = /%%|[/\\\x00-\x1f]/g;

export interface WriteCuesResult {
    /** Files that already had cues in Serato and were left exactly as they were. */
    alreadyCued: number;
    failed: Array<{ reason: string; trackName: string }>;
    /** Non-MP3 files. Neither tserato nor pyserato has an encoder for anything else. */
    unsupported: number;
    written: number;
}

/**
 * The `.crate` files a branch of the tree occupies, root first.
 *
 * Nesting lives in the filename — `parent%%child.crate` — so this is derivable
 * rather than discoverable, and it has to be, because the files that are about
 * to be *replaced* must be known before anything is written.
 * check-serato-crates.ts asserts these are the names tserato's own save produces.
 */
export function crateFileNames(components: string[]): string[] {
    return components.map((_, i) => `${components.slice(0, i + 1).join('%%')}.crate`);
}

/**
 * Make a crate name safe to be part of a filename, changing as little as possible.
 *
 * Only the things that would break the layout are touched: the path separators,
 * the `%%` that encodes nesting, and control characters. Everything else Serato
 * is happy to display is left alone, because the crate's name *is* its filename
 * — sanitise more than necessary and the round trip renames the user's playlist.
 *
 * (tserato and pyserato both export a `sanitizeFilename` that strips everything
 * outside `[A-Za-z0-9_ ]`, and neither actually calls it when saving. Using it
 * here would rename most real crates, so this doesn't either.)
 */
export function sanitizeCrateName(name: string): string {
    return name.replace(UNSAFE_IN_CRATE_NAME, '-').trim();
}

// ── Cues ────────────────────────────────────────────────────────────────────

/**
 * A track path in the form Serato itself stores: relative to the volume the
 * `_Serato_` folder is on, with no leading slash.
 *
 * Serato resolves `ptrk` against that volume, which is what makes a library
 * portable — the same crate works whether the drive mounts at /Volumes/DJ or
 * /Volumes/DJ 1. tserato writes `path.resolve()` instead, so a library on an
 * external drive got `/Volumes/DJ/Music/x.mp3`, which Serato reads as
 * `/Volumes/DJ/Volumes/DJ/Music/x.mp3` and shows as an empty crate. On the boot
 * volume the same rule just drops the leading slash, which is what Serato writes
 * there too.
 */
export function storedTrackPath(seratoFolder: string, localPath: string): string {
    const volume = volumeRootOf(seratoFolder);
    if (volume !== '/' && (localPath === volume || localPath.startsWith(`${volume}/`))) {
        return localPath.slice(volume.length + 1);
    }
    // A track on a different volume from the library is not expressible in this
    // form; Serato does not write such crates either. Falling back to the
    // root-relative path at least keeps the boot-volume case exactly right.
    return localPath.replace(/^\/+/, '');
}

/**
 * Write crates into a `_Serato_` folder, backing up anything they replace.
 *
 * Two rules make this safe to point at a real library:
 *
 *  * a `.crate` file about to be overwritten is copied to a timestamped folder
 *    outside SubCrates first (inside it, Serato would try to read the copies);
 *  * a *parent* crate that already exists is put back afterwards. Writing
 *    `Sets / Deep` also writes `Sets.crate`, and if the user keeps tracks
 *    directly in `Sets` an empty rewrite would silently delete them.
 */
/**
 * The volume a path lives on: `/Volumes/Something` for a mounted disk, `/` otherwise.
 */
export function volumeRootOf(target: string): string {
    const match = /^(\/Volumes\/[^/]+)(\/|$)/.exec(target);
    return match ? match[1] : '/';
}

export function writeCrates(seratoFolder: string, crates: CrateToWrite[]): WriteCratesResult {
    const subcrates = path.join(seratoFolder, 'SubCrates');
    fs.mkdirSync(subcrates, { recursive: true });

    const renamed: Array<{ from: string; to: string }> = [];
    const missing: string[] = [];
    const leafFiles = new Set<string>();
    const parentFiles = new Set<string>();
    // Every branch is folded into this one tree, keyed by full ancestry, so that
    // a crate which is both a parent (has a sub-crate) and a leaf (has tracks of
    // its own) ends up as a single Crate object with both — one `save` call per
    // distinct root then writes the whole subtree in one pass. Building and
    // saving each branch separately (the previous approach) meant saving a
    // child branch re-wrote its parent's `.crate` file as an empty stub, since
    // tserato's save writes every level of whatever branch it's given.
    const nodeByKey = new Map<string, Crate>();
    const roots = new Map<string, Crate>();
    let tracksWritten = 0;

    for (const crate of crates) {
        const components = crate.pathComponents
            .map((name) => {
                const safe = sanitizeCrateName(name);
                if (safe !== name) renamed.push({ from: name, to: safe });
                return safe;
            })
            .filter((name) => name.length > 0);
        if (components.length === 0) continue;

        const files = crateFileNames(components);
        files.slice(0, -1).forEach((f) => parentFiles.add(f));
        leafFiles.add(files[files.length - 1]);

        // Walk the branch outermost-in, reusing whatever node an earlier crate
        // in this call already created for the same ancestor path.
        let parent: Crate | undefined;
        for (let i = 0; i < components.length; i += 1) {
            const key = nodeKey(components.slice(0, i + 1));
            let node = nodeByKey.get(key);
            if (!node) {
                node = new Crate(components[i]);
                nodeByKey.set(key, node);
                if (parent) parent.children.set(node.name, node);
            }
            parent = node;
        }
        const leaf = parent as Crate;
        for (const track of crate.tracks) {
            if (!fs.existsSync(track.localPath)) {
                // Nothing useful to write: a crate entry pointing at no file shows
                // in Serato as a missing track, which reads as subbox having lost it.
                missing.push(track.localPath);
                continue;
            }
            leaf.addTrack(Track.fromPath(track.localPath));
            tracksWritten += 1;
        }
        const rootKey = nodeKey([components[0]]);
        if (!roots.has(rootKey)) roots.set(rootKey, nodeByKey.get(rootKey) as Crate);
    }

    // Back up before anything is written, and only what is actually at risk.
    const atRisk = [...leafFiles, ...parentFiles].filter((f) =>
        fs.existsSync(path.join(subcrates, f)),
    );
    let backupFolder: null | string = null;
    if (atRisk.length > 0) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        // Beside SubCrates, not inside it: Serato reads every file in SubCrates.
        backupFolder = path.join(seratoFolder, `SubCrates-subbox-backup-${stamp}`);
        fs.mkdirSync(backupFolder, { recursive: true });
        for (const file of atRisk) {
            fs.copyFileSync(path.join(subcrates, file), path.join(backupFolder, file));
        }
    }

    // No encoder: the crate files only. Handing Builder an encoder makes it write
    // Markers2 into *every* track it saves, including ones whose cues we have no
    // business touching. Cues are written separately, and only where it is safe.
    const builder = new Builder();
    for (const root of roots.values()) {
        builder.save(root, seratoFolder, true);
    }

    // Serato's own path form, applied to what tserato just wrote — before the
    // untouched parents go back, so the user's own crates are never rewritten.
    for (const file of new Set([...leafFiles, ...parentFiles])) {
        const written = path.join(subcrates, file);
        if (fs.existsSync(written)) {
            rewriteCrateTrackPaths(written, (stored) => storedTrackPath(seratoFolder, stored));
        }
    }

    // Put back the parent crates that already existed. They were only rewritten
    // as a side effect of saving the branch under them.
    if (backupFolder) {
        for (const file of parentFiles) {
            if (leafFiles.has(file)) continue;
            const backedUp = path.join(backupFolder, file);
            if (fs.existsSync(backedUp)) {
                fs.copyFileSync(backedUp, path.join(subcrates, file));
            }
        }
    }

    return {
        backupFolder,
        crateFiles: [...leafFiles].sort(),
        cratesWritten: leafFiles.size,
        missing,
        renamed,
        tracksWritten,
    };
}

/** Split a crate file, or an `otrk` body, into its tag/body chunks. */
function crateChunks(buf: Buffer): Array<{ body: Buffer; tag: string }> {
    const out: Array<{ body: Buffer; tag: string }> = [];
    let i = 0;
    while (i + 8 <= buf.length) {
        const tag = buf.toString('ascii', i, i + 4);
        const length = buf.readUInt32BE(i + 4);
        out.push({ body: buf.subarray(i + 8, i + 8 + length), tag });
        i += 8 + length;
    }
    return out;
}

function encodeCrateChunks(list: Array<{ body: Buffer; tag: string }>): Buffer {
    return Buffer.concat(
        list.map(({ body, tag }) => {
            const header = Buffer.alloc(8);
            header.write(tag, 0, 'ascii');
            header.writeUInt32BE(body.length, 4);
            return Buffer.concat([header, body]);
        }),
    );
}

/**
 * Rewrite every track path in a crate file, leaving every other byte alone.
 *
 * tserato has no say in what it writes into `ptrk` — it resolves the path it is
 * given — so the correction happens on the file after it is saved rather than by
 * lying to `Track.fromPath`, which would break the existence check above it.
 */
function rewriteCrateTrackPaths(file: string, rewrite: (stored: string) => string): void {
    const rewritten = encodeCrateChunks(
        crateChunks(fs.readFileSync(file)).map((chunk) => {
            if (chunk.tag !== 'otrk') return chunk;
            return {
                body: encodeCrateChunks(
                    crateChunks(chunk.body).map((inner) =>
                        inner.tag === 'ptrk'
                            ? {
                                  body: Buffer.from(
                                      rewrite(Buffer.from(inner.body).swap16().toString('utf16le')),
                                      'utf16le',
                                  ).swap16(),
                                  tag: 'ptrk',
                              }
                            : inner,
                    ),
                ),
                tag: 'otrk',
            };
        }),
    );
    fs.writeFileSync(file, rewritten);
}

/** Serato's own limits. Past these tserato throws and Serato ignores the rest. */
const MAX_CUES = 8;
const MAX_LOOPS = 4;

/** Read the cues off a local file, or null if this file can't carry any. */
export function readTrackCues(trackPath: string): null | SeratoCueWire[] {
    if (path.extname(trackPath).toLowerCase() !== '.mp3') return null;
    try {
        return new V2Mp3Encoder().readCues(Track.fromPath(trackPath)).map((cue) => ({
            end_ms: cue.end ?? null,
            index: cue.index,
            name: cue.name,
            start_ms: cue.start,
            type: cue.type === HotCueType.LOOP ? ('loop' as const) : ('cue' as const),
        }));
    } catch (err) {
        console.warn(`[serato] could not read cues from ${path.basename(trackPath)}:`, err);
        return null;
    }
}

/**
 * Write subbox's cues into the user's own audio files.
 *
 * Only ever into a file that has *no* cues of its own. A track the user has
 * already cued in Serato is theirs, and subbox's copy of its cues is as old as
 * the last import — overwriting is how a DJ loses an evening's work with no
 * undo. The freshly downloaded track, which is what this is for, has none.
 */
export function writeTrackCues(
    tracks: Array<{ cues: SeratoCueWire[]; localPath: string }>,
): WriteCuesResult {
    const result: WriteCuesResult = { alreadyCued: 0, failed: [], unsupported: 0, written: 0 };
    const encoder = new V2Mp3Encoder();

    for (const { cues, localPath } of tracks) {
        const name = path.basename(localPath);
        if (cues.length === 0) continue;
        if (path.extname(localPath).toLowerCase() !== '.mp3') {
            result.unsupported += 1;
            continue;
        }
        try {
            const track = Track.fromPath(localPath);
            if (encoder.readCues(track).length > 0) {
                result.alreadyCued += 1;
                continue;
            }
            let nCues = 0;
            let nLoops = 0;
            for (const cue of cues) {
                const isLoop = cue.type === 'loop';
                if (isLoop ? nLoops >= MAX_LOOPS : nCues >= MAX_CUES) continue;
                track.addHotCue(
                    new HotCue({
                        end: isLoop ? (cue.end_ms ?? null) : null,
                        index: cue.index,
                        name: cue.name,
                        start: cue.start_ms,
                        type: isLoop ? HotCueType.LOOP : HotCueType.CUE,
                    }),
                );
                if (isLoop) nLoops += 1;
                else nCues += 1;
            }
            encoder.write(track);
            result.written += 1;
        } catch (err: any) {
            result.failed.push({ reason: err?.message || String(err), trackName: name });
        }
    }
    return result;
}
