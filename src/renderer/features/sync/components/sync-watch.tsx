import { useCallback, useEffect, useState } from 'react';
import isElectron from 'is-electron';

import { urlConfig } from '/@/renderer/config/url-config';
import { useCurrentServerWithCredential } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Center } from '/@/shared/components/center/center';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

const ipc = isElectron() ? window.api.ipc : null;
const localSettings = isElectron() ? window.api.localSettings : null;

interface WatchProgress {
    currentFile: string;
    phase: 'scanning' | 'uploading' | 'idle' | 'error';
    total: number;
    uploaded: number;
}

export const SyncWatch = () => {
    const currentServer = useCurrentServerWithCredential();
    const [watchDir, setWatchDir] = useState<string | null>(null);
    const [watching, setWatching] = useState(false);
    const [progress, setProgress] = useState<WatchProgress | null>(null);

    // Load persisted watch directory on mount
    useEffect(() => {
        if (!localSettings) return;
        localSettings.get('watch_directory').then((val: unknown) => {
            if (typeof val === 'string' && val.length > 0) {
                setWatchDir(val);
            }
        });
    }, []);

    // Listen for progress events
    useEffect(() => {
        if (!ipc) return;
        const handler = (_event: any, prog: WatchProgress) => {
            setProgress(prog);
        };
        ipc.on('sync:watch-progress', handler);
        return () => {
            ipc.removeListener('sync:watch-progress', handler);
        };
    }, []);

    // Stop watcher on unmount
    useEffect(() => {
        return () => {
            if (watching && ipc) {
                ipc.invoke('sync:stop-watch').catch(console.error);
            }
        };
    }, [watching]);

    const handleSelectDirectory = useCallback(async () => {
        if (!ipc || !localSettings) return;
        const dir = await ipc.invoke('sync:select-watch-directory');
        if (dir) {
            setWatchDir(dir);
            localSettings.set('watch_directory', dir);
        }
    }, []);

    const handleStartWatch = useCallback(async () => {
        if (!ipc || !watchDir) return;
        await ipc.invoke('sync:start-watch', {
            filebrowserToken: currentServer.fbToken,
            filebrowserUrl: urlConfig.filebrowser,
            watchDir,
        });
        setWatching(true);
    }, [currentServer.fbToken, watchDir]);

    const handleStopWatch = useCallback(async () => {
        if (!ipc) return;
        await ipc.invoke('sync:stop-watch');
        setWatching(false);
        setProgress(null);
    }, []);

    return (
        <Stack gap="md" p="md">
            <Text fw={600} size="lg">Watch Directory</Text>
            <Text c="dimmed" size="sm">
                Select a local folder to watch. New audio files will be automatically uploaded to your cloud storage.
            </Text>

            <Group gap="sm">
                <Button onClick={handleSelectDirectory} variant="subtle">
                    {watchDir ? 'Change Directory' : 'Select Directory'}
                </Button>
                {watchDir && (
                    <Text size="sm" style={{ fontFamily: 'monospace' }}>
                        {watchDir}
                    </Text>
                )}
            </Group>

            {watchDir && (
                <Group gap="sm">
                    {!watching ? (
                        <Button onClick={handleStartWatch} variant="filled">
                            Start Watching
                        </Button>
                    ) : (
                        <Button color="red" onClick={handleStopWatch} variant="filled">
                            Stop Watching
                        </Button>
                    )}
                </Group>
            )}

            {progress && watching && (
                <Stack gap="xs">
                    {progress.phase === 'idle' && (
                        <Text c="dimmed" size="sm">Watching for new files...</Text>
                    )}
                    {progress.phase === 'scanning' && (
                        <Text c="dimmed" size="sm">Scanning directory...</Text>
                    )}
                    {progress.phase === 'uploading' && (
                        <Text size="sm">
                            Uploading {progress.uploaded}/{progress.total}: {progress.currentFile}
                        </Text>
                    )}
                    {progress.phase === 'error' && (
                        <Text c="red" size="sm">
                            Error uploading: {progress.currentFile || 'Unknown error'}
                        </Text>
                    )}
                </Stack>
            )}

            {!isElectron() && (
                <Center style={{ height: '100%' }}>
                    <Text c="dimmed">
                        Watch directory is only available in the desktop app.
                    </Text>
                </Center>
            )}
        </Stack>
    );
};
