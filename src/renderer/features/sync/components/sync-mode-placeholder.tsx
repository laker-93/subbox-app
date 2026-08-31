import isElectron from 'is-electron';
import { Suspense, useState } from 'react';

import { useIsDemoSession } from '/@/renderer/config/demo-config';
import { InviteLockedPanel } from '/@/renderer/features/invite/components/invite-locked-panel';
import { SyncDesktopOnly } from '/@/renderer/features/sync/components/shared';
import { SyncDownload } from '/@/renderer/features/sync/components/sync-download';
import { SyncExternalDrive } from '/@/renderer/features/sync/components/sync-external-drive';
import { SyncUpload } from '/@/renderer/features/sync/components/sync-upload';
import { SyncWatch } from '/@/renderer/features/sync/components/sync-watch';
import { Button } from '/@/shared/components/button/button';
import { Center } from '/@/shared/components/center/center';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Spinner } from '/@/shared/components/spinner/spinner';

type SyncTab = 'download' | 'external-drive' | 'upload' | 'watch';

export const SyncModePlaceholder = () => {
    const electron = isElectron();
    const isDemo = useIsDemoSession();
    const [tab, setTab] = useState<SyncTab>('upload');

    // Upload and Watch both write to the library, which pymix blocks for `demo`
    // (`require_uploader`). Marking the tabs up front is the point: the user should see
    // that these are locked before picking files, not after.
    const lockedTooltip =
        'The demo library is read-only. Request an invite to upload your own music.';

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
                            : 'Add music to Sub-box from Rekordbox or Serato. Pick the playlists or crates you want and upload their tracks, cue points and all.',
                        multiline: true,
                        openDelay: 300,
                        w: 280,
                    }}
                    variant={tab === 'upload' ? 'filled' : 'subtle'}
                >
                    Upload
                </Button>
                <Button
                    onClick={() => setTab('download')}
                    size="sm"
                    tooltip={{
                        label: 'Download playlists from your Sub-box library to this device, optionally with a Rekordbox XML to import them straight back into Rekordbox.',
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
                            : 'Watch a local folder. New audio files you drop in are uploaded to Sub-box automatically.',
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
                            label: 'Compare a folder on a USB or external drive against your library and copy across any missing tracks. Handy for loading a DJ USB.',
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
                            description="The demo library is shared and read-only. Your own Sub-box library imports your playlists and crates, cue points and all."
                            title="Upload needs your own library"
                        />
                    ) : electron ? (
                        <SyncUpload />
                    ) : (
                        <SyncDesktopOnly>
                            Uploading is only available in the desktop app. It reads your XML export
                            or crate files off this computer.
                        </SyncDesktopOnly>
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
                            description="The demo library is shared and read-only. With your own library, new tracks appear in Sub-box the moment you save them."
                            title="Folder watching needs your own library"
                        />
                    ) : electron ? (
                        <SyncWatch />
                    ) : (
                        <SyncDesktopOnly>
                            Watch directory is only available in the desktop app.
                        </SyncDesktopOnly>
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
