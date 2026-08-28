import type { ItemListStateItem } from '/@/renderer/components/item-list/helpers/item-list-state';
import type { LibraryItem } from '/@/shared/types/domain-types';

import merge from 'lodash/merge';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { createWithEqualityFn } from 'zustand/traditional';

import { AlbumListSort, SongListSort, SortOrder } from '/@/shared/types/domain-types';
import { Platform } from '/@/shared/types/types';

export type AppMode = 'library' | 'sync';

export interface AppSlice extends AppState {
    actions: {
        setAlbumArtistDetailFavoriteSongsSort: (sortBy: SongListSort, sortOrder: SortOrder) => void;
        setAlbumArtistDetailGroupingType: (groupingType: 'all' | 'primary') => void;
        setAlbumArtistDetailSort: (sortBy: AlbumListSort, sortOrder: SortOrder) => void;
        setAlbumArtistIdsMode: (mode: 'and' | 'or') => void;
        setAlbumArtistSelectMode: (mode: 'multi' | 'single') => void;
        setAppMode: (mode: AppMode) => void;
        setAppStore: (data: Partial<AppSlice>) => void;
        setArtistIdsMode: (mode: 'and' | 'or') => void;
        setArtistSelectMode: (mode: 'multi' | 'single') => void;
        setCommandPaletteSearchSectionExpanded: (sectionId: string, expanded: boolean) => void;
        setGenreIdsMode: (mode: 'and' | 'or') => void;
        setGenreSelectMode: (mode: 'multi' | 'single') => void;
        setGlobalExpanded: (value: GlobalExpandedState | null) => void;
        setLibraryFormat: (direction: SyncDirection, format: LibraryFormat) => void;
        setPageSidebar: (key: string, value: boolean) => void;
        setPrivateMode: (enabled: boolean) => void;
        setSeratoFolder: (folder: null | string) => void;
        setShowTimeRemaining: (enabled: boolean) => void;
        setSideBar: (options: Partial<SidebarProps>) => void;
        setTitleBar: (options: Partial<TitlebarProps>) => void;
        setWishlistSort: (sortBy: WishlistSortBy, sortOrder: SortOrder) => void;
        setWishlistStatusFilter: (statusFilter: WishlistStatusFilter) => void;
    };
}

export interface AppState {
    albumArtistDetailFavoriteSongsSort: {
        sortBy: SongListSort;
        sortOrder: SortOrder;
    };
    albumArtistDetailSort: {
        groupingType: 'all' | 'primary';
        sortBy: AlbumListSort;
        sortOrder: SortOrder;
    };
    albumArtistIdsMode: 'and' | 'or';
    albumArtistSelectMode: 'multi' | 'single';
    appMode: AppMode;
    artistIdsMode: 'and' | 'or';
    artistSelectMode: 'multi' | 'single';
    commandPalette: CommandPaletteProps;
    commandPaletteSearchSectionsExpanded: Record<string, boolean>;
    genreIdsMode: 'and' | 'or';
    genreSelectMode: 'multi' | 'single';
    globalExpanded: GlobalExpandedState | null;
    isReorderingQueue: boolean;
    /**
     * Which DJ software the Sync screens default to, remembered per direction.
     *
     * Per direction rather than globally because migrating between the two --
     * import Serato, export Rekordbox -- is a thing subbox is for, and one shared
     * value would fight that user on every screen.
     */
    libraryFormat: Record<SyncDirection, LibraryFormat | null>;
    pageSidebar: Record<string, boolean>;
    platform: Platform;
    privateMode: boolean;
    /**
     * The user's `_Serato_` library folder, remembered across sessions.
     *
     * It used to be two independent `useState`s -- one in the Serato upload flow, one
     * in Download's crate writer -- so the same folder was browsed for twice and
     * forgotten every session. Persisted here beside `libraryFormat` because it is
     * the same fact about the user: where their library lives.
     *
     * Desktop-only in practice (a browser cannot reach it), but harmless on web,
     * where nothing reads it.
     */
    seratoFolder: null | string;
    showTimeRemaining: boolean;
    sidebar: SidebarProps;
    titlebar: TitlebarProps;
    wishlistSort: {
        sortBy: WishlistSortBy;
        sortOrder: SortOrder;
    };
    wishlistStatusFilter: WishlistStatusFilter;
}

export interface GlobalExpandedState {
    item: ItemListStateItem;
    itemType: LibraryItem;
}

/** The DJ software a Sync screen is reading from or writing for. */
export type LibraryFormat = 'rekordbox' | 'serato';

/** Which way the library is moving. Format is remembered separately for each. */
export type SyncDirection = 'download' | 'upload';

export type WishlistSortBy = 'album' | 'artist' | 'createdAt' | 'status' | 'title';

export type WishlistStatusFilter =
    | 'all'
    | 'available'
    | 'downloaded'
    | 'ignored'
    | 'inbox'
    | 'wishlist';

type CommandPaletteProps = {
    close: () => void;
    open: () => void;
    opened: boolean;
    toggle: () => void;
};

type SidebarProps = {
    collapsed: boolean;
    expanded: string[];
    image: boolean;
    leftWidth: string;
    rightExpanded: boolean;
    rightHeight: string;
    rightWidth: string;
};

type TitlebarProps = {
    backgroundColor: string;
    outOfView: boolean;
};

export const useAppStore = createWithEqualityFn<AppSlice>()(
    persist(
        devtools(
            immer((set, get) => ({
                actions: {
                    setAlbumArtistDetailFavoriteSongsSort: (sortBy, sortOrder) => {
                        set((state) => {
                            state.albumArtistDetailFavoriteSongsSort = {
                                sortBy,
                                sortOrder,
                            };
                        });
                    },
                    setAlbumArtistDetailGroupingType: (groupingType) => {
                        set((state) => {
                            state.albumArtistDetailSort.groupingType = groupingType;
                        });
                    },
                    setAlbumArtistDetailSort: (sortBy, sortOrder) => {
                        set((state) => {
                            state.albumArtistDetailSort = {
                                ...state.albumArtistDetailSort,
                                sortBy,
                                sortOrder,
                            };
                        });
                    },
                    setAlbumArtistIdsMode: (mode) => {
                        set((state) => {
                            state.albumArtistIdsMode = mode;
                        });
                    },
                    setAlbumArtistSelectMode: (mode) => {
                        set((state) => {
                            state.albumArtistSelectMode = mode;
                        });
                    },
                    setAppMode: (mode) => {
                        set((state) => {
                            state.appMode = mode;
                        });
                    },
                    setAppStore: (data) => {
                        set({ ...get(), ...data });
                    },
                    setArtistIdsMode: (mode) => {
                        set((state) => {
                            state.artistIdsMode = mode;
                        });
                    },
                    setArtistSelectMode: (mode) => {
                        set((state) => {
                            state.artistSelectMode = mode;
                        });
                    },
                    setCommandPaletteSearchSectionExpanded: (sectionId, expanded) => {
                        set((state) => {
                            state.commandPaletteSearchSectionsExpanded[sectionId] = expanded;
                        });
                    },
                    setGenreIdsMode: (mode) => {
                        set((state) => {
                            state.genreIdsMode = mode;
                        });
                    },
                    setGenreSelectMode: (mode) => {
                        set((state) => {
                            state.genreSelectMode = mode;
                        });
                    },
                    setGlobalExpanded: (value) => {
                        set((state) => {
                            state.globalExpanded = value;
                        });
                    },
                    setLibraryFormat: (direction, format) => {
                        set((state) => {
                            state.libraryFormat[direction] = format;
                        });
                    },
                    setPageSidebar: (key, value) => {
                        set((state) => {
                            state.pageSidebar[key] = value;
                        });
                    },
                    setPrivateMode: (privateMode) => {
                        set((state) => {
                            state.privateMode = privateMode;
                        });
                    },
                    setSeratoFolder: (folder) => {
                        set((state) => {
                            state.seratoFolder = folder;
                        });
                    },
                    setShowTimeRemaining: (showTimeRemaining) => {
                        set((state) => {
                            state.showTimeRemaining = showTimeRemaining;
                        });
                    },
                    setSideBar: (options) => {
                        set((state) => {
                            state.sidebar = { ...state.sidebar, ...options };
                        });
                    },
                    setTitleBar: (options) => {
                        set((state) => {
                            state.titlebar = { ...state.titlebar, ...options };
                        });
                    },
                    setWishlistSort: (sortBy, sortOrder) => {
                        set((state) => {
                            state.wishlistSort = { sortBy, sortOrder };
                        });
                    },
                    setWishlistStatusFilter: (statusFilter) => {
                        set((state) => {
                            state.wishlistStatusFilter = statusFilter;
                        });
                    },
                },
                albumArtistDetailFavoriteSongsSort: {
                    sortBy: SongListSort.ID,
                    sortOrder: SortOrder.ASC,
                },
                albumArtistDetailSort: {
                    groupingType: 'primary',
                    sortBy: AlbumListSort.RELEASE_DATE,
                    sortOrder: SortOrder.DESC,
                },
                albumArtistIdsMode: 'and',
                albumArtistSelectMode: 'multi',
                appMode: 'library' as AppMode,
                artistIdsMode: 'and',
                artistSelectMode: 'multi',
                commandPalette: {
                    close: () => {
                        set((state) => {
                            state.commandPalette.opened = false;
                        });
                    },
                    open: () => {
                        set((state) => {
                            state.commandPalette.opened = true;
                        });
                    },
                    opened: false,
                    toggle: () => {
                        set((state) => {
                            state.commandPalette.opened = !state.commandPalette.opened;
                        });
                    },
                },
                commandPaletteSearchSectionsExpanded: {},
                genreIdsMode: 'and',
                genreSelectMode: 'multi',
                globalExpanded: null,
                isReorderingQueue: false,
                // Download starts on Rekordbox; Upload starts on neither. Not an
                // inconsistency: Download already worked without asking, and its
                // control sits *after* the user has picked playlists and waited for
                // a plan -- defaulting to nothing there means a dead button at the
                // end of the work. Upload asks before anything is invested.
                libraryFormat: {
                    download: 'rekordbox',
                    upload: null,
                },
                pageSidebar: {
                    album: true,
                    song: true,
                },
                platform: Platform.WINDOWS,
                privateMode: false,
                // No migrate branch: `merge(currentState, persistedState)` fills a key
                // the persisted state has never heard of from the initial state.
                seratoFolder: null,
                showTimeRemaining: false,
                sidebar: {
                    collapsed: false,
                    expanded: [],
                    image: false,
                    leftWidth: '400px',
                    rightExpanded: false,
                    rightHeight: '320px',
                    rightWidth: '600px',
                },
                titlebar: {
                    backgroundColor: '#000000',
                    outOfView: false,
                },
                wishlistSort: {
                    sortBy: 'createdAt',
                    sortOrder: SortOrder.DESC,
                },
                wishlistStatusFilter: 'all',
            })),
            { name: 'store_app' },
        ),
        {
            merge: (persistedState, currentState) => {
                return merge(currentState, persistedState);
            },
            migrate: (persistedState, version) => {
                if (version <= 2) {
                    return {} as AppSlice;
                }

                const state = persistedState as AppSlice;
                if (version <= 4 && !state.sidebar.rightHeight) {
                    state.sidebar.rightHeight = '320px';
                }

                if (version <= 5 && !state.libraryFormat) {
                    state.libraryFormat = { download: 'rekordbox', upload: null };
                }

                return state;
            },
            name: 'store_app',
            partialize: (state) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars -- ignore non-persisted state
                const { globalExpanded: _, ...rest } = state;
                return rest;
            },
            version: 6,
        },
    ),
);

export const useAppStoreActions = () => useAppStore((state) => state.actions);

export const useSidebarStore = () => useAppStore((state) => state.sidebar);

export const useSidebarRightExpanded = () => useAppStore((state) => state.sidebar.rightExpanded);

export const useSetTitlebar = () => useAppStore((state) => state.actions.setTitleBar);

export const useTitlebarStore = () => useAppStore((state) => state.titlebar);

export const useAppMode = () => useAppStore((state) => state.appMode);

export const useSetAppMode = () => useAppStore((state) => state.actions.setAppMode);

export const useCommandPalette = () => useAppStore((state) => state.commandPalette);

export const usePageSidebar = (key: string): [boolean, (value: boolean) => void] => {
    const isOpen = useAppStore((state) => state.pageSidebar[key] ?? false);
    const setPageSidebar = useAppStore((state) => state.actions.setPageSidebar);

    const setIsOpen = (value: boolean) => {
        setPageSidebar(key, value);
    };

    return [isOpen, setIsOpen];
};

export const useLibraryFormat = (direction: SyncDirection) =>
    useAppStore((state) => state.libraryFormat[direction]);

export const useSetLibraryFormat = () => useAppStore((state) => state.actions.setLibraryFormat);

export const useSeratoFolder = () => useAppStore((state) => state.seratoFolder);

export const useSetSeratoFolder = () => useAppStore((state) => state.actions.setSeratoFolder);

export const useGlobalExpanded = () => useAppStore((state) => state.globalExpanded);

export const useSetGlobalExpanded = () => useAppStore((state) => state.actions.setGlobalExpanded);

export const useWishlistSort = () => useAppStore((state) => state.wishlistSort);

export const useWishlistStatusFilter = () => useAppStore((state) => state.wishlistStatusFilter);

export const useGlobalExpandedState = () => {
    const globalExpanded = useGlobalExpanded();
    const setGlobalExpanded = useSetGlobalExpanded();

    const clearGlobalExpanded = () => setGlobalExpanded(null);

    return { clearGlobalExpanded, globalExpanded, setGlobalExpanded };
};
