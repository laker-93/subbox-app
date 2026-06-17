import { z } from 'zod';

import { pymixType } from '/@/shared/api/pymix/pymix-types';

export type WishlistItem = z.infer<typeof pymixType._response.wishlistItem>;

export type WishlistStatus = WishlistItem['status'];

export const WISHLIST_STATUSES: WishlistStatus[] = [
    'inbox',
    'wishlist',
    'downloaded',
    'imported',
    'available',
    'ignored',
];

export type CreateWishlistItemRequest = z.infer<typeof pymixType._parameters.wishlistCreate>;

export type MatchYoutubeResponse = z.infer<typeof pymixType._response.matchYoutubeResponse>;

export type UpdateWishlistItemRequest = z.infer<typeof pymixType._parameters.wishlistUpdate>;

export type WishlistItemResponse = z.infer<typeof pymixType._response.wishlistItemResponse>;

export type WishlistListResponse = z.infer<typeof pymixType._response.wishlistList>;

export type WishlistSetSheetRequest = z.infer<typeof pymixType._parameters.wishlistSetSheet>;

export type WishlistSetSheetResponse = z.infer<typeof pymixType._response.wishlistSetSheetResponse>;

export type YoutubeMatch = z.infer<typeof pymixType._response.youtubeMatch>;
