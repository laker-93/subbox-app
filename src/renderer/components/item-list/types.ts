import { ItemListStateActions } from '/@/renderer/components/item-list/helpers/item-list-state';
import {
    Album,
    AlbumArtist,
    Artist,
    Folder,
    Genre,
    LibraryItem,
    Playlist,
    Song,
} from '/@/shared/types/domain-types';
import { SortOrder } from '/@/shared/types/domain-types';
import { Play, TableColumn } from '/@/shared/types/types';

export interface DefaultItemControlProps {
    event: null | React.MouseEvent<unknown>;
    index?: number;
    internalState?: ItemListStateActions;
    item: ItemListItem | undefined;
    itemType: LibraryItem;
    meta?: Record<string, any>;
}

export interface ItemControls {
    onClick?: ({ index, internalState, item, itemType }: DefaultItemControlProps) => void;
    onColumnReordered?: ({
        columnIdFrom,
        columnIdTo,
        edge,
    }: {
        columnIdFrom: TableColumn;
        columnIdTo: TableColumn;
        edge: 'bottom' | 'left' | 'right' | 'top' | null;
    }) => void;
    onColumnResized?: ({ columnId, width }: { columnId: TableColumn; width: number }) => void;
    onDoubleClick?: ({ index, internalState, item, itemType }: DefaultItemControlProps) => void;
    onExpand?: ({ index, internalState, item, itemType }: DefaultItemControlProps) => void;
    onFavorite?: ({
        index,
        internalState,
        item,
        itemType,
    }: DefaultItemControlProps & { favorite: boolean }) => void;
    onMore?: ({ index, internalState, item, itemType }: DefaultItemControlProps) => void;
    onPlay?: ({
        index,
        internalState,
        item,
        itemType,
        playType,
    }: DefaultItemControlProps & { playType: Play }) => void;
    onRating?: ({
        index,
        internalState,
        item,
        itemType,
        rating,
    }: DefaultItemControlProps & { rating: number }) => void;
}

/**
 * Click-to-sort state for a table's header row. Produced by `useItemListColumnSort`
 * and threaded down to the header cells; absent when a table has no server-side sort
 * (playlist detail and the queue keep their manual order).
 */
export interface ItemListColumnSort {
    /** Sortable columns, mapped to the sort field each one sorts by. */
    columnSortKeys: Map<TableColumn, string>;
    /** Clicking a column: its natural direction when new, flipped when already sorted. */
    onSort: (columnId: TableColumn) => void;
    sortBy?: string;
    sortOrder?: SortOrder;
}

/**
 * Column visibility for a table's header menu. Produced by `useItemListColumnVisibility`;
 * the same settings the configure modal writes, so the two surfaces stay in lockstep.
 */
export interface ItemListColumnVisibility {
    columns: { id: TableColumn; isEnabled: boolean; label: string }[];
    onToggleColumn: (columnId: TableColumn) => void;
}

export interface ItemListComponentProps<TQuery> {
    itemsPerPage?: number;
    query: Omit<TQuery, 'limit' | 'startIndex'>;
    saveScrollOffset?: boolean;
    serverId: string;
}

export interface ItemListGridComponentProps<TQuery> extends ItemListComponentProps<TQuery> {
    gap?: 'lg' | 'md' | 'sm' | 'xl' | 'xs';
    itemsPerRow?: number;
    size?: 'compact' | 'default' | 'large';
}

export interface ItemListHandle {
    internalState: ItemListStateActions;
    scrollToIndex: (
        index: number,
        options?: { align?: 'bottom' | 'center' | 'top'; behavior?: 'auto' | 'smooth' },
    ) => void;
    scrollToOffset: (offset: number, options?: { behavior?: 'auto' | 'smooth' }) => void;
}

export type ItemListItem =
    | Album
    | AlbumArtist
    | Artist
    | Folder
    | Genre
    | Playlist
    | Song
    | undefined;

export interface ItemListTableComponentProps<TQuery> extends ItemListComponentProps<TQuery> {
    autoFitColumns?: boolean;
    columns: ItemTableListColumnConfig[];
    enableAlternateRowColors?: boolean;
    enableHeader?: boolean;
    enableHorizontalBorders?: boolean;
    enableRowHoverHighlight?: boolean;
    enableSelection?: boolean;
    enableVerticalBorders?: boolean;
    size?: 'compact' | 'default' | 'large';
}

export interface ItemTableListColumnConfig {
    align: 'center' | 'end' | 'start';
    autoSize?: boolean;
    id: TableColumn;
    isEnabled: boolean;
    pinned: 'left' | 'right' | null;
    width: number;
}
