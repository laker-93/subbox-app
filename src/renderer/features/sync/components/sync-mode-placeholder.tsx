import isElectron from 'is-electron';
import { Suspense, useState } from 'react';

import { SyncDownload } from '/@/renderer/features/sync/components/sync-download';
import { SyncExternalDrive } from '/@/renderer/features/sync/components/sync-external-drive';
import { SyncRekordbox } from '/@/renderer/features/sync/components/sync-rekordbox';
import { SyncWatch } from '/@/renderer/features/sync/components/sync-watch';
import { Button } from '/@/shared/components/button/button';
import { Center } from '/@/shared/components/center/center';
import { Group } from '/@/shared/components/group/group';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Text } from '/@/shared/components/text/text';

type SyncTab = 'download' | 'external-drive' | 'upload' | 'watch';

export const SyncModePlaceholder = () => {
    const electron = isElectron();
    const [tab, setTab] = useState<SyncTab>('upload');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Group gap="xs" p="sm" style={{ borderBottom: '1px solid var(--theme-border-color)' }}>
                <Button
                    onClick={() => setTab('upload')}
                    size="sm"
                    tooltip={{
                        label: 'Add music to Subbox from a Rekordbox XML export — pick the playlists you want and upload the tracks to your cloud library.',
                        multiline: true,
                        openDelay: 300,
                        w: 280,
                    }}
                    variant={tab === 'upload' ? 'filled' : 'subtle'}
                >
                    Upload (Rekordbox)
                </Button>
                <Button
                    onClick={() => setTab('download')}
                    size="sm"
                    tooltip={{
                        label: 'Download playlists from your Subbox library to this device. Optionally include a Rekordbox XML so you can import them straight back into Rekordbox.',
                        multiline: true,
                        openDelay: 300,
                        w: 280,
                    }}
                    variant={tab === 'download' ? 'filled' : 'subtle'}
                >
                    Download
                </Button>
                <Button
                    onClick={() => setTab('watch')}
                    size="sm"
                    tooltip={{
                        label: 'Watch a local folder — any new audio files you drop in are uploaded to your Subbox library automatically.',
                        multiline: true,
                        openDelay: 300,
                        w: 280,
                    }}
                    variant={tab === 'watch' ? 'filled' : 'subtle'}
                >
                    Watch
                </Button>
                {electron && (
                    <Button
                        onClick={() => setTab('external-drive')}
                        size="sm"
                        tooltip={{
                            label: 'Compare a folder on a USB or external drive against your library and copy across any missing tracks — handy for loading a DJ USB.',
                            multiline: true,
                            openDelay: 300,
                            w: 280,
                        }}
                        variant={tab === 'external-drive' ? 'filled' : 'subtle'}
                    >
                        External Drive
                    </Button>
                )}
            </Group>
            <div style={{ flex: 1, overflow: 'hidden' }}>
                {tab === 'upload' &&
                    (electron ? (
                        <SyncRekordbox />
                    ) : (
                        <Center style={{ height: '100%' }}>
                            <Text c="dimmed">
                                Rekordbox XML upload is only available in the desktop app.
                            </Text>
                        </Center>
                    ))}
                {tab === 'download' && (
                    <Suspense
                        fallback={
                            <Center style={{ height: '100%' }}>
                                <Spinner />
                            </Center>
                        }
                    >
                        <SyncDownload />
                    </Suspense>
                )}
                {tab === 'watch' &&
                    (electron ? (
                        <SyncWatch />
                    ) : (
                        <Center style={{ height: '100%' }}>
                            <Text c="dimmed">
                                Watch directory is only available in the desktop app.
                            </Text>
                        </Center>
                    ))}
                {tab === 'external-drive' && (
                    <Suspense
                        fallback={
                            <Center style={{ height: '100%' }}>
                                <Spinner />
                            </Center>
                        }
                    >
                        <SyncExternalDrive />
                    </Suspense>
                )}
            </div>
        </div>
    );
};
