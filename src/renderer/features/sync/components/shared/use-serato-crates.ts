import isElectron from 'is-electron';
import { useCallback, useEffect, useState } from 'react';

import { PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { urlConfig } from '/@/renderer/config/url-config';
import { useAppStore, useSeratoFolder, useSetSeratoFolder } from '/@/renderer/store';
import { toast } from '/@/shared/components/toast/toast';

const ipc = isElectron() ? window.api.ipc : null;
const localSettings = isElectron() ? window.api.localSettings : null;

/** localSettings key holding the user's `_Serato_` folder. Kept written as well as
 *  the store so a build without the store change still finds the folder. */
const SERATO_FOLDER_KEY = 'serato_folder';

/**
 * What `sync:write-serato-crates` reports back. The fields that are *not*
 * successes matter most: a crate whose name had to change and a track that
 * wasn't on disk both change what the user finds in Serato, and both are silent
 * unless the screen says so.
 */
export type SeratoWriteResult = {
    backupFolder: null | string;
    cratesWritten: number;
    cues: {
        alreadyCued: number;
        failed: Array<{ reason: string; trackName: string }>;
        unsupported: number;
        written: number;
    };
    missing: string[];
    renamed: Array<{ from: string; to: string }>;
    seratoFolder: string;
    tracksWritten: number;
};

/**
 * Writing playlists into the user's Serato library, for the two screens that do it.
 *
 * Both Download and External Drive end the same way: tracks land on disk, then the
 * crates are written against the paths the download actually produced. That
 * ordering is the whole reason the crate writing lives on the client — a crate
 * stores paths, and pymix could only ever guess at them.
 *
 * The folder itself is one persisted setting shared by every screen that reads it,
 * so the user browses for their `_Serato_` folder once rather than once per flow.
 */
export const useSeratoCrates = () => {
    const seratoFolder = useSeratoFolder();
    const setSeratoFolder = useSetSeratoFolder();
    const [result, setResult] = useState<null | SeratoWriteResult>(null);

    // Fill an empty setting on mount: the user's old localSettings value if they
    // set one before this moved into the store, otherwise ~/Music/_Serato_ if it
    // exists. Mount-only by design -- a fallback for an empty setting, not a
    // subscription to it. `setSeratoFolder` is a stable zustand action, so listing
    // it changes nothing about when this runs.
    useEffect(() => {
        if (!localSettings || !ipc) return;
        if (useAppStore.getState().seratoFolder) return;
        localSettings.get(SERATO_FOLDER_KEY).then(async (dir) => {
            if (typeof dir === 'string' && dir.length > 0) {
                setSeratoFolder(dir);
                return;
            }
            const found = await ipc.invoke('sync:get-default-serato-folder');
            if (typeof found === 'string') setSeratoFolder(found);
        });
    }, [setSeratoFolder]);

    const selectFolder = useCallback(async () => {
        if (!ipc || !localSettings) return;
        try {
            const dir = await ipc.invoke('sync:select-serato-folder');
            if (dir) {
                setSeratoFolder(dir);
                localSettings.set(SERATO_FOLDER_KEY, dir);
            }
        } catch (err: any) {
            toast.error({ message: err?.message || 'Could not use that folder' });
        }
    }, [setSeratoFolder]);

    /**
     * Ask pymix for the crate structure and write it into the library.
     *
     * `musicRoot` is where the download put the tracks; empty means "wherever the
     * app keeps its music", which the main process is the side that knows. Call
     * this *after* the audio -- crates written before the files exist name tracks
     * that aren't there.
     */
    const writeCrates = useCallback(
        async (playlistIds: string[], musicRoot: string) => {
            if (!seratoFolder) return;
            const structure = await PymixController.seratoExport({
                baseUrl: urlConfig.pymix,
                body: { playlistIds },
            });
            if (!structure.success) {
                throw new Error(structure.reason || 'Could not build the Serato export');
            }
            const written = (await window.api.ipc.invoke('sync:write-serato-crates', {
                crates: structure.crates,
                musicRoot,
                seratoFolder,
            })) as SeratoWriteResult;
            setResult(written);
        },
        [seratoFolder],
    );

    // Read out of `result` first: depending on the whole object here would reopen
    // the folder callback on every write, and the compiler refuses to preserve a
    // dependency narrower than the value it can infer.
    const writtenFolder = result?.seratoFolder;
    const showFolder = useCallback(() => {
        if (!ipc || !writtenFolder) return;
        ipc.invoke('sync:open-folder', writtenFolder);
    }, [writtenFolder]);

    const reset = useCallback(() => setResult(null), []);

    return { reset, result, selectFolder, seratoFolder, showFolder, writeCrates };
};
