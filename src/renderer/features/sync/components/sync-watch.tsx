import isElectron from 'is-electron';
import { useCallback, useEffect, useState } from 'react';

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
    phase: 'error' | 'idle' | 'scanning' | 'uploading';
    total: number;
    uploaded: number;
}

export const SyncWatch = () => {
    const currentServer = useCurrentServerWithCredential();
    const [watchDir, setWatchDir] = useState<null | string>(null);
    const [watching, setWatching] = useState(false);
    const [progress, setProgress] = useState<null | WatchProgress>(null);

    // Load persisted watch directory and active state on mount
    useEffect(() => {
        if (!localSettings) return;
        Promise.all([localSettings.get('watch_directory'), localSettings.get('watch_active')]).then(
            ([dir, active]) => {
                if (typeof dir === 'string' && dir.length > 0) setWatchDir(dir);
                if (active === true) setWatching(true);
            },
        );
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

    // Stop watcher on unmount is intentionally omitted — the watcher runs in the
    // main process and should persist while the app is open, surviving navigation.
    // Call sync:stop-watch explicitly via handleStopWatch to end it.

    const handleSelectDirectory = useCallback(async () => {
        if (!ipc || !localSettings) return;
        const dir = await ipc.invoke('sync:select-watch-directory');
        if (dir) {
            setWatchDir(dir);
            localSettings.set('watch_directory', dir);
        }
    }, []);

    const handleStartWatch = useCallback(async () => {
        if (!ipc || !watchDir || !localSettings) return;
        await ipc.invoke('sync:start-watch', {
            filebrowserToken: currentServer.fbToken,
            filebrowserUrl: urlConfig.filebrowser,
            pymixUrl: urlConfig.pymix,
            serverId: currentServer.id,
            username: currentServer.username,
            watchDir,
        });
        setWatching(true);
        localSettings.set('watch_active', true);
    }, [currentServer.fbToken, currentServer.id, currentServer.username, watchDir]);

    const handleStopWatch = useCallback(async () => {
        if (!ipc || !localSettings) return;
        await ipc.invoke('sync:stop-watch');
        setWatching(false);
        localSettings.set('watch_active', false);
    }, []);

    return (
        <Stack gap="md" p="md">
            <Text fw={600} size="lg">
                Watch Directory
            </Text>
            <Text c="dimmed" size="sm">
                Select a local folder to watch. New audio files will be automatically uploaded to
                your cloud storage.
            </Text>

            <Group gap="sm">
                <Button
                    onClick={handleSelectDirectory}
                    tooltip={{
                        label: 'Choose the local folder to monitor — for example the folder where you save new downloads or recordings.',
                        multiline: true,
                        openDelay: 300,
                        w: 280,
                    }}
                    variant="subtle"
                >
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
                        <Button
                            onClick={handleStartWatch}
                            tooltip={{
                                label: 'Start watching this folder. New audio files added here will be uploaded to your Sub-box library automatically while the app is open.',
                                multiline: true,
                                openDelay: 300,
                                w: 280,
                            }}
                            variant="filled"
                        >
                            Start Watching
                        </Button>
                    ) : (
                        <Button
                            color="red"
                            onClick={handleStopWatch}
                            tooltip={{
                                label: 'Stop watching this folder. New files will no longer be uploaded automatically.',
                                multiline: true,
                                openDelay: 300,
                                w: 280,
                            }}
                            variant="filled"
                        >
                            Stop Watching
                        </Button>
                    )}
                </Group>
            )}

            {progress && watching && (
                <Stack gap="xs">
                    {progress.phase === 'idle' && (
                        <Text c="dimmed" size="sm">
                            Watching for new files...
                        </Text>
                    )}
                    {progress.phase === 'scanning' && (
                        <Text c="dimmed" size="sm">
                            Scanning directory...
                        </Text>
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
                    <Text c="dimmed">Watch directory is only available in the desktop app.</Text>
                </Center>
            )}
        </Stack>
    );
};
