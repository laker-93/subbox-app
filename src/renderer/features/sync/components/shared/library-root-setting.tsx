import isElectron from 'is-electron';
import { useCallback, useEffect, useState } from 'react';

import { DestinationPath } from '/@/renderer/features/sync/components/shared/destination-path';
import { Button } from '/@/shared/components/button/button';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

const ipc = isElectron() ? window.api.ipc : null;

/** Mirrors LibraryRootScan in main/features/core/sync/library-root.ts, less the entries. */
type RootStatus =
    | { cloudOnly: number; local: number; ms: number; status: 'ok' }
    | { reason: string; status: 'unavailable' }
    | { status: 'scanning' };

const describe = (status: RootStatus): string => {
    if (status.status === 'scanning') return 'Checking…';
    if (status.status === 'unavailable') return status.reason;
    const total = status.local + status.cloudOnly;
    const tracks = `${total.toLocaleString()} ${total === 1 ? 'track' : 'tracks'}`;
    if (status.cloudOnly === 0) return `${tracks}, all on this device`;
    return `${tracks}: ${status.local.toLocaleString()} on this device, ${status.cloudOnly.toLocaleString()} only in the cloud`;
};

/**
 * The folder the user keeps their own library in on this device -- often a cloud
 * drive such as OneDrive (docs/design-library-roots.md in subbox-workspace).
 *
 * Per device: the same library sits under a different folder on each machine, so
 * this is stored on this machine only and never synced. Choosing it reads nothing
 * but directory listings: files that are only in the cloud stay there.
 *
 * Desktop only; renders nothing on web.
 */
export const LibraryRootSetting = () => {
    const [root, setRoot] = useState<null | string>(null);
    const [status, setStatus] = useState<null | RootStatus>(null);

    const scan = useCallback(async (dir: string) => {
        if (!ipc) return;
        setStatus({ status: 'scanning' });
        const result = await ipc.invoke('sync:scan-library-root', dir);
        setStatus(
            result.status === 'ok'
                ? {
                      cloudOnly: result.cloudOnly,
                      local: result.local,
                      ms: result.ms,
                      status: 'ok',
                  }
                : result,
        );
    }, []);

    useEffect(() => {
        if (!ipc) return;
        ipc.invoke('sync:get-library-roots').then((roots: string[]) => {
            if (roots.length > 0) {
                setRoot(roots[0]);
                scan(roots[0]);
            }
        });
    }, [scan]);

    const handleChoose = useCallback(async () => {
        if (!ipc) return;
        const dir = await ipc.invoke('sync:select-library-root');
        if (!dir) return;
        setRoot(dir);
        await ipc.invoke('sync:set-library-roots', [dir]);
        scan(dir);
    }, [scan]);

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
                tooltip="The folder your own music library is in on this computer, such as a OneDrive folder. Set on each computer separately. Files that are only in the cloud are never downloaded by checking them."
            />
            {status && (
                <Text
                    c={status.status === 'unavailable' ? 'red' : 'dimmed'}
                    data-testid="library-root-status"
                    size="xs"
                >
                    {describe(status)}
                </Text>
            )}
        </Stack>
    );
};
