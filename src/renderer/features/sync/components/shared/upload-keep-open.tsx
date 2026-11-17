import { Text } from '/@/shared/components/text/text';

/**
 * Shown under an upload in progress. The transfer runs in this app, straight to the
 * server, so quitting it or closing the laptop lid stops it partway. The app already
 * keeps an idle machine awake (keepAwake in network-retry.ts), but nothing can keep
 * a closed lid from sleeping. A 2026-11-16 Serato upload froze at 4 of 18 GB after
 * an eleven-minute gap that looked like exactly that.
 *
 * The second sentence matters as much as the first: a run that does get cut short
 * isn't lost, because the next attempt skips every file already sent whole.
 */
export const UploadKeepOpen = () => (
    <Text c="dimmed" size="xs" ta="center">
        Keep Subbox open and your laptop lid open until this finishes. If it gets interrupted, start
        the upload again: files already sent are skipped.
    </Text>
);
