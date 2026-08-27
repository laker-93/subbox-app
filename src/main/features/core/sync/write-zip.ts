import * as fs from 'fs';

// ── A very small ZIP writer ─────────────────────────────────────────────────
//
// This exists for exactly one archive: `all-crates.zip`, the Serato crate bundle
// pymix reads. That archive has a hard shape requirement — every `.crate` file at
// the *root*, no directory entries — because pymix extracts it and then calls
// pyserato's `parse_crates_from_root_path`, which lists the directory with
// `iterdir()` rather than walking it. An archive whose entries sit one level down
// (what a Finder "Compress" of the SubCrates folder produces, `__MACOSX/` and all)
// parses to zero crates and the import fails with nothing pointing at the cause.
//
// Owning the writer is what makes that shape unmissable: `writeFlatZip` cannot
// express a nested entry. The alternative — a general-purpose archiver library —
// would happily produce the broken layout, and adds a dependency to build an
// archive that is only ever a handful of files of a few KB each.
//
// Entries are stored uncompressed. Crate files are tiny, and `method: 0` keeps
// this to arithmetic that is easy to check against the spec (APPNOTE 4.3.6-4.3.16).

/** Bit 11 of the general-purpose flags: the filename is UTF-8, not CP437. Serato
 *  crate names carry the user's own text, so this is not optional. */
const UTF8_NAME_FLAG = 0x0800;

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Standard CRC-32 (IEEE 802.3), the checksum every ZIP entry carries. */
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
    }
    return table;
})();

export interface ZipEntry {
    /** File contents. */
    data: Buffer;
    /** mtime to record. Purely cosmetic — pymix never reads it. */
    modified?: Date;
    /**
     * Entry name. Must be a bare filename: no `/`, no `..`, no leading dot-dot
     * games. That restriction *is* the flat-root guarantee this module exists for.
     */
    name: string;
}

/**
 * Write a ZIP whose entries all sit at the root, and return the number of bytes
 * written. Throws on any name that would nest an entry, rather than producing an
 * archive that pymix will silently parse as empty.
 */
export function writeFlatZip(zipPath: string, entries: ZipEntry[]): number {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    const seen = new Set<string>();
    let offset = 0;

    for (const entry of entries) {
        if (entry.name.includes('/') || entry.name.includes('\\') || entry.name.includes('..')) {
            throw new Error(
                `all-crates.zip entries must be bare filenames at the zip root, got "${entry.name}"`,
            );
        }
        if (seen.has(entry.name)) {
            throw new Error(`duplicate entry "${entry.name}" in ${zipPath}`);
        }
        seen.add(entry.name);

        const name = Buffer.from(entry.name, 'utf8');
        const crc = crc32(entry.data);
        const size = entry.data.length;
        const { date, time } = dosDateTime(entry.modified ?? new Date());

        const local = Buffer.alloc(30);
        local.writeUInt32LE(LOCAL_HEADER_SIG, 0);
        local.writeUInt16LE(20, 4); // version needed to extract: 2.0
        local.writeUInt16LE(UTF8_NAME_FLAG, 6);
        local.writeUInt16LE(0, 8); // method: stored
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(size, 18); // compressed size == uncompressed, stored
        local.writeUInt32LE(size, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28); // no extra field
        localParts.push(local, name, entry.data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
        central.writeUInt16LE(20, 4); // version made by
        central.writeUInt16LE(20, 6); // version needed
        central.writeUInt16LE(UTF8_NAME_FLAG, 8);
        central.writeUInt16LE(0, 10); // method: stored
        central.writeUInt16LE(time, 12);
        central.writeUInt16LE(date, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(size, 20);
        central.writeUInt32LE(size, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30); // extra length
        central.writeUInt16LE(0, 32); // comment length
        central.writeUInt16LE(0, 34); // disk number start
        central.writeUInt16LE(0, 36); // internal attributes
        central.writeUInt32LE(0, 38); // external attributes
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, name);

        offset += local.length + name.length + size;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIG, 0);
    eocd.writeUInt16LE(0, 4); // this disk
    eocd.writeUInt16LE(0, 6); // disk with the central directory
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDirectory.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20); // no archive comment

    const archive = Buffer.concat([...localParts, centralDirectory, eocd]);
    fs.writeFileSync(zipPath, archive);
    return archive.length;
}

function crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS time/date, which is all a ZIP entry has room for: 2-second resolution,
 *  local time, and nothing before 1980. */
function dosDateTime(date: Date): { date: number; time: number } {
    const year = Math.max(1980, date.getFullYear());
    return {
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    };
}
