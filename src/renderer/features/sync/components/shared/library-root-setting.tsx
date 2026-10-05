import { useQueryClient } from '@tanstack/react-query';
import isElectron from 'is-electron';
import { useCallback, useEffect, useState } from 'react';

import { urlConfig } from '/@/renderer/config/url-config';
import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import { DestinationPath } from '/@/renderer/features/sync/components/shared/destination-path';
import { useCurrentServerId, useCurrentServerWithCredential } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { PlaylistListSort, SortOrder } from '/@/shared/types/domain-types';

const ipc = isElectron() ? window.api.ipc : null;

type Backfill = 'running' | null | { recorded: number; underRoot: number };

/** Mirrors LibraryRootCheck in main/features/core/sync/library-root.ts. */
type RootCheck = { ok: false; reason: string } | { ok: true };

/**
 * The folder the user keeps their own library in on this device, often a cloud
 * drive (#214 stage 2, #219). Per device: stored on this machine only, never
 * synced. Subbox only reads under it, by stat, and never writes there.
 *
 * An upload records each track's path under it, so another device that sets its
 * own root to the same library can find those tracks there. Setting it also
 * backfills tracks uploaded before it was set. Desktop only; renders nothing on web.
 */
export const LibraryRootSetting = () => {
    const serverId = useCurrentServerId();
    const username = useCurrentServerWithCredential()?.username;
    const queryClient = useQueryClient();
    const [root, setRoot] = useState<null | string>(null);
    const [problem, setProblem] = useState<null | string>(null);
    const [backfill, setBackfill] = useState<Backfill>(null);

    useEffect(() => {
        if (!ipc) return;
        ipc.invoke('sync:get-library-root').then(async (saved: null | string) => {
            setRoot(saved);
            if (!saved) return;
            // Not found is a hint, not an error: the drive may just be unplugged.
            const check: RootCheck = await ipc.invoke('sync:check-library-root', saved);
            setProblem(check.ok ? null : check.reason);
        });
    }, []);

    // Give the tracks already uploaded from under this folder their path under it.
    // Best effort and silent on failure: an old pymix can't, and that hides the count.
    const runBackfill = useCallback(async () => {
        if (!ipc || !serverId) return;
        setBackfill('running');
        try {
            const playlists = await queryClient.fetchQuery(
                playlistsQueries.list({
                    query: {
                        sortBy: PlaylistListSort.NAME,
                        sortOrder: SortOrder.ASC,
                        startIndex: 0,
                    },
                    serverId,
                }),
            );
            const result = await ipc.invoke('sync:backfill-library-root', {
                playlistIds: (playlists?.items ?? []).map((p) => p.id),
                pymixUrl: urlConfig.pymix,
                serverId,
                username,
            });
            setBackfill(result ?? null);
        } catch (err) {
            console.warn('[sync] library root backfill failed', err);
            setBackfill(null);
        }
    }, [queryClient, serverId, username]);

    const handleChoose = useCallback(async () => {
        if (!ipc) return;
        const dir: null | string = await ipc.invoke('sync:select-library-root');
        if (!dir) return;
        const check: RootCheck = await ipc.invoke('sync:set-library-root', dir);
        if (!check.ok) {
            setProblem(check.reason);
            return;
        }
        setRoot(dir);
        setProblem(null);
        await runBackfill();
    }, [runBackfill]);

    const handleClear = useCallback(async () => {
        if (!ipc) return;
        await ipc.invoke('sync:set-library-root', null);
        setRoot(null);
        setProblem(null);
        setBackfill(null);
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
                tooltip="The folder your own music library is in on this computer, such as a OneDrive or iCloud Drive folder. Set it on each computer, to the same folder of the same library: subbox then finds tracks uploaded from one computer under the other's folder. Subbox never opens or changes the files in it."
            />
            <Text c="dimmed" size="xs">
                Choose the same library folder on every computer. Changing it later does not move
                tracks already uploaded.
            </Text>
            {problem && (
                <Text c="red" data-testid="library-root-problem" size="xs">
                    {problem}
                </Text>
            )}
            {backfill === 'running' && (
                <Text c="dimmed" size="xs">
                    Looking for uploaded tracks in this folder...
                </Text>
            )}
            {/* Uploaded *from* here: on another computer the same library is found
                under this folder at download time, but none of it was uploaded from it,
                so a zero says nothing useful and is not shown. */}
            {backfill && backfill !== 'running' && backfill.underRoot > 0 && (
                <Text c="dimmed" data-testid="library-root-backfill" size="xs">
                    {backfill.underRoot === 1
                        ? '1 track was uploaded from this folder.'
                        : `${backfill.underRoot.toLocaleString()} tracks were uploaded from this folder.`}
                </Text>
            )}
        </Stack>
    );
};
