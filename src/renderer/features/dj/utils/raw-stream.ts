import { api } from '/@/renderer/api';
import { Song } from '/@/shared/types/domain-types';

/**
 * The song's original file, never a transcode (design-dj-ui §3.1). Navidrome's `raw`
 * format is what `transcode: true` asks for here, so the user's transcode setting
 * can't change what the waveform decodes or the prep view plays.
 */
export const rawStreamUrl = (song: Pick<Song, '_serverId' | 'id'>) =>
    api.controller.getStreamUrl({
        apiClientProps: { serverId: song._serverId },
        query: { format: 'raw', id: song.id, transcode: true },
    });
