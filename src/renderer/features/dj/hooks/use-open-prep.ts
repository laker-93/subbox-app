import { useCallback } from 'react';
import { useNavigate } from 'react-router';

import {
    prepEntryOf,
    prepListOf,
    PrepLocationState,
    prepPath,
} from '/@/renderer/features/dj/prep/prep-list';
import { useFullScreenPlayerStoreActions } from '/@/renderer/store';
import { Song } from '/@/shared/types/domain-types';

// Subbox-only: open a track in the prep view (subbox-app#239), with the list it was
// opened from so prev/next can walk it. False when the song can't be prepped (it has
// no subbox_id tag, so there's no DJ data to show).
export const useOpenPrep = () => {
    const navigate = useNavigate();
    const { setStore } = useFullScreenPlayerStoreActions();

    return useCallback(
        (song: null | Song | undefined, list?: readonly unknown[]) => {
            const entry = prepEntryOf(song);
            if (!entry) return false;
            const prepList = prepListOf(list);
            const state: PrepLocationState = {
                prepList: prepList.some((e) => e.subboxId === entry.subboxId) ? prepList : [entry],
            };
            setStore({ expanded: false, visualizerExpanded: false });
            navigate(prepPath(entry), { state });
            return true;
        },
        [navigate, setStore],
    );
};
