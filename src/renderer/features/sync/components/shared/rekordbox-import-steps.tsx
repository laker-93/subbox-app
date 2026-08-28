import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';

interface RekordboxImportStepsProps {
    /** Where to start numbering, for a modal with steps of its own in front. */
    startAt?: number;
}

/**
 * The three steps that turn a downloaded XML into playlists in Rekordbox.
 *
 * These are a fact about Rekordbox, not about any one Sync screen, and they were
 * written out three times across two files — twice in sync-download.tsx alone,
 * behind two different info icons on the same screen. Each caller keeps its own
 * intro and any steps either side; this is the part that is always the same.
 */
export const RekordboxImportSteps = ({ startAt = 1 }: RekordboxImportStepsProps) => (
    <>
        <Stack gap="xs">
            <TextTitle order={5}>{startAt}. Enable the XML View</TextTitle>
            <Text size="sm">
                Open Rekordbox, go to Preferences (File &gt; Preferences), click the View tab, and
                ensure &quot;rekordbox xml&quot; is checked under the Layout section.
            </Text>
        </Stack>
        <Stack gap="xs">
            <TextTitle order={5}>{startAt + 1}. Link Your XML File</TextTitle>
            <Text size="sm">
                In the same Preferences window, navigate to the Advanced tab. Under the Database
                section, find Imported Library and click the Browse button to locate and select your
                .xml file.
            </Text>
        </Stack>
        <Stack gap="xs">
            <TextTitle order={5}>{startAt + 2}. Import to Collection</TextTitle>
            <Text size="sm">
                Close the Preferences window. On the far left of your Rekordbox screen, click the
                newly appeared rekordbox xml icon. Click the little drop-down arrow/play button to
                refresh the file. Right-click your desired playlists and click Import Playlist to
                bring them into your primary Rekordbox collection.
            </Text>
        </Stack>
    </>
);
