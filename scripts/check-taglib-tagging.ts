import * as TagLib from 'node-taglib-sharp';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    getOrCreateSubboxId,
    readSubboxId,
    writeSubboxId,
} from '../src/main/features/core/sync/subbox-id-tags';

// Regression check for #110: the watch-dir uploader silently dropped valid, playable
// mp3s whose first MPEG sync frame sits more than 0x400 bytes past the end of the
// ID3v2 tag. TagLib only hunts for that frame when it is asked for the audio
// properties, and threw CorruptFileError when the hunt failed — so the tag helpers,
// which never look at the properties, now open files with ReadStyle.None.
//
// Usage: pnpm run check:taglib-tagging

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taglib-tagging-check-'));

/**
 * A syntactically valid mp3: an ID3v2.3 tag holding one TIT2 frame, then
 * `padding` zero bytes, then a few audio frames.
 *
 * The padding is the whole point. Encoders leave it behind routinely (it is what an
 * ID3v2 tag's own padding region becomes once the tag is rewritten smaller), and it
 * is legal — a decoder just scans forward to the next sync word. TagLib's properties
 * reader gives up after 0x400 bytes.
 */
function buildMp3(padding: number, title: string, extraFrames: Buffer[] = []): Buffer {
    const titleFrame = id3Frame(
        'TIT2',
        Buffer.concat([Buffer.from([0x00]), Buffer.from(title, 'latin1')]),
    );

    // ID3v2 sizes are syncsafe: 7 bits per byte.
    const tagBody = Buffer.concat([titleFrame, ...extraFrames]);
    const header = Buffer.alloc(10);
    header.write('ID3', 0, 'latin1');
    header[3] = 3; // v2.3
    header[4] = 0;
    header[5] = 0; // no flags
    for (let i = 0; i < 4; i++) {
        header[9 - i] = (tagBody.length >> (7 * i)) & 0x7f;
    }

    return Buffer.concat([
        header,
        tagBody,
        Buffer.alloc(padding), // the gap TagLib's sync-frame search runs out of
        mpegFrame(),
        mpegFrame(),
        mpegFrame(),
    ]);
}

/** An ID3v2.3 frame: 4-char id, 4-byte plain (not syncsafe) size, 2 flag bytes, body. */
function id3Frame(id: string, body: Buffer): Buffer {
    const frame = Buffer.alloc(10 + body.length);
    frame.write(id, 0, 'latin1');
    frame.writeUInt32BE(body.length, 4);
    body.copy(frame, 10);
    return frame;
}

function main(): void {
    // ── The premise: padding past 0x400 is what breaks the default read ──────
    const paddedPath = write('padded.mp3', buildMp3(0x2000, 'Padded'));
    const normalPath = write('normal.mp3', buildMp3(0, 'Normal'));

    assert.doesNotThrow(
        () => TagLib.File.createFromPath(normalPath).dispose(),
        'a file with no padding should open even with the default ReadStyle',
    );
    assert.throws(
        () => TagLib.File.createFromPath(paddedPath).dispose(),
        /MPEG audio header not found/,
        'the padded fixture no longer reproduces the TagLib failure this guards against — ' +
            'if node-taglib-sharp fixed its sync-frame search, retire this check',
    );

    // ── The fix: the tag helpers tag it anyway ──────────────────────────────
    for (const [label, filePath] of [
        ['padded', paddedPath],
        ['normal', normalPath],
    ] as const) {
        const id = getOrCreateSubboxId(filePath);
        assert.ok(id, `${label}: getOrCreateSubboxId returned null — the file was dropped`);
        assert.equal(readSubboxId(filePath), id, `${label}: SUBBOX_ID did not survive the write`);

        // Stable across calls: a second pass must reuse the id already on disk
        // rather than mint a new one, or every poll re-uploads the same track.
        assert.equal(getOrCreateSubboxId(filePath), id, `${label}: SUBBOX_ID was not reused`);
    }

    // Tagging must not disturb what was already in the file.
    const tagged = TagLib.File.createFromPath(paddedPath, undefined, TagLib.ReadStyle.None);
    assert.equal(tagged.tag.title, 'Padded', 'the existing title was lost while tagging');
    tagged.dispose();

    // ── #275: an empty MusicBrainz UFID frame, as every Jamendo mp3 carries ──
    // Owner + NUL and no identifier bytes. TagLib reads it without complaint but
    // throws "Argument null: text was not provided" when it re-renders it on save.
    const ufidPath = write(
        'empty-ufid.mp3',
        buildMp3(0, 'Empty UFID', [
            id3Frame('UFID', Buffer.from('http://musicbrainz.org\0', 'latin1')),
        ]),
    );
    const untouched = TagLib.File.createFromPath(ufidPath);
    assert.throws(
        () => untouched.save(),
        /text was not provided/,
        'the empty-UFID fixture no longer reproduces the TagLib save failure — ' +
            'if node-taglib-sharp fixed it, retire this check',
    );
    untouched.dispose();

    const ufidId = randomUUID();
    assert.doesNotThrow(
        () => writeSubboxId(ufidPath, ufidId),
        'writeSubboxId must save a file carrying an empty UFID frame',
    );
    assert.equal(readSubboxId(ufidPath), ufidId, 'empty UFID: SUBBOX_ID did not survive the write');
    const cleaned = TagLib.File.createFromPath(ufidPath);
    assert.equal(cleaned.tag.title, 'Empty UFID', 'empty UFID: the existing title was lost');
    cleaned.dispose();

    // ── A genuinely unopenable file still returns null, and says why ─────────
    const junkPath = write('junk.mp3', Buffer.alloc(64, 0x41));
    assert.equal(
        getOrCreateSubboxId(junkPath),
        null,
        'a file with no tag structure at all should still be reported as unusable',
    );

    console.log('✓ SUBBOX_ID tagging works on mp3s TagLib cannot read audio properties from');
    console.log('✓ SUBBOX_ID tagging works on mp3s with an empty UFID frame');
}

/** One silent MPEG-1 Layer III 128kbps 44.1kHz frame: 4-byte header + zeroed body. */
function mpegFrame(): Buffer {
    const frame = Buffer.alloc(417);
    frame.writeUInt32BE(0xfffb9000, 0);
    return frame;
}

function write(name: string, contents: Buffer): string {
    const filePath = path.join(workDir, name);
    fs.writeFileSync(filePath, contents);
    return filePath;
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    fs.rmSync(workDir, { force: true, recursive: true });
}
