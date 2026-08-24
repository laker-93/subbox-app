import * as TagLib from 'node-taglib-sharp';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';

// ── SUBBOX_ID tag helpers ────────────────────────────────────────────────────
//
// Everything in here is deliberately free of electron imports so it can be
// exercised directly by scripts/check-taglib-tagging.ts, which pins the
// TagLib behaviour these functions work around (see openTagFile).

const SUBBOX_ID_FIELD = 'SUBBOX_ID';

// MP4/M4A files store custom tags as iTunes-style freeform atoms keyed by a
// MEAN/NAME pair (the "----:<mean>:<name>" atom). This MEAN mirrors what the
// pymix backend writes via mutagen ("----:com.apple.iTunes:SUBBOX_ID"), so a
// SUBBOX_ID written by either side is readable by the other.
const APPLE_ITUNES_MEAN = 'com.apple.iTunes';

/**
 * Return the existing SUBBOX_ID for a file, or generate a fresh UUID.
 * Returns null if the file cannot be opened by TagLib at all — it has no tag
 * structure we can read or write, so there is no way to give it an id. Callers
 * are expected to have already filtered out files still being written (see
 * `isFileSizeStable`): TagLib only needs the header at the front of the file,
 * which a partial download already has, so it cannot by itself tell "still
 * downloading" from "complete".
 * If the file is valid but writing the tag fails, the UUID is still returned so
 * the upload can proceed.
 */
export function getOrCreateSubboxId(filePath: string): null | string {
    // Validate the file is parseable before proceeding. This is not a
    // completeness check (a truncated file with an intact header parses fine);
    // that's handled by the caller via isFileSizeStable before this is ever
    // called. Nor is it an audio check — openTagFile deliberately does not
    // decode the stream, so a file only fails here if its *tags* are unreadable.
    let probe: null | TagLib.File = null;
    try {
        probe = openTagFile(filePath);
    } catch (err) {
        // Never swallow this: a null return drops the file from the upload set
        // entirely, so without a log the user's only symptom is a track that
        // never arrives (#110).
        console.error(`[subbox-id] TagLib cannot open ${filePath}:`, err);
        return null;
    } finally {
        probe?.dispose();
    }

    const existing = readSubboxId(filePath);
    if (existing) return existing;

    const newId = randomUUID();
    try {
        writeSubboxId(filePath, newId);
    } catch (err) {
        console.error(`[subbox-id] Failed to write SUBBOX_ID tag to ${filePath}:`, err);
    }
    return newId;
}

/**
 * Open a file with TagLib for reading and writing tags.
 *
 * The default `ReadStyle.Average` also decodes the audio properties, which for mp3
 * means hunting for the first MPEG sync frame within 0x400 bytes of the end of the
 * ID3v2 tag. Some files leave a larger gap than that — rewriting a tag smaller
 * routinely does it — so the hunt runs off the end and TagLib throws
 * `CorruptFileError: MPEG audio header not found` on a perfectly valid, playable
 * track. The watcher took that for corruption and dropped the file silently (#110).
 *
 * Nothing here ever reads `file.properties`, so on that specific failure we reopen
 * with `ReadStyle.None`, which skips the properties read entirely and lets the file
 * be tagged like any other. The reopen is gated on actually finding audio further
 * in: `ReadStyle.None` parses nothing, so without that gate the properties read —
 * buggy as it is for mp3 — would stop being any kind of "is this really audio"
 * check, and arbitrary junk with a .mp3 extension would sail through to the server.
 */
export function openTagFile(filePath: string): TagLib.File {
    try {
        return TagLib.File.createFromPath(filePath);
    } catch (err) {
        if (!(err instanceof TagLib.CorruptFileError)) throw err;

        const file = TagLib.File.createFromPath(filePath, undefined, TagLib.ReadStyle.None);
        // mediaStartPosition is where the tags stop and the stream is meant to begin.
        const searchStart = (file as unknown as { mediaStartPosition?: number }).mediaStartPosition;
        if (typeof searchStart === 'number' && hasMpegAudioFrame(filePath, searchStart)) {
            return file;
        }
        file.dispose();
        throw err;
    }
}

/**
 * Read the SUBBOX_ID custom tag from any audio file via node-taglib-sharp.
 * Tries each tag type present on the file in priority order:
 *   Xiph (FLAC/OGG/OPUS) → ID3v2 (MP3/WAV) → APE → ASF (WMA)
 * Returns null if the tag is absent or the file cannot be opened.
 */
export function readSubboxId(filePath: string): null | string {
    let file: null | TagLib.File = null;
    try {
        file = openTagFile(filePath);
        const types = file.tagTypes;

        if (types & TagLib.TagTypes.Xiph) {
            const xiph = file.getTag(TagLib.TagTypes.Xiph, false) as null | TagLib.XiphComment;
            const val = xiph?.getFieldFirstValue(SUBBOX_ID_FIELD);
            if (val) return val;
        }

        if (types & TagLib.TagTypes.Id3v2) {
            const id3 = file.getTag(TagLib.TagTypes.Id3v2, false) as null | TagLib.Id3v2Tag;
            if (id3) {
                const frames = id3.getFramesByClassType<TagLib.Id3v2UserTextInformationFrame>(
                    TagLib.Id3v2FrameClassType.UserTextInformationFrame,
                );
                const frame = TagLib.Id3v2UserTextInformationFrame.findUserTextInformationFrame(
                    frames,
                    SUBBOX_ID_FIELD,
                    false,
                );
                if (frame?.text[0]) return frame.text[0];
            }
        }

        if (types & TagLib.TagTypes.Ape) {
            const ape = file.getTag(TagLib.TagTypes.Ape, false) as null | TagLib.ApeTag;
            const val = ape?.getItem(SUBBOX_ID_FIELD)?.text[0];
            if (val) return val;
        }

        if (types & TagLib.TagTypes.Asf) {
            const asf = file.getTag(TagLib.TagTypes.Asf, false) as null | TagLib.AsfTag;
            const val = asf?.getDescriptorStrings(SUBBOX_ID_FIELD)[0];
            if (val) return val;
        }

        if (types & TagLib.TagTypes.Apple) {
            const apple = file.getTag(TagLib.TagTypes.Apple, false) as null | TagLib.Mpeg4AppleTag;
            const val = apple?.getFirstItunesString(APPLE_ITUNES_MEAN, SUBBOX_ID_FIELD);
            if (val) return val;
        }

        return null;
    } catch (err) {
        // A file whose SUBBOX_ID tag is genuinely present (readable by other tools
        // like ffprobe) can still fail to parse here if TagLib's ID3v2 reader is
        // stricter about the surrounding tag than the writer was — logging this is
        // the only way to distinguish "no tag" from "tag present but unreadable",
        // since both otherwise looked identical (null) and caused the file to be
        // silently treated as untagged on every scan.
        console.error(`[subbox-id] Failed to read SUBBOX_ID tag from ${filePath}:`, err);
        return null;
    } finally {
        file?.dispose();
    }
}

/**
 * Write a SUBBOX_ID custom tag to any audio file via node-taglib-sharp.
 * Uses the tag type already present on the file (Xiph > ID3v2 > APE > ASF).
 * Throws if the file cannot be opened or saved — callers decide how to handle.
 */
export function writeSubboxId(filePath: string, id: string): void {
    let file: null | TagLib.File = null;
    try {
        file = openTagFile(filePath);
        const types = file.tagTypes;

        if (types & TagLib.TagTypes.Xiph) {
            const xiph = file.getTag(TagLib.TagTypes.Xiph, true) as TagLib.XiphComment;
            xiph.setFieldAsStrings(SUBBOX_ID_FIELD, id);
        } else if (types & TagLib.TagTypes.Id3v2) {
            const id3 = file.getTag(TagLib.TagTypes.Id3v2, true) as TagLib.Id3v2Tag;
            const frames = id3.getFramesByClassType<TagLib.Id3v2UserTextInformationFrame>(
                TagLib.Id3v2FrameClassType.UserTextInformationFrame,
            );
            const existing = TagLib.Id3v2UserTextInformationFrame.findUserTextInformationFrame(
                frames,
                SUBBOX_ID_FIELD,
                false,
            );
            if (existing) {
                existing.text = [id];
            } else {
                const frame = TagLib.Id3v2UserTextInformationFrame.fromDescription(SUBBOX_ID_FIELD);
                frame.text = [id];
                id3.addFrame(frame);
            }
        } else if (types & TagLib.TagTypes.Ape) {
            const ape = file.getTag(TagLib.TagTypes.Ape, true) as TagLib.ApeTag;
            ape.setItem(TagLib.ApeTagItem.fromTextValues(SUBBOX_ID_FIELD, id));
        } else if (types & TagLib.TagTypes.Asf) {
            const asf = file.getTag(TagLib.TagTypes.Asf, true) as TagLib.AsfTag;
            asf.setDescriptorStrings([id], SUBBOX_ID_FIELD);
        } else if (types & TagLib.TagTypes.Apple) {
            // MP4/M4A: store as an iTunes freeform atom. ID3v2 (the fallback below)
            // cannot be attached to an MP4 container, so this branch is required —
            // without it, SUBBOX_ID silently never persists on .m4a files.
            const apple = file.getTag(TagLib.TagTypes.Apple, true) as TagLib.Mpeg4AppleTag;
            apple.setItunesStrings(APPLE_ITUNES_MEAN, SUBBOX_ID_FIELD, id);
        } else {
            // No recognised tag type — create an ID3v2 tag as the most portable option
            const id3 = file.getTag(TagLib.TagTypes.Id3v2, true) as TagLib.Id3v2Tag;
            const frame = TagLib.Id3v2UserTextInformationFrame.fromDescription(SUBBOX_ID_FIELD);
            frame.text = [id];
            id3.addFrame(frame);
        }

        file.save();
    } finally {
        file?.dispose();
    }
}

/**
 * True if an MPEG audio frame starts anywhere at or after `searchStart`.
 *
 * This is the same sync-word hunt TagLib does, without its 0x400-byte budget. It
 * exists purely so `openTagFile`'s fallback can still tell "valid audio TagLib
 * gave up looking for" from "not an audio file at all" — searching from the end
 * of the ID3v2 tag rather than from byte 0 keeps embedded JPEG artwork (whose
 * APP0 marker is literally `ff e0`) from reading as a false sync word.
 */
function hasMpegAudioFrame(filePath: string, searchStart: number): boolean {
    const CHUNK = 64 * 1024;
    const buffer = Buffer.alloc(CHUNK);
    let fd: null | number = null;
    try {
        fd = fs.openSync(filePath, 'r');
        let position = searchStart;
        // Carry the last 3 bytes of each chunk forward so a header straddling a
        // chunk boundary is still seen whole.
        let carry = Buffer.alloc(0);

        for (;;) {
            const read = fs.readSync(fd, buffer, 0, CHUNK, position);
            if (read === 0) return false;
            const window = Buffer.concat([carry, buffer.subarray(0, read)]);

            for (let i = 0; i + 3 < window.length; i++) {
                if (window[i] !== 0xff) continue;
                const [b1, b2] = [window[i + 1], window[i + 2]];
                if ((b1 & 0xe0) !== 0xe0) continue; // remaining sync bits
                if (((b1 >> 3) & 0x03) === 0x01) continue; // reserved MPEG version
                if (((b1 >> 1) & 0x03) === 0x00) continue; // reserved layer
                const bitrate = (b2 >> 4) & 0x0f;
                if (bitrate === 0x00 || bitrate === 0x0f) continue; // free/bad bitrate
                if (((b2 >> 2) & 0x03) === 0x03) continue; // reserved sample rate
                return true;
            }

            carry = window.subarray(Math.max(0, window.length - 3));
            position += read;
        }
    } catch {
        return false;
    } finally {
        if (fd !== null) fs.closeSync(fd);
    }
}
