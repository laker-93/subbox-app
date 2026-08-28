/**
 * Byte and duration formatting for the Sync screens.
 *
 * Written out twice before this, identically, in sync-download.tsx and
 * sync-external-drive.tsx — and they have to agree: the same plan's size is
 * quoted on both screens.
 */

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${SIZE_UNITS[i]}`;
};

export const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};
