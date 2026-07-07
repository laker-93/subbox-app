import { z } from 'zod';

import { pymixType } from '/@/shared/api/pymix/pymix-types';

export type WishlistItem = z.infer<typeof pymixType._response.wishlistItem>;

export type WishlistStatus = WishlistItem['status'];

export const WISHLIST_STATUSES: WishlistStatus[] = [
    'inbox',
    'wishlist',
    'downloaded',
    'available',
    'ignored',
];

export type CreateWishlistItemRequest = z.infer<typeof pymixType._parameters.wishlistCreate>;

export type CreateWishlistItemsBulkRequest = z.infer<
    typeof pymixType._parameters.wishlistBulkCreate
>;

export type MatchMetadataRequest = z.infer<typeof pymixType._parameters.wishlistMatchMetadata>;

export type MatchMetadataResponse = z.infer<typeof pymixType._response.matchMetadataResponse>;

export type MatchYoutubeResponse = z.infer<typeof pymixType._response.matchYoutubeResponse>;

export type MusicBrainzMatch = NonNullable<MatchMetadataResponse['match']>;

export type ParseWishlistLinkRequest = z.infer<typeof pymixType._parameters.wishlistParseLink>;

export type ParseWishlistLinkResponse = z.infer<typeof pymixType._response.parseLinkResponse>;

export type UpdateWishlistItemRequest = z.infer<typeof pymixType._parameters.wishlistUpdate>;

export type WishlistBulkCreateResponse = z.infer<
    typeof pymixType._response.wishlistBulkCreateResponse
>;

export type WishlistItemResponse = z.infer<typeof pymixType._response.wishlistItemResponse>;

export type WishlistLinkMetadata = ParseWishlistLinkResponse['metadata'];

export type WishlistListResponse = z.infer<typeof pymixType._response.wishlistList>;

export type WishlistSetSheetRequest = z.infer<typeof pymixType._parameters.wishlistSetSheet>;

export type WishlistSetSheetResponse = z.infer<typeof pymixType._response.wishlistSetSheetResponse>;

export type WishlistSheetStatusResponse = z.infer<
    typeof pymixType._response.wishlistSheetStatusResponse
>;

export type YoutubeMatch = z.infer<typeof pymixType._response.youtubeMatch>;
