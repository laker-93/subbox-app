import { useCallback, useState } from 'react';

/**
 * The tick-list state every Sync picker keeps: which ids are selected, and the
 * three ways they change.
 *
 * Written out identically in four flows before this, which is how `selectAll`
 * came to mean "all the ids I was rendering when this callback was made": a
 * stale-closure bug waiting on any list that can refresh under the user. Taking
 * the ids as an argument instead of closing over them is the point of the hook.
 */
export const useSelection = (initial?: Iterable<string>) => {
    const [selected, setSelected] = useState<Set<string>>(() => new Set(initial ?? []));

    const toggle = useCallback((id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const selectAll = useCallback((ids: Iterable<string>) => setSelected(new Set(ids)), []);

    const selectNone = useCallback(() => setSelected(new Set()), []);

    return { selectAll, selected, selectNone, setSelected, toggle };
};
