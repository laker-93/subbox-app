import clsx from 'clsx';
import formatDuration from 'format-duration';
import { lazy, Suspense } from 'react';

import { PlayerbarSeekSlider } from './playerbar-seek-slider';
import styles from './playerbar-slider.module.css';

import { DjSeekMarkers } from '/@/renderer/features/dj/components/dj-seek-markers';
import { usePlayerbarPrepSession } from '/@/renderer/features/dj/prep/prep-session.store';
import {
    useAppStore,
    useAppStoreActions,
    usePlayerSong,
    usePlayerTimestamp,
} from '/@/renderer/store';
import { PlayerbarSliderType, usePlayerbarSlider } from '/@/renderer/store/settings.store';
import { Slider, SliderProps } from '/@/shared/components/slider/slider';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Text } from '/@/shared/components/text/text';
import { PlaybackSelectors } from '/@/shared/constants/playback-selectors';

const PlayerbarWaveform = lazy(() =>
    import('./playerbar-waveform').then((module) => ({
        default: module.PlayerbarWaveform,
    })),
);

export const PlayerbarSlider = () => {
    const currentSong = usePlayerSong();
    const playerbarSlider = usePlayerbarSlider();
    // DJ prep view open: show and seek its audio, in the DJ apps' time (ms precision).
    const prepSession = usePlayerbarPrepSession();

    const songDuration = prepSession
        ? prepSession.durationSeconds
        : currentSong?.duration
          ? currentSong.duration / 1000
          : 0;
    const playerTime = usePlayerTimestamp();
    const currentTime = prepSession ? prepSession.position : playerTime;

    const formattedDuration = formatDuration(songDuration * 1000 || 0);
    const formattedTimeRemaining = formatDuration((currentTime - songDuration) * 1000 || 0);
    const formattedTime = prepSession
        ? prepSession.formatTime(currentTime)
        : formatDuration(currentTime * 1000 || 0);

    const showTimeRemaining = useAppStore((state) => state.showTimeRemaining);
    const { setShowTimeRemaining } = useAppStoreActions();

    // The prep view draws its own waveforms; the bar's would be the app player's track.
    const isWaveform = !prepSession && playerbarSlider?.type === PlayerbarSliderType.WAVEFORM;

    return (
        <>
            <div className={styles.sliderContainer}>
                <div
                    className={clsx(
                        styles.sliderValueWrapper,
                        prepSession && styles.sliderValueWrapperWide,
                    )}
                >
                    <Text
                        className={PlaybackSelectors.elapsedTime}
                        fw={600}
                        isMuted
                        isNoSelect
                        size="xs"
                        style={{ userSelect: 'none' }}
                    >
                        {formattedTime}
                    </Text>
                </div>
                <div className={styles.sliderWrapper}>
                    {isWaveform ? (
                        <Suspense fallback={<Spinner />}>
                            <PlayerbarWaveform />
                        </Suspense>
                    ) : (
                        <PlayerbarSeekSlider
                            currentTime={prepSession ? currentTime : undefined}
                            max={songDuration}
                            min={0}
                            onSeek={prepSession?.seek}
                        />
                    )}
                    <DjSeekMarkers />
                </div>
                <div className={styles.sliderValueWrapper}>
                    <Text
                        className={PlaybackSelectors.totalDuration}
                        fw={600}
                        isMuted
                        isNoSelect
                        onClick={() => setShowTimeRemaining(!showTimeRemaining)}
                        role="button"
                        size="xs"
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                    >
                        {showTimeRemaining ? formattedTimeRemaining : formattedDuration}
                    </Text>
                </div>
            </div>
        </>
    );
};

export const CustomPlayerbarSlider = ({ ...props }: SliderProps) => {
    return (
        <Slider
            classNames={{
                bar: styles.bar,
                label: styles.label,
                root: styles.root,
                thumb: styles.thumb,
                track: styles.track,
            }}
            {...props}
            size={6}
        />
    );
};
