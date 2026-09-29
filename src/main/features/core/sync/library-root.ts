import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Library roots: a folder of the user's own music, often kept in a cloud drive
 * (OneDrive, iCloud Drive) that leaves files cloud-only until something reads them.
 * docs/design-library-roots.md in subbox-workspace.
 *
 * The one rule this file exists for: **nothing here opens a file.** Opening a
 * cloud-only placeholder makes the cloud drive download it, and pointed at a whole
 * library that is the worst thing subbox could do on a machine with no room for it.
 * Placeholder state is read from what directory enumeration and stat already
 * report -- file attributes on Windows, st_flags on macOS -- neither of which Node's
 * fs exposes, so it comes from a child process (measured in the stage 0 spike,
 * subbox-app#166: 40/40 classified, nothing hydrated). Everything platform-specific
 * is behind listFileStates so a native helper can replace the child later.
 */

export interface LibraryRootEntry {
    /** Relative to the root, always '/'-separated: one value valid on every OS. */
    relpath: string;
    state: PlaceholderState;
}

export type LibraryRootScan =
    | {
          cloudOnly: number;
          entries: LibraryRootEntry[];
          local: number;
          ms: number;
          status: 'ok';
      }
    // Not "empty": an unmounted external drive must never read as "every track
    // deleted", or a later download plan would fetch the whole library again.
    | { reason: string; status: 'unavailable' };

export type PlaceholderState = 'cloud-only' | 'local';

export const LIBRARY_ROOTS_SETTING = 'library_roots';

export const AUDIO_EXTENSIONS = new Set([
    '.aac',
    '.flac',
    '.m4a',
    '.mp3',
    '.ogg',
    '.opus',
    '.wav',
    '.wma',
]);

// Windows: OneDrive sets RECALL_ON_DATA_ACCESS on a cloud-only file and never
// OFFLINE (spike, §11), but OFFLINE is what other providers have used for the same
// thing, so either one means "reading this downloads it".
const FILE_ATTRIBUTE_OFFLINE = 0x1000;
const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x400000;
// macOS: a dataless file (iCloud Drive, File Provider-based OneDrive).
const SF_DATALESS = 0x40000000;

const SCAN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The key a path is compared by, so a path built by Node's path.join and the same
 * path printed by a child process match. Case-insensitive on Windows, as NTFS is.
 */
export function pathKey(filePath: string): string {
    const normalized = path.normalize(filePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function classify(bits: number): PlaceholderState {
    if (process.platform === 'win32') {
        return bits & (FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS | FILE_ATTRIBUTE_OFFLINE)
            ? 'cloud-only'
            : 'local';
    }
    return bits & SF_DATALESS ? 'cloud-only' : 'local';
}

/**
 * Skipped by every walk here: hidden folders (.Spotlight-V100, .fseventsd, often
 * unreadable) and AppleDouble '._' files, which macOS writes beside every file on an
 * exFAT/FAT drive -- `._track.mp3` is metadata, not a track.
 */
function isHiddenName(name: string): boolean {
    return name.startsWith('.');
}

// One PowerShell child for the whole tree -- the enumeration the spike measured
// (~515 ms of start-up, paid once per scan). Recurses by hand rather than with
// EnumerateFiles(AllDirectories): on .NET Framework that throws on the first
// unreadable folder and abandons the rest, and it follows junctions, which can loop.
// Attributes come from the enumeration record; no file is opened.
const PS_SCRIPT = [
    "$ProgressPreference = 'SilentlyContinue'",
    '$w = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object System.Text.UTF8Encoding $false), 65536)',
    '$stack = New-Object System.Collections.Stack',
    '$stack.Push((New-Object System.IO.DirectoryInfo $env:SUBBOX_SCAN_ROOT))',
    'while ($stack.Count -gt 0) {',
    '  $d = $stack.Pop()',
    '  try {',
    '    foreach ($i in $d.EnumerateFileSystemInfos()) {',
    "      if ($i.Name.StartsWith('.')) { continue }",
    '      $a = [int]$i.Attributes',
    // A folder that is a reparse point is a junction or symlink: not followed.
    '      if ($a -band 0x10) { if (-not ($a -band 0x400)) { $stack.Push($i) } }',
    "      else { $w.Write($a.ToString('x')); $w.Write([char]9); $w.Write($i.FullName); $w.Write([char]10) }",
    '    }',
    '  } catch { }',
    '}',
    '$w.Flush()',
].join('\n');

/**
 * Which of `filePaths` are cloud-only, as pathKey()s -- for a caller holding a list
 * of files rather than a folder (Serato crate entries, a watch folder's pass). Stat
 * only, as findCloudOnlyFiles. A path that isn't there is simply not in the result.
 * Throws if the check fails.
 */
export async function findCloudOnlyAmong(filePaths: string[]): Promise<Set<string>> {
    const cloudOnly = new Set<string>();
    if (filePaths.length === 0) return cloudOnly;
    if (process.platform !== 'darwin' && process.platform !== 'win32') return cloudOnly;
    const resolved = Array.from(new Set(filePaths.map((p) => path.resolve(p))));
    const states =
        process.platform === 'win32' ? await statWindows(resolved) : await statMac(resolved);
    for (const [filePath, state] of states) {
        if (state === 'cloud-only') cloudOnly.add(pathKey(filePath));
    }
    return cloudOnly;
}

/**
 * The files under `dir` that must not be opened, as pathKey()s. For guarding the
 * scans that do open files (TagLib, music-metadata). Empty where there are no
 * placeholders to find, without walking anything.
 */
export async function findCloudOnlyFiles(dir: string): Promise<Set<string>> {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return new Set();
    const cloudOnly = new Set<string>();
    for (const [filePath, state] of await listFileStates(dir)) {
        if (state === 'cloud-only') cloudOnly.add(pathKey(filePath));
    }
    return cloudOnly;
}

/**
 * Every file under `root` with its placeholder state, keyed by absolute path, found
 * without opening any of them. Throws if the platform's enumeration fails -- callers
 * decide whether that means "stop" or "carry on as before".
 */
export async function listFileStates(root: string): Promise<Map<string, PlaceholderState>> {
    const resolved = path.resolve(root);
    switch (process.platform) {
        case 'darwin':
            return listMac(resolved);
        case 'win32':
            return listWindows(resolved);
        default:
            return listPlain(resolved);
    }
}

/**
 * Inventory a library root: each audio file's root-relative path and whether it is
 * on this device or only in the cloud. Opens nothing. A root that isn't there (an
 * unmounted drive, a renamed folder) is `unavailable`, never an empty library.
 */
export async function scanLibraryRoot(root: string): Promise<LibraryRootScan> {
    const resolved = path.resolve(root);
    try {
        if (!fs.statSync(resolved).isDirectory()) {
            return { reason: 'Not a folder', status: 'unavailable' };
        }
    } catch {
        return { reason: 'Folder not found. Is the drive connected?', status: 'unavailable' };
    }

    const started = Date.now();
    let states: Map<string, PlaceholderState>;
    try {
        states = await listFileStates(resolved);
    } catch (error) {
        console.error('[library-root] scan failed', error);
        return {
            reason: `Couldn't tell which files are cloud-only: ${(error as Error).message}`,
            status: 'unavailable',
        };
    }

    const entries: LibraryRootEntry[] = [];
    let local = 0;
    let cloudOnly = 0;
    for (const [filePath, state] of states) {
        if (!AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) continue;
        const relpath = path.relative(resolved, filePath);
        // Outside the root (a child printing something unexpected): never report it.
        if (!relpath || relpath.startsWith('..') || path.isAbsolute(relpath)) continue;
        // NFC: macOS hands back decomposed names, Windows composed ones, and this
        // value has to be the same string on both.
        entries.push({ relpath: relpath.split(path.sep).join('/').normalize('NFC'), state });
        if (state === 'local') local += 1;
        else cloudOnly += 1;
    }
    entries.sort((a, b) => a.relpath.localeCompare(b.relpath));

    const ms = Date.now() - started;
    console.log(
        `[library-root] ${resolved}: ${entries.length} audio files (${local} local, ${cloudOnly} cloud-only) in ${ms} ms`,
    );
    return { cloudOnly, entries, local, ms, status: 'ok' };
}

async function listMac(root: string): Promise<Map<string, PlaceholderState>> {
    // stat(1) reads st_flags with lstat -- it never opens the file, so a dataless
    // file stays dataless. `+` batches many paths per stat process.
    const { code, stderr, stdout } = await runChild('/usr/bin/find', [
        root,
        '-mindepth',
        '1',
        '(',
        '-type',
        'd',
        '-name',
        '.*',
        '-prune',
        ')',
        '-o',
        '-type',
        'f',
        '-exec',
        '/usr/bin/stat',
        '-f',
        '%Xf%t%N',
        '{}',
        '+',
    ]);
    // find exits 1 when some folder was unreadable but still prints everything else;
    // that is today's behaviour for an unreadable folder (skip it), not a failure.
    if (code !== 0 && code !== 1) {
        throw new Error(`placeholder scan failed (${code}): ${stderr.slice(0, 500)}`);
    }
    return parseTabLines(stdout);
}

function listPlain(root: string): Map<string, PlaceholderState> {
    // No placeholder mechanism we know of (Linux): every file is local, and a plain
    // walk is all it takes.
    const states = new Map<string, PlaceholderState>();
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (isHiddenName(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (entry.isFile()) states.set(full, 'local');
        }
    }
    return states;
}

async function listWindows(root: string): Promise<Map<string, PlaceholderState>> {
    // -EncodedCommand is not a script file, so execution policy doesn't apply to it.
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    const { code, stderr, stdout } = await runChild(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        { ...process.env, SUBBOX_SCAN_ROOT: root },
    );
    if (code !== 0) throw new Error(`placeholder scan failed (${code}): ${stderr.slice(0, 500)}`);
    return parseTabLines(stdout);
}

function parseTabLines(stdout: string): Map<string, PlaceholderState> {
    const states = new Map<string, PlaceholderState>();
    for (const line of stdout.split('\n')) {
        const tab = line.indexOf('\t');
        if (tab < 0) continue;
        const bits = parseInt(line.slice(0, tab), 16);
        const filePath = line.slice(tab + 1).replace(/\r$/, '');
        if (Number.isNaN(bits) || !filePath) continue;
        if (isHiddenName(path.basename(filePath))) continue;
        states.set(filePath, classify(bits));
    }
    return states;
}

function runChild(
    command: string,
    args: string[],
    env?: NodeJS.ProcessEnv,
): Promise<{ code: null | number; stderr: string; stdout: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { env: env ?? process.env, windowsHide: true });
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`${command} timed out after ${SCAN_TIMEOUT_MS / 1000}s`));
        }, SCAN_TIMEOUT_MS);
        child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({
                code,
                stderr: Buffer.concat(err).toString('utf8'),
                stdout: Buffer.concat(out).toString('utf8'),
            });
        });
    });
}

async function statMac(filePaths: string[]): Promise<Map<string, PlaceholderState>> {
    const states = new Map<string, PlaceholderState>();
    // Chunked to stay far below ARG_MAX however long the paths are.
    for (let i = 0; i < filePaths.length; i += 200) {
        const { code, stderr, stdout } = await runChild('/usr/bin/stat', [
            '-f',
            '%Xf%t%N',
            ...filePaths.slice(i, i + 200),
        ]);
        // 1 = some path wasn't there; the rest are still printed.
        if (code !== 0 && code !== 1) {
            throw new Error(`placeholder check failed (${code}): ${stderr.slice(0, 500)}`);
        }
        for (const [filePath, state] of parseTabLines(stdout)) states.set(filePath, state);
    }
    return states;
}

// The list goes in a UTF-8 file rather than on the command line (length) or stdin
// (Windows PowerShell's console input encoding). GetAttributes reads metadata only.
const PS_STAT_SCRIPT = [
    "$ProgressPreference = 'SilentlyContinue'",
    '$w = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object System.Text.UTF8Encoding $false), 65536)',
    'foreach ($p in [System.IO.File]::ReadAllLines($env:SUBBOX_STAT_LIST, [System.Text.Encoding]::UTF8)) {',
    '  try {',
    '    $a = [int][System.IO.File]::GetAttributes($p)',
    "    $w.Write($a.ToString('x')); $w.Write([char]9); $w.Write($p); $w.Write([char]10)",
    '  } catch { }',
    '}',
    '$w.Flush()',
].join('\n');

async function statWindows(filePaths: string[]): Promise<Map<string, PlaceholderState>> {
    const listFile = path.join(os.tmpdir(), `subbox-stat-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(listFile, filePaths.join('\n'), 'utf8');
    try {
        const encoded = Buffer.from(PS_STAT_SCRIPT, 'utf16le').toString('base64');
        const { code, stderr, stdout } = await runChild(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
            { ...process.env, SUBBOX_STAT_LIST: listFile },
        );
        if (code !== 0) {
            throw new Error(`placeholder check failed (${code}): ${stderr.slice(0, 500)}`);
        }
        return parseTabLines(stdout);
    } finally {
        fs.rmSync(listFile, { force: true });
    }
}
