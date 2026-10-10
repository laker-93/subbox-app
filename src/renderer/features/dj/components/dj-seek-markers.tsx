import { useMemo } from 'react';

import styles from './dj-seek-markers.module.css';

import { useDjMode } from '/@/renderer/features/dj/hooks/use-dj-mode';
import { useTrackDj } from '/@/renderer/features/dj/hooks/use-track-dj';
import { djMarks } from '/@/renderer/features/dj/utils/dj-marks';
import { codecOf, currentEngine } from '/@/renderer/features/dj/utils/dj-offset';
import { subboxIdOf } from '/@/renderer/features/dj/utils/subbox-id';
import { usePlayerSong } from '/@/renderer/store';

// Subbox-only: the playing track's hot cues and loops over the playerbar's seek bar
// (subbox-app#238, design-dj-ui §5.1). A layer on top of whichever bar is showing, the
// waveform or the slider, and never in the way of seeking: it takes no pointer events.
//
// The playerbar's waveform is still the 64 kbps transcode (§4.2): at this scale a pixel
// is hundreds of milliseconds, so its timing error doesn't show. Positions still go
// through dj-offset, like everything else that draws a stored time. DJ mode only.

const percent = (seconds: number, duration: number) =>
    `${Math.min(100, Math.max(0, (seconds / duration) * 100))}%`;

export const DjSeekMarkers = () => {
    const djMode = useDjMode();
    const song = usePlayerSong();
    const subboxId = subboxIdOf(song);
    const { data: dj } = useTrackDj(subboxId, { enabled: djMode.enabled });
    const duration = (song?.duration ?? 0) / 1000;

    const marks = useMemo(
        () =>
            dj && duration
                ? djMarks(dj.cuedata, duration, {
                      codec: codecOf(song?.container),
                      engine: currentEngine(),
                  })
                : null,
        [dj, duration, song?.container],
    );

    if (!djMode.enabled || !marks || (!marks.cues.length && !marks.loops.length)) return null;

    return (
        <div aria-hidden className={styles.layer}>
            {marks.loops.map((loop) => (
                <span
                    className={styles.loop}
                    key={`loop-${loop.slot}`}
                    style={{
                        background: loop.color,
                        left: percent(loop.startSeconds, duration),
                        width: `calc(${percent(loop.endSeconds, duration)} - ${percent(loop.startSeconds, duration)})`,
                    }}
                />
            ))}
            {marks.cues.map((cue) => (
                <span
                    className={styles.cue}
                    key={`cue-${cue.slot}`}
                    style={{ background: cue.color, left: percent(cue.seconds, duration) }}
                >
                    <span className={styles.flag} style={{ background: cue.color }}>
                        {cue.label}
                    </span>
                </span>
            ))}
        </div>
    );
};
