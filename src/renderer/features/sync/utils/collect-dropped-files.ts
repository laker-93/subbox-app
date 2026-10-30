/**
 * Turning a drop or a file picker into the list of audio files to upload.
 *
 * Shared by the web player and the desktop app, so it only uses what a browser
 * offers: `webkitGetAsEntry()` to walk a dropped folder (Chrome, Edge, Safari and
 * Electron all have it) and `webkitRelativePath` for a folder picked with the
 * folder input.
 */

/** The same list the Watch uploader accepts (`AUDIO_EXTENSIONS` in main's sync). */
export const DROP_AUDIO_EXTENSIONS = ['aac', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav', 'wma'];

export interface CollectedDrop {
    files: DroppedFile[];
    skipped: SkippedFile[];
}

export interface DroppedFile {
    file: File;
    /** Path inside the drop, `Artist/Album/track.mp3`, so the folder structure survives. */
    relativePath: string;
}

export interface SkippedFile {
    reason: string;
    relativePath: string;
}

const extensionOf = (name: string) => {
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
};

/**
 * beets drops a track with a "." path component without a word, so a hidden
 * folder's tracks would upload and then never appear. Skip them here, as Watch does,
 * and say so.
 */
const hiddenComponent = (relativePath: string) =>
    relativePath
        .split('/')
        .slice(0, -1)
        .find((part) => part.startsWith('.'));

const classify = (candidates: DroppedFile[]): CollectedDrop => {
    const files: DroppedFile[] = [];
    const skipped: SkippedFile[] = [];
    for (const candidate of candidates) {
        const name = candidate.file.name;
        // macOS litter: .DS_Store, and the ._ AppleDouble files a copy off an
        // exFAT drive leaves next to every track. Not the user's music; not worth a line.
        if (name.startsWith('.')) continue;
        const hidden = hiddenComponent(candidate.relativePath);
        if (hidden) {
            skipped.push({
                reason: `it is inside the hidden folder "${hidden}"`,
                relativePath: candidate.relativePath,
            });
        } else if (!DROP_AUDIO_EXTENSIONS.includes(extensionOf(name))) {
            skipped.push({
                reason: 'not an audio file Sub-box can import',
                relativePath: candidate.relativePath,
            });
        } else if (candidate.file.size === 0) {
            skipped.push({ reason: 'the file is empty', relativePath: candidate.relativePath });
        } else {
            files.push(candidate);
        }
    }
    return { files, skipped };
};

const readAllEntries = async (dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> => {
    const reader = dir.createReader();
    const entries: FileSystemEntry[] = [];
    // readEntries hands a folder back in batches (100 at a time in Chrome) and
    // signals the end with an empty one.
    for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
            reader.readEntries(resolve, reject),
        );
        if (batch.length === 0) return entries;
        entries.push(...batch);
    }
};

const walkEntry = async (
    entry: FileSystemEntry,
    prefix: string,
    out: DroppedFile[],
    unreadable: SkippedFile[],
) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
        try {
            const file = await new Promise<File>((resolve, reject) =>
                (entry as FileSystemFileEntry).file(resolve, reject),
            );
            out.push({ file, relativePath });
        } catch {
            unreadable.push({ reason: 'the file could not be read', relativePath });
        }
    } else if (entry.isDirectory) {
        // Don't descend into a hidden folder at all: everything in it is skipped,
        // and one line for the folder says that better than one per file.
        if (entry.name.startsWith('.')) {
            unreadable.push({
                reason: 'hidden folders are skipped',
                relativePath: `${relativePath}/`,
            });
            return;
        }
        let children: FileSystemEntry[];
        try {
            children = await readAllEntries(entry as FileSystemDirectoryEntry);
        } catch {
            unreadable.push({
                reason: 'the folder could not be read',
                relativePath: `${relativePath}/`,
            });
            return;
        }
        for (const child of children) {
            await walkEntry(child, relativePath, out, unreadable);
        }
    }
};

export const collectFromDataTransfer = async (
    dataTransfer: DataTransfer,
): Promise<CollectedDrop> => {
    // The entries have to be taken synchronously, in the drop handler's own tick:
    // the DataTransfer is emptied as soon as the event returns.
    const entries: FileSystemEntry[] = [];
    const looseFiles: File[] = [];
    for (const item of Array.from(dataTransfer.items)) {
        if (item.kind !== 'file') continue;
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
            entries.push(entry);
        } else {
            const file = item.getAsFile();
            if (file) looseFiles.push(file);
        }
    }
    if (entries.length === 0 && looseFiles.length === 0) {
        return collectFromFileList(dataTransfer.files);
    }

    const candidates: DroppedFile[] = looseFiles.map((file) => ({
        file,
        relativePath: file.name,
    }));
    const unreadable: SkippedFile[] = [];
    for (const entry of entries) {
        await walkEntry(entry, '', candidates, unreadable);
    }
    const collected = classify(candidates);
    return { files: collected.files, skipped: [...unreadable, ...collected.skipped] };
};

/** From an `<input type="file">`, with or without `webkitdirectory`. */
export const collectFromFileList = (fileList: FileList | null): CollectedDrop =>
    classify(
        Array.from(fileList ?? []).map((file) => ({
            file,
            relativePath: file.webkitRelativePath || file.name,
        })),
    );
