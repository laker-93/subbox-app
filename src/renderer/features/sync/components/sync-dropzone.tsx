import { type DragEvent, useCallback, useRef, useState } from 'react';

import { formatBytes, SyncStorageExceeded } from '/@/renderer/features/sync/components/shared';
import {
    cancelDropRun,
    clearDropRun,
    isDropRunActive,
    startDropUpload,
    useDropRun,
} from '/@/renderer/features/sync/store/drop-upload-store';
import {
    type CollectedDrop,
    collectFromDataTransfer,
    collectFromFileList,
    DROP_AUDIO_EXTENSIONS,
    type SkippedFile,
} from '/@/renderer/features/sync/utils/collect-dropped-files';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

const ACCEPT = DROP_AUDIO_EXTENSIONS.map((ext) => `.${ext}`).join(',');
const SHOWN_NAMES = 8;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A list of files with what went wrong for each, cut short past a few. */
const FileList = ({ files }: { files: SkippedFile[] | string[] }) => {
    const rows = files.slice(0, SHOWN_NAMES);
    return (
        <Stack gap={2}>
            {rows.map((f) => {
                const row = typeof f === 'string' ? { reason: '', relativePath: f } : f;
                return (
                    <Text c="dimmed" key={row.relativePath} size="xs">
                        {row.relativePath}
                        {row.reason && ` — ${row.reason}`}
                    </Text>
                );
            })}
            {files.length > SHOWN_NAMES && (
                <Text c="dimmed" size="xs">
                    and {files.length - SHOWN_NAMES} more
                </Text>
            )}
        </Stack>
    );
};

/**
 * Drop files or a folder, or pick them, and they upload into the library (#293).
 *
 * The one way in that works in the web player as well as the desktop app, and that
 * needs no Rekordbox, Serato or folder to watch.
 */
export const SyncDropzone = () => {
    const run = useDropRun();
    const active = isDropRunActive(run);
    const [dragging, setDragging] = useState(false);
    const [collecting, setCollecting] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const folderInput = useRef<HTMLInputElement>(null);

    const start = useCallback((collected: CollectedDrop) => {
        void startDropUpload(collected.files, collected.skipped);
    }, []);

    const onDrop = useCallback(
        async (e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setDragging(false);
            if (active) return;
            setCollecting(true);
            try {
                start(await collectFromDataTransfer(e.dataTransfer));
            } finally {
                setCollecting(false);
            }
        },
        [active, start],
    );

    const onDragOver = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = active ? 'none' : 'copy';
        if (!active) setDragging(true);
    };

    const onPicked = (input: HTMLInputElement | null) => {
        if (!input) return;
        const collected = collectFromFileList(input.files);
        // Cleared so picking the same files again still fires a change.
        input.value = '';
        start(collected);
    };

    if (run?.phase === 'storage') {
        return (
            <SyncStorageExceeded
                error={run.error}
                onBack={clearDropRun}
                storageInfo={run.storageInfo}
            />
        );
    }

    const finished = run && !active;
    const uploadPercent = run?.bytesTotal ? (run.bytesUploaded / run.bytesTotal) * 100 : 0;

    return (
        <Stack gap="sm">
            <Text fw={600} size="lg">
                Drop Files
            </Text>
            <Text c="dimmed" size="sm">
                Drop audio files or a folder here to add them to your library. Sub-box tags the copy
                it keeps; the files on this device aren’t changed, so if you later upload the same
                tracks from Rekordbox or Serato they may show up twice.
            </Text>

            <div
                data-testid="sync-dropzone"
                onDragLeave={() => setDragging(false)}
                onDragOver={onDragOver}
                onDrop={onDrop}
                style={{
                    alignItems: 'center',
                    background: dragging ? 'var(--theme-colors-surface)' : undefined,
                    border: `2px dashed ${dragging ? 'var(--theme-colors-primary)' : 'var(--theme-colors-border)'}`,
                    borderRadius: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    opacity: active ? 0.6 : 1,
                    padding: '24px 16px',
                    textAlign: 'center',
                }}
            >
                {collecting ? <Spinner /> : <Icon icon="upload" size="2rem" />}
                <Text size="sm">
                    {active ? 'An upload is running' : 'Drop audio files or a folder here'}
                </Text>
                <Group gap="xs" justify="center">
                    <Button
                        disabled={active}
                        onClick={() => fileInput.current?.click()}
                        size="xs"
                        variant="default"
                    >
                        Choose Files
                    </Button>
                    <Button
                        disabled={active}
                        onClick={() => folderInput.current?.click()}
                        size="xs"
                        variant="subtle"
                    >
                        Choose Folder
                    </Button>
                </Group>
                <Text c="dimmed" size="xs">
                    {DROP_AUDIO_EXTENSIONS.join(', ')}
                </Text>
                <input
                    accept={ACCEPT}
                    data-testid="sync-dropzone-files"
                    hidden
                    multiple
                    onChange={(e) => onPicked(e.currentTarget)}
                    ref={fileInput}
                    type="file"
                />
                <input
                    data-testid="sync-dropzone-folder"
                    hidden
                    onChange={(e) => onPicked(e.currentTarget)}
                    ref={folderInput}
                    type="file"
                    // Not in React's input typings, but every engine we ship to has it.
                    {...({ webkitdirectory: '' } as object)}
                />
            </div>

            {run && (
                <Stack data-testid="sync-dropzone-status" gap="xs">
                    {run.phase === 'checking' && (
                        <Group gap="xs">
                            <Spinner size={14} />
                            <Text size="sm">Getting ready…</Text>
                        </Group>
                    )}
                    {run.phase === 'uploading' && (
                        <>
                            <Text size="sm">
                                Uploading {run.uploaded}/{run.total} ·{' '}
                                {formatBytes(run.bytesUploaded)} of {formatBytes(run.bytesTotal)} (
                                {Math.floor(uploadPercent)}%)
                            </Text>
                            {run.activeFiles.map((name) => (
                                <Text c="dimmed" key={name} size="xs">
                                    {name}
                                </Text>
                            ))}
                            <Group>
                                <Button onClick={cancelDropRun} size="xs" variant="subtle">
                                    Stop
                                </Button>
                            </Group>
                        </>
                    )}
                    {run.phase === 'staging' && (
                        <Group gap="xs">
                            <Spinner size={14} />
                            <Text size="sm">
                                Uploaded {plural(run.uploaded, 'file')}. Waiting for Sub-box to
                                start importing…
                            </Text>
                        </Group>
                    )}
                    {run.phase === 'importing' && (
                        <Group gap="xs">
                            <Spinner size={14} />
                            <Text size="sm">
                                Importing: {run.imported.length}/{run.uploaded} in your library so
                                far…
                            </Text>
                        </Group>
                    )}
                    {run.phase === 'done' && (
                        <Text c="green" size="sm">
                            {run.imported.length
                                ? `${plural(run.imported.length, 'track')} added to your library.`
                                : 'Nothing to upload.'}
                        </Text>
                    )}
                    {run.phase === 'cancelled' && (
                        <Text size="sm">
                            Stopped. The {plural(run.uploaded, 'file')} already uploaded will still
                            be imported.
                        </Text>
                    )}
                    {run.phase === 'error' && (
                        <Stack gap={4}>
                            {run.error && (
                                <Text c="red" size="sm">
                                    {run.error}
                                </Text>
                            )}
                            {run.imported.length > 0 && (
                                <Text c="green" size="sm">
                                    {plural(run.imported.length, 'track')} added to your library.
                                </Text>
                            )}
                            {run.notImported.length > 0 && (
                                <>
                                    <Text c="red" size="sm">
                                        {plural(run.notImported.length, 'uploaded track')}{' '}
                                        {run.notImported.length === 1 ? 'has' : 'have'} not reached
                                        your library:
                                    </Text>
                                    <FileList files={run.notImported} />
                                </>
                            )}
                        </Stack>
                    )}

                    {run.uploadFailed.length > 0 && (
                        <>
                            <Text c="red" size="sm">
                                {plural(run.uploadFailed.length, 'file')} couldn’t be uploaded:
                            </Text>
                            <FileList files={run.uploadFailed} />
                        </>
                    )}
                    {run.skipped.length > 0 && (
                        <>
                            <Text c="yellow" size="sm">
                                Skipped {plural(run.skipped.length, 'file')}:
                            </Text>
                            <FileList files={run.skipped} />
                        </>
                    )}
                    {finished && (
                        <Group>
                            <Button onClick={clearDropRun} size="xs" variant="subtle">
                                Clear
                            </Button>
                        </Group>
                    )}
                </Stack>
            )}
        </Stack>
    );
};
