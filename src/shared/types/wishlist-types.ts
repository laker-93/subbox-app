export type WishlistStatus = 'wishlist' | 'downloaded' | 'imported' | 'available' | 'ignored';

export type WishlistItem = {
    id: string;
    artist: string;
    title: string;
    album?: string;
    status: WishlistStatus;
    youtubeVideoId?: string;
    youtubeUrl?: string;
    linkedTrackId?: string;
    createdAt: string;
    updatedAt: string;
};

export type WishlistListResponse = {
    items: WishlistItem[];
    totalRecordCount: number;
};

export type CreateWishlistItemRequest = {
    artist: string;
    title: string;
    album?: string;
};

export type UpdateWishlistItemRequest = {
    status?: WishlistStatus;
    album?: string;
};

export type MatchYoutubeResponse = {
    youtubeVideoId?: string;
    youtubeUrl?: string;
};
