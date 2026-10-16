import { useCallback, useEffect, useRef, useState } from 'react';

import { convertToLogVolume } from '/@/renderer/features/player/audio-player/utils/player-utils';
import { useWebAudio } from '/@/renderer/features/player/hooks/use-webaudio';
import { usePlayerStoreBase } from '/@/renderer/store';
import { PlayerStatus } from '/@/shared/types/types';

// Subbox-only: the prep view's own player (subbox-app#239, design-dj-ui §3.1). An
// <audio> element on the original file (`format=raw`), never the app's player: that one
// follows the user's transcode setting and, in Electron, may be mpv, and a cue is only
// where the waveform draws it on the browser's own decode of the original.
//
// It and the app's player never play at once: starting one pauses the other. It plays at
// the player bar's volume, and when the app has a Web Audio graph it joins it on its own
// gain node, so the visualizers and the chosen output device follow it as well.

export interface PrepAudio {
    /** The loop being auditioned, decode seconds. */
    auditioning: null | { end: number; start: number };
    isPlaying: boolean;
    pause: () => void;
    /** Play from `seconds`, or from where it is. */
    play: (seconds?: number) => void;
    /** Play `start`–`end` on repeat until paused or seeked out of. */
    playLoop: (start: number, end: number) => void;
    /** Decode seconds. Updated a few times a second while playing. */
    position: number;
    /** Decode seconds, read off the element now: for drawing every frame. */
    readPosition: () => number;
    seek: (seconds: number) => void;
    toggle: () => void;
}

// The web player's curve (web-player-engine): the bar's 0-100 slider, squared.
const barVolume = (volume: number, muted: boolean) =>
    muted ? 0 : convertToLogVolume(Math.min(1, Math.max(0, volume / 100 || 0)));

const pauseAppPlayer = () => {
    const state = usePlayerStoreBase.getState();
    if (state.player.status === PlayerStatus.PLAYING) state.mediaPause();
};

export const usePrepAudio = (src: null | string): PrepAudio => {
    const { webAudio } = useWebAudio();
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const loopRef = useRef<null | { end: number; start: number }>(null);
    const [auditioning, setAuditioning] = useState<PrepAudio['auditioning']>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [position, setPosition] = useState(0);

    const setLoop = useCallback((loop: PrepAudio['auditioning']) => {
        loopRef.current = loop;
        setAuditioning(loop);
    }, []);

    useEffect(() => {
        setLoop(null);
        setIsPlaying(false);
        setPosition(0);
        if (!src) return undefined;

        const audio = new Audio();
        audio.preload = 'auto';
        // Without CORS the element source taints and the graph carries silence.
        audio.crossOrigin = 'anonymous';
        const { muted, volume } = usePlayerStoreBase.getState().player;
        audio.volume = barVolume(volume, muted);
        audio.src = src;
        audioRef.current = audio;

        // Gain 2 is the prep view's (audio-players.tsx); the app's players use 0 and 1,
        // whose gains carry their tracks' replay gain.
        let source: MediaElementAudioSourceNode | null = null;
        const prepGain = webAudio?.gains[2];
        if (webAudio && prepGain) {
            try {
                source = webAudio.context.createMediaElementSource(audio);
                source.connect(prepGain);
            } catch (error) {
                console.error('Prep audio could not join the Web Audio graph', error);
                source = null;
            }
        }

        const onTime = () => setPosition(audio.currentTime);
        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        audio.addEventListener('timeupdate', onTime);
        audio.addEventListener('seeked', onTime);
        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        audio.addEventListener('ended', onPause);

        // A loop wraps on the frame it passes its end; `timeupdate` alone is ~250 ms late.
        let frame = 0;
        const tick = () => {
            const loop = loopRef.current;
            if (loop && !audio.paused && audio.currentTime >= loop.end) {
                audio.currentTime = loop.start;
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(frame);
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
            source?.disconnect();
            audioRef.current = null;
        };
    }, [setLoop, src, webAudio]);

    // The player bar's volume slider and mute act on this player too.
    useEffect(
        () =>
            usePlayerStoreBase.subscribe(
                (state) => [state.player.volume, state.player.muted] as const,
                ([volume, muted]) => {
                    if (audioRef.current) audioRef.current.volume = barVolume(volume, muted);
                },
                { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
            ),
        [],
    );

    // The app's player started: this one stops.
    useEffect(
        () =>
            usePlayerStoreBase.subscribe(
                (state) => state.player.status,
                (status) => {
                    if (status === PlayerStatus.PLAYING) audioRef.current?.pause();
                },
            ),
        [],
    );

    const seek = useCallback(
        (seconds: number) => {
            const audio = audioRef.current;
            if (!audio) return;
            const loop = loopRef.current;
            if (loop && (seconds < loop.start || seconds >= loop.end)) setLoop(null);
            audio.currentTime = Math.max(0, seconds);
            setPosition(audio.currentTime);
        },
        [setLoop],
    );

    const play = useCallback(
        (seconds?: number) => {
            const audio = audioRef.current;
            if (!audio) return;
            if (seconds !== undefined) seek(seconds);
            pauseAppPlayer();
            // The context starts suspended until a user gesture (web-player.tsx), and a
            // suspended context plays nothing through the element source.
            if (webAudio?.context.state === 'suspended') {
                webAudio.context.resume().catch(() => undefined);
            }
            audio.play().catch(() => setIsPlaying(false));
        },
        [seek, webAudio],
    );

    const pause = useCallback(() => {
        audioRef.current?.pause();
        setLoop(null);
    }, [setLoop]);

    const toggle = useCallback(() => {
        if (audioRef.current?.paused) play();
        else pause();
    }, [pause, play]);

    const playLoop = useCallback(
        (start: number, end: number) => {
            if (!(end > start)) return;
            setLoop({ end, start });
            play(start);
        },
        [play, setLoop],
    );

    const readPosition = useCallback(() => audioRef.current?.currentTime ?? 0, []);

    return {
        auditioning,
        isPlaying,
        pause,
        play,
        playLoop,
        position,
        readPosition,
        seek,
        toggle,
    };
};
