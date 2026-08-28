import type { ReactNode } from 'react';

import { SyncCenteredState } from '/@/renderer/features/sync/components/shared/sync-centered-state';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';

interface SyncLoadingProps {
    /** One dimmed line: what is happening, in the present tense. */
    label: string;
}

interface SyncProgressProps {
    /**
     * The tracks in flight right now. Uploads run several at a time, so this is a
     * list rather than one line — showing only the newest made a parallel upload
     * look like it kept restarting.
     */
    activeTracks?: string[];
    /**
     * The single track older progress payloads report. Shown only when
     * `activeTracks` is empty, so a server that sends both doesn't print each
     * track twice.
     */
    currentTrack?: string;
    /** Lines under the tracks — counts, percentages, the long-library warning. */
    detail?: ReactNode;
    /** What phase the job is in, as a heading. */
    phaseLabel: string;
}

/**
 * A step that is only waiting: spinner, one line, no numbers.
 *
 * Use `SyncProgress` instead as soon as there is something to count — a bare
 * spinner over a long job is the shape of the blind-until-idle bug (laker-93 #83).
 */
export const SyncLoading = ({ label }: SyncLoadingProps) => (
    <SyncCenteredState>
        <Spinner />
        <Text c="dimmed" size="sm">
            {label}
        </Text>
    </SyncCenteredState>
);

/** A step that is doing work it can report on: spinner, phase heading, what's moving. */
export const SyncProgress = ({
    activeTracks = [],
    currentTrack,
    detail,
    phaseLabel,
}: SyncProgressProps) => (
    <SyncCenteredState>
        <Spinner />
        <TextTitle order={4}>{phaseLabel}</TextTitle>
        {activeTracks.map((track, idx) => (
            <Text c="dimmed" key={`${idx}-${track}`} size="sm" ta="center">
                {track}
            </Text>
        ))}
        {activeTracks.length === 0 && currentTrack && (
            <Text c="dimmed" size="sm" ta="center">
                {currentTrack}
            </Text>
        )}
        {detail}
    </SyncCenteredState>
);
