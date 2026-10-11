import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import i18n from '/@/i18n/i18n';
import { DjWriteResult, PymixController } from '/@/renderer/api/pymix/pymix-controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { urlConfig } from '/@/renderer/config/url-config';
import { touchesSameField } from '/@/renderer/features/dj/utils/dj-edit';
import { useCurrentServerId } from '/@/renderer/store';
import { DjPatch, DjTrack } from '/@/shared/api/pymix/pymix-types';
import { closeAllModals, ConfirmModal, openModal } from '/@/shared/components/modal/modal';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

// Subbox-only: writing one track's DJ data from the prep view (subbox-app#241,
// design-dj-ui §3.2). Every change is one PATCH /track/{id}/dj made against the version
// the user saw; undo and the history panel revert to an earlier version, which pymix
// writes as a new one, so nothing is ever lost.
//
// Writes run one at a time, each against the version the last one left, so quick
// edits can't race each other into a 409.
//
// A 409 means another device wrote first (§10 Q7, decided here): if it changed
// something else, this edit is reapplied on top of it without asking; if it changed
// the same pad, loop, grid or key, the user picks whose wins.

export type DjEdit = Omit<DjPatch, 'expected_version'>;

const MAX_RETRIES = 3;

const askKeepMine = () =>
    new Promise<boolean>((resolve) => {
        let answered = false;
        const answer = (mine: boolean) => {
            if (answered) return;
            answered = true;
            closeAllModals();
            resolve(mine);
        };
        openModal({
            children: (
                <ConfirmModal
                    labels={{
                        cancel: i18n.t('page.djPrep.conflictKeepTheirs'),
                        confirm: i18n.t('page.djPrep.conflictUseMine'),
                    }}
                    onCancel={() => answer(false)}
                    onConfirm={() => answer(true)}
                >
                    <Text>{i18n.t('page.djPrep.conflictBody')}</Text>
                </ConfirmModal>
            ),
            onClose: () => answer(false),
            title: i18n.t('page.djPrep.conflictTitle'),
        });
    });

// pymix's 422 reasons are written for the user ("a loop's end must be after its start").
const report = (error: unknown) => {
    toast.error({
        message:
            error instanceof Error ? error.message : (i18n.t('page.djPrep.saveFailed') as string),
    });
    return null;
};

export const useDjEdit = (subboxId: string, dj: DjTrack | null) => {
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();
    const trackKey = queryKeys.dj.track(serverId, subboxId);
    const historyKey = queryKeys.dj.history(serverId, subboxId);

    const history = useQuery({
        enabled: Boolean(serverId && subboxId && dj),
        queryFn: ({ signal }) =>
            PymixController.getTrackDjHistory({ baseUrl: urlConfig.pymix, signal, subboxId }),
        queryKey: historyKey,
    });

    const latest = useRef(dj);
    latest.current = queryClient.getQueryData<DjTrack | null>(trackKey) ?? dj;
    const chain = useRef<Promise<unknown>>(Promise.resolve());
    const [pending, setPending] = useState(0);

    // Undo walks back through the versions: `cursor` is the version the track was last
    // reverted to by undo, and `top` the newest one redo may walk forward to. Any other
    // write starts a new branch, as in any editor.
    const [walk, setWalk] = useState<null | { cursor: number; top: number }>(null);
    useEffect(() => setWalk(null), [subboxId]);

    const settle = useCallback(
        (track: DjTrack) => {
            latest.current = track;
            queryClient.setQueryData(trackKey, track);
            queryClient.invalidateQueries({ queryKey: historyKey });
            // The song table's DJ columns (#240), if that's built.
            queryClient.invalidateQueries({ queryKey: [serverId, 'dj', 'summary', subboxId] });
        },
        [historyKey, queryClient, serverId, subboxId, trackKey],
    );

    const run = useCallback(<T,>(task: () => Promise<T>) => {
        setPending((n) => n + 1);
        const next = chain.current.then(task).finally(() => setPending((n) => n - 1));
        chain.current = next.catch(() => undefined);
        return next;
    }, []);

    const write = useCallback(
        async (send: (expectedVersion: number) => Promise<DjWriteResult>, edit: DjEdit | null) => {
            let base = latest.current;
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                const result = await send(base?.version ?? 0);
                if (!result.conflict) {
                    settle(result.track);
                    return result.track;
                }
                const { current } = result;
                const clash = !edit || touchesSameField(edit, base?.cuedata, current.cuedata);
                if (clash && !(await askKeepMine())) {
                    settle(current);
                    return null;
                }
                base = current;
                latest.current = current;
            }
            throw new Error(i18n.t('page.djPrep.saveFailed') as string);
        },
        [settle],
    );

    /** One edit. Resolves to the track as saved, or null if it wasn't. */
    const apply = useCallback(
        (edit: DjEdit) => {
            setWalk(null);
            return run(() =>
                write(
                    (expectedVersion) =>
                        PymixController.patchTrackDj({
                            baseUrl: urlConfig.pymix,
                            body: { ...edit, expected_version: expectedVersion },
                            subboxId,
                        }),
                    edit,
                ),
            ).catch(report);
        },
        [run, subboxId, write],
    );

    const revertTo = useCallback(
        (toVersion: number) =>
            run(() =>
                write(
                    (expectedVersion) =>
                        PymixController.revertTrackDj({
                            baseUrl: urlConfig.pymix,
                            expectedVersion,
                            subboxId,
                            toVersion,
                        }),
                    null,
                ),
            ).catch(report),
        [run, subboxId, write],
    );

    const version = dj?.version ?? 0;
    const cursor = walk?.cursor ?? version;
    const canUndo = cursor > 1 && pending === 0;
    const canRedo = Boolean(walk) && cursor < (walk?.top ?? 0) && pending === 0;

    const undo = useCallback(async () => {
        if (!canUndo) return;
        const top = walk?.top ?? version;
        const target = cursor - 1;
        if (await revertTo(target)) setWalk({ cursor: target, top });
    }, [canUndo, cursor, revertTo, version, walk?.top]);

    const redo = useCallback(async () => {
        if (!canRedo || !walk) return;
        const target = cursor + 1;
        if (await revertTo(target)) {
            setWalk(target >= walk.top ? null : { cursor: target, top: walk.top });
        }
    }, [canRedo, cursor, revertTo, walk]);

    /** Revert from the history panel: a write of its own, not a step of undo. */
    const revert = useCallback(
        async (toVersion: number) => {
            setWalk(null);
            return revertTo(toVersion);
        },
        [revertTo],
    );

    return { apply, canRedo, canUndo, history, pending: pending > 0, redo, revert, undo };
};

export type DjEditor = ReturnType<typeof useDjEdit>;
