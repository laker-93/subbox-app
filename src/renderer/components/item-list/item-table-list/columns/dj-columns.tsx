import { useTranslation } from 'react-i18next';

import styles from './dj-columns.module.css';

import {
    ColumnNullFallback,
    ColumnSkeletonFixed,
    ItemTableListInnerColumn,
    TableColumnTextContainer,
} from '/@/renderer/components/item-list/item-table-list/item-table-list-column';
import { useDjSummary } from '/@/renderer/features/dj/hooks/use-dj-summary';
import { useKeyNotation } from '/@/renderer/features/dj/hooks/use-key-notation';
import { padColor } from '/@/renderer/features/dj/utils/dj-marks';
import { appName } from '/@/renderer/features/dj/utils/format-dj';
import { formatKey } from '/@/renderer/features/dj/utils/musical-key';
import { subboxIdOf } from '/@/renderer/features/dj/utils/subbox-id';
import { DjTrackSummary } from '/@/shared/api/pymix/pymix-types';
import { Group } from '/@/shared/components/group/group';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';
import { Song } from '/@/shared/types/domain-types';

// Subbox-only: the song table's DJ columns (subbox-app#240, design-dj-ui §5.3), from
// POST /tracks/dj/summary. Plain labels, no header sort: pymix can't sort on them yet
// (A6, §10 Q3). Each fits one 24 px row, for #133's DJ view preset.

const PADS = 8;

const useRowSummary = (props: ItemTableListInnerColumn) => {
    const item = (props.getRowItem?.(props.rowIndex) ??
        (props.data as unknown[])[props.rowIndex]) as Song | undefined;
    const subboxId = subboxIdOf(item);
    const query = useDjSummary(subboxId);
    return { hasId: Boolean(subboxId), item, query };
};

const DjCell = ({
    props,
    render,
}: {
    props: ItemTableListInnerColumn;
    render: (summary: DjTrackSummary, tagsRead: boolean) => null | React.ReactNode;
}) => {
    const { hasId, item, query } = useRowSummary(props);

    // Not loaded yet (or a song without a subbox_id, which has nothing to show).
    if (!item) return <ColumnSkeletonFixed {...props} />;
    if (!hasId || query.isError) return <ColumnNullFallback {...props} />;
    if (query.isPending) return <ColumnSkeletonFixed {...props} />;
    const content = query.data.summary ? render(query.data.summary, query.data.tagsRead) : null;
    if (content == null) return <ColumnNullFallback {...props} />;
    return (
        <TableColumnTextContainer {...props} containerClassName={styles.cell}>
            {typeof content === 'string' ? <span className={styles.text}>{content}</span> : content}
        </TableColumnTextContainer>
    );
};

export const DjKeyColumn = (props: ItemTableListInnerColumn) => {
    const [notation] = useKeyNotation();
    return (
        <DjCell
            props={props}
            render={(summary, tagsRead) =>
                formatKey(summary.key, notation) ?? (tagsRead ? null : '?')
            }
        />
    );
};

const CuePads = ({ summary }: { summary: DjTrackSummary }) => {
    const cues = new Map(summary.cue_pads.map((pad) => [pad.slot, pad.color]));
    const loops = new Map(summary.loop_pads.map((pad) => [pad.slot, pad.color]));
    return (
        <span className={styles.pads}>
            {Array.from({ length: PADS }, (_, slot) => {
                if (cues.has(slot)) {
                    return (
                        <span
                            className={styles.pad}
                            key={slot}
                            style={{ background: padColor(cues.get(slot), slot) }}
                        />
                    );
                }
                if (loops.has(slot)) {
                    return (
                        <span
                            className={styles.pad}
                            data-loop
                            key={slot}
                            style={{ borderColor: padColor(loops.get(slot), slot) }}
                        />
                    );
                }
                return <span className={styles.pad} data-empty key={slot} />;
            })}
        </span>
    );
};

export const DjCuesColumn = (props: ItemTableListInnerColumn) => {
    const { t } = useTranslation();
    return (
        <DjCell
            props={props}
            render={(summary) => {
                const label = t('table.dj.cuesTooltip', {
                    cues: summary.cue_count,
                    loops: summary.loop_count,
                    memory: summary.memory_count,
                });
                return (
                    <Tooltip label={label} multiline={false}>
                        <Group gap="xs" wrap="nowrap">
                            <span className={styles.count}>{summary.cue_count}</span>
                            <CuePads summary={summary} />
                        </Group>
                    </Tooltip>
                );
            }}
        />
    );
};

export const DjGridColumn = (props: ItemTableListInnerColumn) => {
    const { t } = useTranslation();
    return (
        <DjCell
            props={props}
            render={(summary) =>
                summary.grid_state === 'none' ? '—' : t(`table.dj.grid.${summary.grid_state}`)
            }
        />
    );
};

export const DjSourceColumn = (props: ItemTableListInnerColumn) => (
    <DjCell props={props} render={(summary) => appName(summary.source_app)} />
);
