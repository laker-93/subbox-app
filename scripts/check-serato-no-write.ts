import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { isAtOrUnderRoot } from '../src/main/features/core/sync/library-root';
import {
    byLocationBody,
    identifyCrateTrack,
    mintSubboxId,
    needsTaggedCopy,
    sendableSize,
    withTaggedFile,
} from '../src/main/features/core/sync/serato-identity';
import { readSubboxId, writeSubboxId } from '../src/main/features/core/sync/subbox-id-tags';

// The Serato import never writes into the user's files (#214 point 12, #221): it
// reads a file's SUBBOX_ID or mints one in memory, finds a re-import by path (and
// by the path under the library root, pymix#252), and uploads an untagged file
// from a tagged temp copy that is then deleted. Plus the Watch folder warning's
// rule (#221 point 4).
//
// Usage: pnpm run check:serato-no-write

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serato-no-write-check-'));

/** What "unchanged" means for the drive (#221): the same bytes and mtime. */
function fingerprint(p: string): string {
    const st = fs.statSync(p);
    return `${createHash('sha256').update(fs.readFileSync(p)).digest('hex')}@${st.mtimeMs}`;
}

/** One silent MPEG-1 Layer III frame, as in check-taglib-tagging.ts. */
function mpegFrame(): Buffer {
    const frame = Buffer.alloc(417);
    frame.writeUInt32BE(0xfffb9000, 0);
    return frame;
}

/** A tagless mp3 TagLib can open. */
function write(name: string): string {
    const filePath = path.join(workDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.concat([mpegFrame(), mpegFrame(), mpegFrame()]));
    return filePath;
}

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function main(): Promise<void> {
    // ── mintSubboxId: the same id every time, for the same user and file ─────
    const same = (p: string) => p;
    const a = mintSubboxId('dj', '/Music/a.mp3', same);
    assert.match(a, UUID_V5);
    assert.equal(mintSubboxId('dj', '/Music/a.mp3', same), a, 'a retry mints the same id');
    assert.notEqual(mintSubboxId('dj', '/Music/b.mp3', same), a, 'another file, another id');
    assert.notEqual(mintSubboxId('other', '/Music/a.mp3', same), a, 'another user, another id');
    // NFD and NFC spellings of one name are one file on macOS, so one id.
    assert.equal(
        mintSubboxId('dj', '/Music/Beyonce\u0301.mp3', same),
        mintSubboxId('dj', '/Music/Beyonc\u00e9.mp3', same),
    );
    // Its real path is what's hashed: two spellings the disk resolves to one file.
    const real = () => '/Music/A.mp3';
    assert.equal(
        mintSubboxId('dj', '/music/a.mp3', real),
        mintSubboxId('dj', '/Music/A.mp3', real),
    );
    // A path realpath can't resolve is hashed as given.
    const gone = () => {
        throw new Error('ENOENT');
    };
    assert.equal(mintSubboxId('dj', '/Music/a.mp3', gone), a);

    // ── identifyCrateTrack: reads, never writes ────────────────────────────
    const untagged = write('lib/House/untagged.mp3');
    const tagged = write('lib/House/tagged.mp3');
    writeSubboxId(tagged, 'sid-from-an-earlier-import');
    const before = { tagged: fingerprint(tagged), untagged: fingerprint(untagged) };

    const minted = identifyCrateTrack(untagged, 'dj');
    assert.ok(minted);
    assert.equal(minted.fileTag, null);
    assert.equal(minted.subboxId, mintSubboxId('dj', untagged));
    assert.equal(needsTaggedCopy(minted), true);
    assert.equal(readSubboxId(untagged), null, 'the untagged file is not tagged');

    // A file tagged by an earlier import keeps its tag and is recognised by it.
    const kept = identifyCrateTrack(tagged, 'dj');
    assert.deepEqual(kept, {
        fileTag: 'sid-from-an-earlier-import',
        subboxId: 'sid-from-an-earlier-import',
    });
    assert.equal(needsTaggedCopy(kept!), false);

    // Adopted: the library knows the file by path under another id. Its bytes,
    // were it ever sent, would need that id, so it counts as needing a copy.
    assert.equal(needsTaggedCopy({ ...kept!, subboxId: 'sid-library' }), true);

    // A file TagLib can't open can't be identified, as before.
    assert.equal(identifyCrateTrack(untagged, 'dj', { canOpen: () => false }), null);

    // ── byLocationBody: relative paths only with a root (pymix#252) ─────────
    const paths = ['/Lib/House/a.mp3', '/Elsewhere/b.mp3'];
    assert.deepEqual(byLocationBody(paths, null, 'darwin'), { user_locations: paths });
    assert.deepEqual(byLocationBody(paths, '/Lib', 'darwin'), {
        root_relative_paths: ['House/a.mp3', null],
        user_locations: paths,
    });
    assert.deepEqual(byLocationBody(['C:\\Lib\\House\\a.mp3'], 'C:\\Lib', 'win32'), {
        root_relative_paths: ['House/a.mp3'],
        user_locations: ['C:\\Lib\\House\\a.mp3'],
    });

    // ── withTaggedFile: a tagged temp copy, deleted afterwards ────────────────
    const tmpDir = fs.mkdtempSync(path.join(workDir, 'tmp-'));
    let sentPath = '';
    let sentId: null | string = null;
    await withTaggedFile({ filePath: untagged, identity: minted, tmpDir }, async (p) => {
        sentPath = p;
        sentId = readSubboxId(p);
    });
    assert.notEqual(sentPath, untagged, 'an untagged file is sent from a copy');
    assert.equal(path.dirname(sentPath), tmpDir);
    assert.equal(path.extname(sentPath), '.mp3');
    assert.equal(sentId, minted.subboxId, 'the copy carries the id');
    assert.equal(fs.existsSync(sentPath), false, 'the copy is deleted on success');

    // Deleted on failure too, and the failure still surfaces.
    await assert.rejects(
        withTaggedFile({ filePath: untagged, identity: minted, tmpDir }, async (p) => {
            sentPath = p;
            throw new Error('upload failed');
        }),
        /upload failed/,
    );
    assert.equal(fs.existsSync(sentPath), false, 'the copy is deleted on failure');

    // And when writing the tag into the copy fails.
    await assert.rejects(
        withTaggedFile(
            {
                filePath: untagged,
                identity: minted,
                tmpDir,
                writeId: () => {
                    throw new Error('tag write failed');
                },
            },
            async () => assert.fail('nothing is sent without the tag'),
        ),
        /tag write failed/,
    );
    assert.deepEqual(fs.readdirSync(tmpDir), [], 'nothing left in the temp folder');

    // A file that already carries its id is sent as it is: no copy.
    await withTaggedFile({ filePath: tagged, identity: kept!, tmpDir }, async (p) => {
        sentPath = p;
    });
    assert.equal(sentPath, tagged);

    // The size compared against a staged upload is the copy's, which is not the
    // user's file's: the tag adds to it. Deterministic, so a retry matches.
    const copySize = await sendableSize({ filePath: untagged, identity: minted, tmpDir });
    assert.ok(copySize > fs.statSync(untagged).size);
    assert.equal(await sendableSize({ filePath: untagged, identity: minted, tmpDir }), copySize);
    assert.equal(
        await sendableSize({ filePath: tagged, identity: kept!, tmpDir }),
        fs.statSync(tagged).size,
    );
    assert.deepEqual(fs.readdirSync(tmpDir), []);

    // Through all of it, neither of the user's files changed.
    assert.deepEqual(
        { tagged: fingerprint(tagged), untagged: fingerprint(untagged) },
        before,
        "the user's files are unchanged",
    );

    // ── isAtOrUnderRoot: the Watch warning (#221 point 4) ───────────────────
    const mac = (root: string, dir: string) => isAtOrUnderRoot(root, dir, 'darwin');
    assert.equal(mac('/Users/dj/OneDrive/Music', '/Users/dj/OneDrive/Music'), true);
    assert.equal(mac('/Users/dj/OneDrive/Music', '/Users/dj/OneDrive/Music/'), true);
    assert.equal(mac('/Users/dj/OneDrive/Music/', '/Users/dj/OneDrive/Music/Incoming'), true);
    assert.equal(mac('/Users/dj/OneDrive/Music', '/Users/dj/Downloads'), false);
    // A sibling sharing the prefix is not inside it.
    assert.equal(mac('/Users/dj/OneDrive/Music', '/Users/dj/OneDrive/Music2'), false);
    // The root inside the watch folder is not the watch folder inside the root.
    assert.equal(mac('/Users/dj/OneDrive/Music', '/Users/dj'), false);
    const win = (root: string, dir: string) => isAtOrUnderRoot(root, dir, 'win32');
    assert.equal(
        win('C:\\Users\\dj\\OneDrive\\Music', 'c:\\users\\dj\\onedrive\\music\\new'),
        true,
    );
    assert.equal(win('C:\\Users\\dj\\OneDrive\\Music', 'D:\\Music'), false);
    assert.equal(win('C:\\Music', '/Music'), false);

    console.log(
        '✓ the Serato import reads, mints and uploads from a tagged copy; nothing is written',
    );
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => fs.rmSync(workDir, { force: true, recursive: true }));
