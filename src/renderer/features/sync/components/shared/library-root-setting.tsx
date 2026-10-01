import isElectron from 'is-electron';
import { useCallback, useEffect, useState } from 'react';

import { DestinationPath } from '/@/renderer/features/sync/components/shared/destination-path';
import { Button } from '/@/shared/components/button/button';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

const ipc = isElectron() ? window.api.ipc : null;

/** Mirrors LibraryRootStatus in main/features/core/sync/index.ts. */
type RootStatus = { reason: string; status: 'unavailable' } | { status: 'ok' };

/**
 * The folder the user keeps their own library in on this device -- often a cloud
 * drive such as OneDrive or iCloud Drive (docs/design-library-roots.md in
 * subbox-workspace).
 *
 * Per device: the same library sits under a different folder on each machine, so
 * this is stored on this machine only and never synced. Nothing reads a file under
 * it; the only check is that the folder exists.
 *
 * Desktop only; renders nothing on web.
 */
export const LibraryRootSetting = () => {
    const [root, setRoot] = useState<null | string>(null);
    const [status, setStatus] = useState<null | RootStatus>(null);

    const check = useCallback(async (dir: string) => {
        if (!ipc) return;
        setStatus(await ipc.invoke('sync:check-library-root', dir));
    }, []);

    useEffect(() => {
        if (!ipc) return;
        ipc.invoke('sync:get-library-roots').then((roots: string[]) => {
            if (roots.length > 0) {
                setRoot(roots[0]);
                check(roots[0]);
            }
        });
    }, [check]);

    const handleChoose = useCallback(async () => {
        if (!ipc) return;
        const dir = await ipc.invoke('sync:select-library-root');
        if (!dir) return;
        setRoot(dir);
        await ipc.invoke('sync:set-library-roots', [dir]);
        check(dir);
    }, [check]);

    const handleClear = useCallback(async () => {
        if (!ipc) return;
        setRoot(null);
        setStatus(null);
        await ipc.invoke('sync:set-library-roots', []);
    }, []);

    if (!ipc) return null;

    return (
        <Stack gap={4}>
            <DestinationPath
                emptyLabel="Not set"
                extra={
                    root ? (
                        <Button onClick={handleClear} size="xs" variant="subtle">
                            Clear
                        </Button>
                    ) : undefined
                }
                label="Library Folder"
                onChoose={handleChoose}
                path={root}
                tooltip="The folder your own music library is in on this computer, such as a OneDrive or iCloud Drive folder. Set on each computer separately. Subbox never opens or downloads the files in it."
            />
            {status?.status === 'unavailable' && (
                <Text c="red" data-testid="library-root-status" size="xs">
                    {status.reason}
                </Text>
            )}
        </Stack>
    );
};
