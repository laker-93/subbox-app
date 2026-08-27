import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Builder, Crate } from 'tserato';

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
