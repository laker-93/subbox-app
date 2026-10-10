import { Song } from '/@/shared/types/domain-types';

/** A song's subbox_id, from the custom tag Navidrome reads off the file. */
export const subboxIdOf = (song?: null | Pick<Song, 'tags'>): null | string =>
    song?.tags?.subboxid?.[0] || song?.tags?.subbox_id?.[0] || null;
