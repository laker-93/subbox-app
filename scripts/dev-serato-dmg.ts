import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    CrateToWrite,
    readTrackCues,
    writeCrates,
} from '../src/main/features/core/sync/serato-crates';

// The last step of P5, and the only one subbox cannot check itself: does Serato
// DJ Pro actually resolve the paths our crate writer puts on disk?
//
// Serato reads `_Serato_` from any mounted volume, so a disk image is how to put a
// crate tree in front of it without touching the real library — it shows up as a
// separate drive beside it, and unmounting takes it away again.
//
// The image carries the same playlists three times over, differing only in the form
// of the path inside the crate. That is the whole experiment: a blank result on one
// variant means nothing on its own, but three variants side by side say which forms
// Serato accepts.
//
//   A subbox …  /Volumes/SubboxSerato/Music/…   what our writer emits today
//   B serato …  Music/…                          what Serato itself writes
//   C slash  …  /Music/…                         volume-relative, but with a leading
//                                                slash — the exact difference our
//                                                writer has on the boot volume too
//
// Needs the tracks the app downloaded: run `pnpm dev:serato-ui` first.
//
//   pnpm dev:serato-dmg

const PYMIX = process.env.PYMIX_URL ?? 'http://localhost:8002';
const SUBSONIC = process.env.SUBSONIC_URL ?? 'http://localhost:41831';
const USERNAME = process.env.SUBBOX_USER ?? 'test060826';
const PASSWORD = process.env.SUBBOX_PASSWORD ?? 'Testpass12345!';

const VOLUME = process.env.SERATO_VOLUME ?? 'SubboxSerato';
const DMG = process.env.SERATO_DMG ?? path.join(os.homedir(), 'Desktop', 'SubboxSeratoCheck.dmg');

/** Where `pnpm dev:serato-ui` left the downloaded tracks, cues and all. */
const DEV_MUSIC_DIR = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'subbox-dev',
    'music',
);

const PLAYLISTS = (process.env.PLAYLISTS ?? 'Subbox Demo / Closers,Subbox Demo / Peak Time,Techno')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** The three path forms, as they will appear inside the crates. */
const VARIANTS = [
    { name: 'A subbox', rewrite: (p: string) => p },
    { name: 'B serato', rewrite: (p: string) => p.replace(`/Volumes/${VOLUME}/`, '') },
    { name: 'C slash', rewrite: (p: string) => p.replace(`/Volumes/${VOLUME}`, '') },
];

type ExportCrate = { display_name: string; path_components: string[]; tracks: ExportTrack[] };
type ExportTrack = { relative_path: string };

let cookie = '';

/** A crate with no otrk chunks at all — a parent in a nested tree. */
const NO_TRACKS = '(no tracks)';

/** Split a crate (or an otrk body) into its tag/body chunks. */
function chunksOf(buf: Buffer): Array<{ body: Buffer; tag: string }> {
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

function encodeChunks(list: Array<{ body: Buffer; tag: string }>): Buffer {
    return Buffer.concat(
        list.map(({ body, tag }) => {
            const header = Buffer.alloc(8);
            header.write(tag, 0, 'ascii');
            header.writeUInt32BE(body.length, 4);
            return Buffer.concat([header, body]);
        }),
    );
}

/** The first track path inside a crate, as Serato will read it. */
function firstPath(cratePath: string): string {
    for (const chunk of chunksOf(fs.readFileSync(cratePath))) {
        if (chunk.tag !== 'otrk') continue;
        for (const inner of chunksOf(chunk.body)) {
            if (inner.tag === 'ptrk') return utf16beToString(inner.body);
        }
    }
    return NO_TRACKS;
}

async function main(): Promise<void> {
    assert.ok(
        fs.existsSync(DEV_MUSIC_DIR),
        `${DEV_MUSIC_DIR} not found — run "pnpm dev:serato-ui" first, so there are tracks to put on the image.`,
    );

    await pymix('/user/login', { password: PASSWORD, username: USERNAME });
    const all = await subsonicPlaylists();
    const wanted = all.filter((p) => PLAYLISTS.includes(p.name));
    assert.equal(wanted.length, PLAYLISTS.length, `found ${wanted.map((p) => p.name).join(', ')}`);

    const structure = await pymix<{ crates: ExportCrate[]; success: boolean }>('/serato/export', {
        playlistIds: wanted.map((p) => p.id),
    });
    assert.ok(structure.success);
    const crates = structure.crates.filter((c) => PLAYLISTS.includes(c.display_name));
    const sources = new Set(crates.flatMap((c) => c.tracks.map((t) => t.relative_path)));
    console.log(`${crates.length} crates, ${sources.size} distinct tracks`);

    const missing = Array.from(sources).filter(
        (rel) => !fs.existsSync(path.join(DEV_MUSIC_DIR, rel)),
    );
    assert.deepEqual(missing, [], 'every track should already be in the app music folder');

    // ── the image ───────────────────────────────────────────────────────────
    const bytes = Array.from(sources).reduce(
        (n, rel) => n + fs.statSync(path.join(DEV_MUSIC_DIR, rel)).size,
        0,
    );
    const megabytes = Math.ceil((bytes / 1_000_000) * 1.4) + 60;
    fs.rmSync(DMG, { force: true });
    console.log(`\nCreating ${megabytes} MB image at ${DMG}`);
    execFileSync('hdiutil', [
        'create',
        '-size',
        `${megabytes}m`,
        '-fs',
        'HFS+J',
        '-volname',
        VOLUME,
        '-ov',
        '-quiet',
        DMG,
    ]);
    execFileSync('hdiutil', ['attach', DMG, '-nobrowse', '-quiet']);
    const mount = `/Volumes/${VOLUME}`;
    assert.ok(fs.existsSync(mount), `${mount} should be mounted`);

    try {
        // Copies, never the originals: whatever Serato does to these files, it does
        // to the image.
        let cued = 0;
        for (const rel of sources) {
            const dest = path.join(mount, 'Music', rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(path.join(DEV_MUSIC_DIR, rel), dest);
            if ((readTrackCues(dest) ?? []).length > 0) cued += 1;
        }
        console.log(`  copied ${sources.size} tracks (${cued} of them already carrying cues)`);

        const seratoFolder = path.join(mount, '_Serato_');
        fs.mkdirSync(path.join(seratoFolder, 'SubCrates'), { recursive: true });

        // Variant A is written by the app's own writer, against paths that exist on
        // the mounted volume — this is the artefact under test, not a reproduction
        // of it. B and C are then derived from what it wrote.
        const toWrite: CrateToWrite[] = crates.map((crate) => ({
            pathComponents: [VARIANTS[0].name, ...crate.path_components],
            tracks: crate.tracks.map((t) => ({
                localPath: path.join(mount, 'Music', t.relative_path),
            })),
        }));
        const written = writeCrates(seratoFolder, toWrite);
        assert.deepEqual(
            written.missing,
            [],
            'the tracks were just copied, so none can be missing',
        );
        console.log(`  ${written.cratesWritten} crates written as "${VARIANTS[0].name} …"`);

        const subCrates = path.join(seratoFolder, 'SubCrates');
        for (const variant of VARIANTS.slice(1)) {
            for (const file of fs.readdirSync(subCrates)) {
                if (!file.startsWith(`${VARIANTS[0].name}`)) continue;
                const renamed = file.replace(VARIANTS[0].name, variant.name);
                fs.writeFileSync(
                    path.join(subCrates, renamed),
                    rewritePaths(fs.readFileSync(path.join(subCrates, file)), variant.rewrite),
                );
            }
            console.log(`  same crates re-emitted as "${variant.name} …"`);
        }

        // Print one real track path per variant — the parent crates a nested tree
        // needs are structure only, and hold no tracks to show.
        for (const variant of VARIANTS) {
            for (const file of fs
                .readdirSync(subCrates)
                .filter((f) => f.startsWith(variant.name))) {
                const first = firstPath(path.join(subCrates, file));
                if (first !== NO_TRACKS) {
                    console.log(`\n  ${variant.name}  ${file}\n    ptrk: ${first}`);
                    break;
                }
            }
        }
    } finally {
        execFileSync('hdiutil', ['detach', mount, '-quiet']);
    }

    console.log(`\nImage ready: ${DMG}`);
    console.log('Quit Serato, open the image, then start Serato — it appears as its own drive.');
}

async function pymix<T>(pathname: string, body: unknown): Promise<T> {
    const res = await fetch(`${PYMIX}${pathname}`, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        method: 'POST',
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
}

/** Rewrite every track path in a crate, leaving the rest of the file byte-identical. */
function rewritePaths(crate: Buffer, rewrite: (p: string) => string): Buffer {
    return encodeChunks(
        chunksOf(crate).map((chunk) => {
            if (chunk.tag !== 'otrk') return chunk;
            return {
                body: encodeChunks(
                    chunksOf(chunk.body).map((inner) =>
                        inner.tag === 'ptrk'
                            ? {
                                  body: stringToUtf16be(rewrite(utf16beToString(inner.body))),
                                  tag: 'ptrk',
                              }
                            : inner,
                    ),
                ),
                tag: 'otrk',
            };
        }),
    );
}

function stringToUtf16be(value: string): Buffer {
    return Buffer.from(value, 'utf16le').swap16();
}

async function subsonicPlaylists(): Promise<Array<{ id: string; name: string }>> {
    const url =
        `${SUBSONIC}/rest/getPlaylists?u=${encodeURIComponent(USERNAME)}` +
        `&p=${encodeURIComponent(PASSWORD)}&v=1.16.1&c=serato-dmg&f=json`;
    const body = (await (await fetch(url)).json()) as any;
    return body['subsonic-response']?.playlists?.playlist ?? [];
}

function utf16beToString(body: Buffer): string {
    return Buffer.from(body).swap16().toString('utf16le');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
