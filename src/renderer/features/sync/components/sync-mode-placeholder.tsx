import { Suspense, useState } from 'react';
import isElectron from 'is-electron';

import { SyncDownload } from '/@/renderer/features/sync/components/sync-download';
import { SyncRekordbox } from '/@/renderer/features/sync/components/sync-rekordbox';
import { SyncWatch } from '/@/renderer/features/sync/components/sync-watch';
import { Button } from '/@/shared/components/button/button';
import { Center } from '/@/shared/components/center/center';
import { Group } from '/@/shared/components/group/group';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Text } from '/@/shared/components/text/text';

type SyncTab = 'upload' | 'download' | 'watch';

export const SyncModePlaceholder = () => {
    const electron = isElectron();
    const [tab, setTab] = useState<SyncTab>('upload');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Group gap="xs" p="sm" style={{ borderBottom: '1px solid var(--theme-border-color)' }}>
                <Button
                    onClick={() => setTab('upload')}
                    size="sm"
                    variant={tab === 'upload' ? 'filled' : 'subtle'}
                >
                    Upload (Rekordbox)
                </Button>
                <Button
                    onClick={() => setTab('download')}
                    size="sm"
                    variant={tab === 'download' ? 'filled' : 'subtle'}
                >
                    Download
                </Button>
                <Button
                    onClick={() => setTab('watch')}
                    size="sm"
                    variant={tab === 'watch' ? 'filled' : 'subtle'}
                >
                    Watch
                </Button>
            </Group>
            <div style={{ flex: 1, overflow: 'hidden' }}>
                {tab === 'upload' && (
                    electron ? (
                        <SyncRekordbox />
                    ) : (
                        <Center style={{ height: '100%' }}>
                            <Text c="dimmed">
                                Rekordbox XML upload is only available in the desktop app.
                            </Text>
                        </Center>
                    )
                )}
                {tab === 'download' && (
                    <Suspense fallback={<Center style={{ height: '100%' }}><Spinner /></Center>}>
                        <SyncDownload />
                    </Suspense>
                )}
                {tab === 'watch' && (
                    electron ? (
                        <SyncWatch />
                    ) : (
                        <Center style={{ height: '100%' }}>
                            <Text c="dimmed">
                                Watch directory is only available in the desktop app.
                            </Text>
                        </Center>
                    )
                )}
            </div>
        </div>
    );
};
