import { useNavigate } from 'react-router';

import { getTitlePath } from '/@/renderer/components/item-list/helpers/get-title-path';
import {
    ItemListStateActions,
    ItemListStateItemWithRequiredProperties,
} from '/@/renderer/components/item-list/helpers/item-list-state';
import { ItemControls } from '/@/renderer/components/item-list/types';
import { useDjMode } from '/@/renderer/features/dj/hooks/use-dj-mode';
import { useOpenPrep } from '/@/renderer/features/dj/hooks/use-open-prep';
import { useHotkeySettings, usePlayButtonBehavior } from '/@/renderer/store';
import { useHotkeys } from '/@/shared/hooks/use-hotkeys';
import { LibraryItem, Song } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

export const useListHotkeys = ({
    controls,
    focused,
    internalState,
    itemType,
}: {
    controls: ItemControls;
    focused: boolean;
    internalState: ItemListStateActions;
    itemType: LibraryItem;
}) => {
    const { bindings } = useHotkeySettings();
    const playButtonBehavior = usePlayButtonBehavior();
    const navigate = useNavigate();
    // Subbox-only (subbox-app#239): open the selected track in prep, walking this list.
    const djMode = useDjMode();
    const openPrep = useOpenPrep();
    const isSongList =
        itemType === LibraryItem.SONG ||
        itemType === LibraryItem.PLAYLIST_SONG ||
        itemType === LibraryItem.QUEUE_SONG;

    // Helper to check if item has required properties
    const hasRequiredStateItemProperties = (
        item: unknown,
    ): item is ItemListStateItemWithRequiredProperties => {
        return (
            typeof item === 'object' &&
            item !== null &&
            'id' in item &&
            typeof (item as any).id === 'string' &&
            '_serverId' in item &&
            typeof (item as any)._serverId === 'string' &&
            '_itemType' in item &&
            typeof (item as any)._itemType === 'string'
        );
    };

    useHotkeys([
        [
            'mod+a',
            () => {
                if (focused) {
                    if (internalState.isAllSelected()) {
                        internalState.deselectAll();
                    } else {
                        internalState.selectAll();
                    }
                }
            },
        ],
        [
            bindings.listPlayDefault.hotkey,
            () => {
                if (!focused) return;
                const selected = internalState.getSelected();
                const validSelected = selected.filter(hasRequiredStateItemProperties);
                if (validSelected.length === 0) return;

                const item = validSelected[0];
                const playType = playButtonBehavior;
                controls.onPlay?.({ item, itemType, playType } as any);
            },
        ],
        [
            bindings.listPlayNow.hotkey,
            () => {
                if (!focused) return;
                const selected = internalState.getSelected();
                const validSelected = selected.filter(hasRequiredStateItemProperties);
                if (validSelected.length === 0) return;

                const item = validSelected[0];
                controls.onPlay?.({ item, itemType, playType: Play.NOW } as any);
            },
        ],
        [
            bindings.listPlayNext.hotkey,
            () => {
                if (!focused) return;
                const selected = internalState.getSelected();
                const validSelected = selected.filter(hasRequiredStateItemProperties);
                if (validSelected.length === 0) return;

                const item = validSelected[0];
                controls.onPlay?.({ item, itemType, playType: Play.NEXT } as any);
            },
        ],
        [
            bindings.listPlayLast.hotkey,
            () => {
                if (!focused) return;
                const selected = internalState.getSelected();
                const validSelected = selected.filter(hasRequiredStateItemProperties);
                if (validSelected.length === 0) return;

                const item = validSelected[0];
                controls.onPlay?.({ item, itemType, playType: Play.LAST } as any);
            },
        ],
        [
            bindings.listNavigateToPage.hotkey,
            () => {
                if (!focused) return;
                const selected = internalState.getSelected();
                const validSelected = selected.filter(hasRequiredStateItemProperties);
                if (validSelected.length === 0) return;

                const item = validSelected[0];
                const path = getTitlePath(itemType, item.id);
                if (path) {
                    navigate(path, { state: { item } });
                }
            },
        ],
        [
            bindings.listPrepTrack.hotkey,
            () => {
                if (!focused || !djMode.enabled || !isSongList) return;
                const selected = internalState.getSelected();
                const validSelected = selected.filter(hasRequiredStateItemProperties);
                if (validSelected.length === 0) return;

                openPrep(validSelected[0] as unknown as Song, internalState.getData());
            },
        ],
    ]);
};
