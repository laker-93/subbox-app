import {
    AlbumArtistListSort,
    AlbumListSort,
    ArtistListSort,
    GenreListSort,
    LibraryItem,
    PlaylistListSort,
    SongListSort,
} from '/@/shared/types/domain-types';
import { TableColumn } from '/@/shared/types/types';

/**
 * Which sort field each table column sorts by, per item type.
 *
 * A column absent from the map is not clickable to sort. A column present here is
 * still only clickable when that sort field is actually offered for the item type —
 * Navidrome and Subsonic differ on what the server can sort, and a playlist's songs
 * are sorted in the client — so consumers must intersect this with
 * `getListSortOptions`.
 *
 * Several title columns map to the same sort field (they render the same underlying
 * name), which is why the active column is resolved by comparing sort fields rather
 * than by reversing this map.
 */
const SONG_COLUMN_SORT_KEYS: Partial<Record<TableColumn, string>> = {
    [TableColumn.ALBUM]: SongListSort.ALBUM,
    [TableColumn.ALBUM_ARTIST]: SongListSort.ALBUM_ARTIST,
    [TableColumn.ARTIST]: SongListSort.ARTIST,
    [TableColumn.BPM]: SongListSort.BPM,
    [TableColumn.CHANNELS]: SongListSort.CHANNELS,
    [TableColumn.COMMENT]: SongListSort.COMMENT,
    [TableColumn.DATE_ADDED]: SongListSort.RECENTLY_ADDED,
    [TableColumn.DURATION]: SongListSort.DURATION,
    [TableColumn.GENRE]: SongListSort.GENRE,
    [TableColumn.GENRE_BADGE]: SongListSort.GENRE,
    [TableColumn.ID]: SongListSort.ID,
    [TableColumn.LAST_PLAYED]: SongListSort.RECENTLY_PLAYED,
    [TableColumn.PLAY_COUNT]: SongListSort.PLAY_COUNT,
    [TableColumn.RELEASE_DATE]: SongListSort.RELEASE_DATE,
    [TableColumn.TITLE]: SongListSort.NAME,
    [TableColumn.TITLE_ARTIST]: SongListSort.NAME,
    [TableColumn.TITLE_COMBINED]: SongListSort.NAME,
    [TableColumn.USER_FAVORITE]: SongListSort.FAVORITED,
    [TableColumn.USER_RATING]: SongListSort.RATING,
    [TableColumn.YEAR]: SongListSort.YEAR,
};

const ALBUM_COLUMN_SORT_KEYS: Partial<Record<TableColumn, string>> = {
    [TableColumn.ALBUM_ARTIST]: AlbumListSort.ALBUM_ARTIST,
    [TableColumn.ARTIST]: AlbumListSort.ARTIST,
    [TableColumn.DATE_ADDED]: AlbumListSort.RECENTLY_ADDED,
    [TableColumn.DURATION]: AlbumListSort.DURATION,
    [TableColumn.ID]: AlbumListSort.ID,
    [TableColumn.LAST_PLAYED]: AlbumListSort.RECENTLY_PLAYED,
    [TableColumn.PLAY_COUNT]: AlbumListSort.PLAY_COUNT,
    [TableColumn.RELEASE_DATE]: AlbumListSort.RELEASE_DATE,
    [TableColumn.SONG_COUNT]: AlbumListSort.SONG_COUNT,
    [TableColumn.TITLE]: AlbumListSort.NAME,
    [TableColumn.TITLE_ARTIST]: AlbumListSort.NAME,
    [TableColumn.TITLE_COMBINED]: AlbumListSort.NAME,
    [TableColumn.USER_FAVORITE]: AlbumListSort.FAVORITED,
    [TableColumn.USER_RATING]: AlbumListSort.RATING,
    [TableColumn.YEAR]: AlbumListSort.YEAR,
};

const ALBUM_ARTIST_COLUMN_SORT_KEYS: Partial<Record<TableColumn, string>> = {
    [TableColumn.ALBUM_COUNT]: AlbumArtistListSort.ALBUM_COUNT,
    [TableColumn.DATE_ADDED]: AlbumArtistListSort.RECENTLY_ADDED,
    [TableColumn.DURATION]: AlbumArtistListSort.DURATION,
    [TableColumn.PLAY_COUNT]: AlbumArtistListSort.PLAY_COUNT,
    [TableColumn.RELEASE_DATE]: AlbumArtistListSort.RELEASE_DATE,
    [TableColumn.SONG_COUNT]: AlbumArtistListSort.SONG_COUNT,
    [TableColumn.TITLE]: AlbumArtistListSort.NAME,
    [TableColumn.TITLE_ARTIST]: AlbumArtistListSort.NAME,
    [TableColumn.TITLE_COMBINED]: AlbumArtistListSort.NAME,
    [TableColumn.USER_FAVORITE]: AlbumArtistListSort.FAVORITED,
    [TableColumn.USER_RATING]: AlbumArtistListSort.RATING,
};

const ARTIST_COLUMN_SORT_KEYS: Partial<Record<TableColumn, string>> = {
    [TableColumn.ALBUM_COUNT]: ArtistListSort.ALBUM_COUNT,
    [TableColumn.DATE_ADDED]: ArtistListSort.RECENTLY_ADDED,
    [TableColumn.DURATION]: ArtistListSort.DURATION,
    [TableColumn.PLAY_COUNT]: ArtistListSort.PLAY_COUNT,
    [TableColumn.RELEASE_DATE]: ArtistListSort.RELEASE_DATE,
    [TableColumn.SONG_COUNT]: ArtistListSort.SONG_COUNT,
    [TableColumn.TITLE]: ArtistListSort.NAME,
    [TableColumn.TITLE_ARTIST]: ArtistListSort.NAME,
    [TableColumn.TITLE_COMBINED]: ArtistListSort.NAME,
    [TableColumn.USER_FAVORITE]: ArtistListSort.FAVORITED,
    [TableColumn.USER_RATING]: ArtistListSort.RATING,
};

const PLAYLIST_COLUMN_SORT_KEYS: Partial<Record<TableColumn, string>> = {
    [TableColumn.DURATION]: PlaylistListSort.DURATION,
    [TableColumn.OWNER]: PlaylistListSort.OWNER,
    [TableColumn.SONG_COUNT]: PlaylistListSort.SONG_COUNT,
    [TableColumn.TITLE]: PlaylistListSort.NAME,
    [TableColumn.TITLE_ARTIST]: PlaylistListSort.NAME,
    [TableColumn.TITLE_COMBINED]: PlaylistListSort.NAME,
};

const GENRE_COLUMN_SORT_KEYS: Partial<Record<TableColumn, string>> = {
    [TableColumn.TITLE]: GenreListSort.NAME,
    [TableColumn.TITLE_ARTIST]: GenreListSort.NAME,
    [TableColumn.TITLE_COMBINED]: GenreListSort.NAME,
};

export const COLUMN_SORT_KEYS: Partial<Record<LibraryItem, Partial<Record<TableColumn, string>>>> =
    {
        [LibraryItem.ALBUM]: ALBUM_COLUMN_SORT_KEYS,
        [LibraryItem.ALBUM_ARTIST]: ALBUM_ARTIST_COLUMN_SORT_KEYS,
        [LibraryItem.ARTIST]: ARTIST_COLUMN_SORT_KEYS,
        [LibraryItem.GENRE]: GENRE_COLUMN_SORT_KEYS,
        [LibraryItem.PLAYLIST]: PLAYLIST_COLUMN_SORT_KEYS,
        // A playlist's song table shows song columns and sorts by song fields; only the
        // set of fields on offer differs (client-side, so `getListSortOptions` gates it).
        [LibraryItem.PLAYLIST_SONG]: SONG_COLUMN_SORT_KEYS,
        [LibraryItem.SONG]: SONG_COLUMN_SORT_KEYS,
    };
