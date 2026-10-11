import dayjs from 'dayjs';

import { gridSegments } from '/@/renderer/features/dj/utils/beatgrid';
import { DjCuedata } from '/@/shared/api/pymix/pymix-types';
import { Song } from '/@/shared/types/domain-types';

// Subbox-only: how the prep view writes DJ data out (subbox-app#239). Times shown are
// DJ-app times, as the user's DJ app shows them, not decode times.

/** `1:32.512` from milliseconds. */
export const formatDjTime = (ms: number) => {
    const total = Math.max(0, Math.round(ms));
    const minutes = Math.floor(total / 60_000);
    const seconds = Math.floor((total % 60_000) / 1000);
    const millis = total % 1000;
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
};

export const formatBpm = (bpm: number) => bpm.toFixed(2);

const APP_NAMES: Record<string, string> = {
    rekordbox: 'Rekordbox',
    serato: 'Serato',
    subbox: 'subbox',
};

/** `Serato` from `serato`; an origin like `serato:import` names its app first. */
export const appName = (value: null | string | undefined) => {
    if (!value) return null;
    const app = value.split(/[:/]/)[0].toLowerCase();
    return APP_NAMES[app] ?? value;
};

/** pymix sends epoch seconds; milliseconds are taken too. */
export const formatUpdatedAt = (value: null | number | undefined) => {
    if (!value) return null;
    return dayjs(value < 1e12 ? value * 1000 : value).format('YYYY-MM-DD');
};

/** `FLAC · 44.1 kHz · 24-bit`, whatever of it Navidrome knows. */
export const formatAudioFormat = (song: Pick<Song, 'bitDepth' | 'container' | 'sampleRate'>) =>
    [
        song.container?.toUpperCase(),
        song.sampleRate ? `${+(song.sampleRate / 1000).toFixed(1)} kHz` : null,
        song.bitDepth ? `${song.bitDepth}-bit` : null,
    ]
        .filter(Boolean)
        .join(' · ');

export interface GridSummary {
    anchors: number;
    beatsPerBar: null | number;
    /** Every tempo the grid has, in order, without repeats. */
    bpms: number[];
    firstAnchorMs: null | number;
}

export const gridSummary = (cuedata: DjCuedata | null | undefined, durationMs: number) => {
    const anchors = cuedata?.beatgrid ?? [];
    const segments = gridSegments(anchors, durationMs);
    const bpms: number[] = [];
    for (const segment of segments) {
        if (!bpms.length || Math.abs(bpms[bpms.length - 1] - segment.bpm) >= 0.005) {
            bpms.push(segment.bpm);
        }
    }
    return {
        anchors: anchors.length,
        beatsPerBar: segments[0]?.beatsPerBar ?? null,
        bpms,
        firstAnchorMs: anchors.length ? anchors[0].position_ms : null,
    } satisfies GridSummary;
};

/**
 * A loop's length in bars of the grid under its start, when that's a whole number of
 * beats; null without a grid or for a loop that isn't beat-length.
 */
export const loopBars = (
    cuedata: DjCuedata | null | undefined,
    startMs: number,
    endMs: number,
    durationMs: number,
) => {
    const segments = gridSegments(cuedata?.beatgrid ?? [], durationMs);
    const segment = segments.find((s) => startMs >= s.startMs && startMs < s.endMs) ?? segments[0];
    if (!segment) return null;
    const beats = ((endMs - startMs) * segment.bpm) / 60_000;
    if (beats < 0.5 || Math.abs(beats - Math.round(beats)) > 0.05) return null;
    return Math.round(beats) / segment.beatsPerBar;
};
