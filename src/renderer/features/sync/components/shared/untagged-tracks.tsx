import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

const MAX_LISTED = 5;

/**
 * Tracks that reached the server but could not be tagged there, so the import left
 * them out, each with the server's reason ("the file was empty: …"). The rest of
 * the upload was imported without waiting on them (subbox-app#310).
 */
export const UntaggedTracks = ({
    tracks,
}: {
    tracks: Array<{ reason: string; trackName: string }>;
}) => {
    if (tracks.length === 0) return null;
    return (
        <Stack align="center" gap={2}>
            <Text size="sm" ta="center">
                {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'} uploaded but could not be
                imported, so the playlists that contain them are missing those entries.
            </Text>
            {tracks.slice(0, MAX_LISTED).map((t) => (
                <Text c="dimmed" key={`${t.trackName}:${t.reason}`} size="xs" ta="center">
                    {t.trackName}: {t.reason}
                </Text>
            ))}
            {tracks.length > MAX_LISTED && (
                <Text c="dimmed" size="xs" ta="center">
                    …and {tracks.length - MAX_LISTED} more
                </Text>
            )}
        </Stack>
    );
};
