import isElectron from 'is-electron';
import { Suspense, useState } from 'react';

import { useIsDemoSession } from '/@/renderer/config/demo-config';
import { InviteLockedPanel } from '/@/renderer/features/invite/components/invite-locked-panel';
import { SyncDownload } from '/@/renderer/features/sync/components/sync-download';
import { SyncExternalDrive } from '/@/renderer/features/sync/components/sync-external-drive';
import { SyncRekordbox } from '/@/renderer/features/sync/components/sync-rekordbox';
import { SyncWatch } from '/@/renderer/features/sync/components/sync-watch';
import { Button } from '/@/shared/components/button/button';
import { Center } from '/@/shared/components/center/center';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Text } from '/@/shared/components/text/text';

type SyncTab = 'download' | 'external-drive' | 'upload' | 'watch';

export const SyncModePlaceholder = () => {
    const electron = isElectron();
    const isDemo = useIsDemoSession();
    const [tab, setTab] = useState<SyncTab>('upload');

    // Upload and Watch both write to the library, which pymix blocks for `demo`
    // (`require_uploader`). Marking the tabs up front is the point: the user should see
    // that these are locked before picking files, not after.
    const lockedTooltip =
        'Uploading needs your own Sub-box library — the demo is read-only. Request an invite to get one.';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Group gap="xs" p="sm" style={{ borderBottom: '1px solid var(--theme-border-color)' }}>
                <Button
                    leftSection={isDemo ? <Icon icon="lock" size="sm" /> : undefined}
                    onClick={() => setTab('upload')}
                    size="sm"
                    tooltip={{
                        label: isDemo
                            ? lockedTooltip
                            : 'Add music to Sub-box from a Rekordbox XML export — pick the playlists you want and upload the tracks to your cloud library.',
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
                        label: 'Download playlists from your Sub-box library to this device. Optionally include a Rekordbox XML so you can import them straight back into Rekordbox.',
                        multiline: true,
                        openDelay: 300,
                        w: 280,
                    }}
                    variant={tab === 'download' ? 'filled' : 'subtle'}
                >
                    Download
                </Button>
                <Button
                    leftSection={isDemo ? <Icon icon="lock" size="sm" /> : undefined}
                    onClick={() => setTab('watch')}
                    size="sm"
                    tooltip={{
                        label: isDemo
                            ? lockedTooltip
                            : 'Watch a local folder — any new audio files you drop in are uploaded to your Sub-box library automatically.',
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
                {/* The demo lock is checked before the desktop-only notice: both are true
                    for a demo user on the web, but only one of them is something they can
                    act on. */}
                {tab === 'upload' &&
                    (isDemo ? (
                        <InviteLockedPanel
                            description="Uploading a Rekordbox library writes to your collection, and the demo library is shared and read-only. Your own Sub-box library imports your playlists, cue points and all."
                            title="Rekordbox upload needs your own library"
                        />
                    ) : electron ? (
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
                    (isDemo ? (
                        <InviteLockedPanel
                            description="Watching a folder uploads whatever lands in it, and the demo library is shared and read-only. With your own library, new tracks appear in Sub-box the moment you save them."
                            title="Folder watching needs your own library"
                        />
                    ) : electron ? (
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
