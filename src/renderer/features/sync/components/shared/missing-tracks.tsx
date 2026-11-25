import { Button } from '/@/shared/components/button/button';
import { CopyButton } from '/@/shared/components/copy-button/copy-button';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { useDisclosure } from '/@/shared/hooks/use-disclosure';

export interface MissingTrack {
    location: string;
    playlists: string[];
    trackName: string;
}

/** One line per track, for pasting into a note or a support message. */
export const missingTracksText = (tracks: MissingTrack[]) =>
    tracks.map((t) => `${t.trackName}\t${t.location}\t${t.playlists.join(', ')}`).join('\n');

/**
 * Tracks the selected playlists list whose file isn't where the XML says, so they
 * were never uploaded and those playlists will be short of them. Used to be folded
 * into one "skipped (file not found, or already uploaded)" count, which hid it
 * (subbox-app#338).
 */
export const MissingTracks = ({ tracks }: { tracks: MissingTrack[] }) => {
    const [opened, { toggle }] = useDisclosure(false);
    if (tracks.length === 0) return null;
    return (
        <Stack align="center" gap={4}>
            <Text size="sm" ta="center">
                {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'} not found on this
                computer, so {tracks.length === 1 ? 'it was' : 'they were'} not uploaded. The
                playlists that contain {tracks.length === 1 ? 'it' : 'them'} are missing those
                entries. Relocate the files in Rekordbox, export the XML again and upload it to add
                them.
            </Text>
            <Group gap="xs" justify="center">
                <Button
                    onClick={toggle}
                    rightSection={<Icon icon={opened ? 'arrowUpS' : 'arrowDownS'} />}
                    size="xs"
                    variant="subtle"
                >
                    {opened ? 'Hide' : 'Show'} missing tracks
                </Button>
                <CopyButton timeout={2000} value={missingTracksText(tracks)}>
                    {({ copied, copy }) => (
                        <Button
                            leftSection={<Icon icon={copied ? 'check' : 'clipboardCopy'} />}
                            onClick={copy}
                            size="xs"
                            variant="subtle"
                        >
                            {copied ? 'Copied' : 'Copy list'}
                        </Button>
                    )}
                </CopyButton>
            </Group>
            {opened && (
                <div style={{ maxHeight: 220, overflowY: 'auto', width: '100%' }}>
                    <Stack gap={6}>
                        {tracks.map((t) => (
                            <Stack gap={0} key={t.location}>
                                <Text size="xs">{t.trackName}</Text>
                                <Text c="dimmed" size="xs" style={{ wordBreak: 'break-all' }}>
                                    {t.location}
                                </Text>
                                {t.playlists.length > 0 && (
                                    <Text c="dimmed" size="xs">
                                        In: {t.playlists.join(', ')}
                                    </Text>
                                )}
                            </Stack>
                        ))}
                    </Stack>
                </div>
            )}
        </Stack>
    );
};
