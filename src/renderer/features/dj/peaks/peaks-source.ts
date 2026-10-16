import { Mp3Tag } from '/@/renderer/features/dj/utils/mp3-tag';
import { Song } from '/@/shared/types/domain-types';

// Subbox-only: where the DJ waveform's peaks come from (subbox-app#237, design-dj-ui
// §4.2). An interface so the UI doesn't care: track A decodes on the client
// (client-decode-peaks.ts); if track B builds the analysis service, server peaks from
// GET /track/{id}/waveform replace it by swapping the implementation.

/**
 * Per-band peaks for one track: the loudest sample in each window, low/mid/high, as
 * 0-255 against the loudest window of any band (so the bands keep their proportions).
 * Positions are decode time: index i covers [i, i+1) / peaksPerSecond seconds.
 */
export interface DjPeaks {
    durationSeconds: number;
    /**
     * The unfiltered signal's peak and RMS, 0-255 against its own loudest peak (#268):
     * the height of the RGB and Blue waveforms, and the solid body inside them. A source
     * without them draws from the bands instead.
     */
    full?: Uint8Array;
    high: Uint8Array;
    low: Uint8Array;
    mid: Uint8Array;
    /** An MP3's first-frame tag, read off the same bytes; WebKit's offset needs it (#252). */
    mp3Tag?: Mp3Tag | null;
    peaksPerSecond: number;
    rms?: Uint8Array;
}

export interface PeaksRequest {
    song: Pick<Song, '_serverId' | 'container' | 'id' | 'size' | 'updatedAt'>;
    subboxId: string;
}

export interface PeaksSource {
    load: (request: PeaksRequest, signal: AbortSignal) => Promise<DjPeaks>;
}
