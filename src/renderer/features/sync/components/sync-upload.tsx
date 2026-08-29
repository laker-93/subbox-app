import {
    FormatSelect,
    SYNC_INTRO_MIH,
    SyncCenteredState,
} from '/@/renderer/features/sync/components/shared';
import { SyncRekordbox } from '/@/renderer/features/sync/components/sync-rekordbox';
import { SyncSerato } from '/@/renderer/features/sync/components/sync-serato';
import { useLibraryFormat, useSetLibraryFormat } from '/@/renderer/store';
import { Icon } from '/@/shared/components/icon/icon';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';

/**
 * One Upload tab for both DJ formats.
 *
 * There were two tabs — "Upload (Rekordbox)" and "Upload (Serato)" — only because the
 * format question had nowhere else to live. Given a control of its own it collapses to
 * one tab, and the choice is remembered.
 *
 * The two flows underneath stay separate components. They read genuinely different
 * things (an XML file versus a folder of crates) and share no state, so merging them
 * into one would mean a component with two of everything and a branch on every line.
 * What the user needed merged was the *question*, which is what this does.
 *
 * The control renders inside each flow's first screen rather than in a bar above them.
 * That is deliberate: it means format can only be changed before any work exists, so
 * switching never throws away a parsed library, and there is no guard to forget.
 */
export const SyncUpload = () => {
    const format = useLibraryFormat('upload');
    const setLibraryFormat = useSetLibraryFormat();

    const formatControl = (
        // No description under the control here. Each flow already says what it reads
        // in the line under its own title, and repeating it four words differently
        // below the buttons was the same sentence twice on one short screen.
        <FormatSelect
            // Every screen this lands on is a centred column, so the control centres
            // with it rather than sitting left of the line the title and prose hold.
            align="center"
            onChange={(next) => setLibraryFormat('upload', next)}
            value={format}
        />
    );

    // Nothing stored yet, so nothing is preselected. Being first in the list is not a
    // reason to inherit Rekordbox — which software a DJ uses is close to an identity
    // property, and guessing it wrong is worse than asking once.
    if (!format) {
        return (
            // Top-anchored, and 420 wide, like the two flow screens it hands over to:
            // the icon, title and control then stay on the same three lines all the way
            // through picking a format.
            <SyncCenteredState anchor="top" gap="lg" maw={420}>
                <Icon icon="disc" size="3rem" />
                <TextTitle order={3}>Upload To Sub-box</TextTitle>
                <Text c="dimmed" mih={SYNC_INTRO_MIH} size="sm" ta="center">
                    Which software is your library in? Sub-box reads your playlists and tracks
                    straight out of it, cue points and all.
                </Text>
                {formatControl}
            </SyncCenteredState>
        );
    }

    return format === 'serato' ? (
        <SyncSerato formatControl={formatControl} />
    ) : (
        <SyncRekordbox formatControl={formatControl} />
    );
};
