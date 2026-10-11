import { generatePath } from 'react-router';

import { subboxIdOf } from '/@/renderer/features/dj/utils/subbox-id';
import { AppRoute } from '/@/renderer/router/routes';
import { Song } from '/@/shared/types/domain-types';

// Subbox-only: where the prep view is and the list it walks (subbox-app#239). The
// route names the track by its subbox_id, which is what its DJ data hangs off; the
// Navidrome id rides along as `?song=`, since only Navidrome can stream the file and
// nothing maps a subbox_id back to it.

export interface PrepListEntry {
    songId: string;
    subboxId: string;
}

/** Router state for the prep route: the list the user came from, so prev/next walk it. */
export interface PrepLocationState {
    prepList?: PrepListEntry[];
}

export const prepPath = ({ songId, subboxId }: PrepListEntry) =>
    `${generatePath(AppRoute.DJ_PREP, { subboxId })}?song=${encodeURIComponent(songId)}`;

export const prepEntryOf = (song: null | Song | undefined): null | PrepListEntry => {
    const subboxId = subboxIdOf(song);
    return song?.id && subboxId ? { songId: song.id, subboxId } : null;
};

/**
 * The preppable songs of a list, in its order. A list rows can be anything a table
 * holds (unloaded rows are undefined), so anything that isn't a tagged song is
 * dropped: an untagged song has no DJ data to prep.
 */
export const prepListOf = (items: readonly unknown[] | undefined): PrepListEntry[] => {
    const entries: PrepListEntry[] = [];
    const seen = new Set<string>();
    for (const item of items ?? []) {
        if (!item || typeof item !== 'object' || !('id' in item)) continue;
        const entry = prepEntryOf(item as Song);
        // A playlist can hold a song twice; walking it twice is just a repeat.
        if (!entry || seen.has(entry.subboxId)) continue;
        seen.add(entry.subboxId);
        entries.push(entry);
    }
    return entries;
};
