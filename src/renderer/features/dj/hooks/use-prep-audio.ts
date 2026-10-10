import { useCallback, useEffect, useRef, useState } from 'react';

import { usePlayerStoreBase } from '/@/renderer/store';
import { PlayerStatus } from '/@/shared/types/types';

// Subbox-only: the prep view's own player (subbox-app#239, design-dj-ui §3.1). An
// <audio> element on the original file (`format=raw`), never the app's player: that one
// follows the user's transcode setting and, in Electron, may be mpv, and a cue is only
// where the waveform draws it on the browser's own decode of the original.
//
// It and the app's player never play at once: starting one pauses the other.

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
    seek: (seconds: number) => void;
    toggle: () => void;
}

const pauseAppPlayer = () => {
    const state = usePlayerStoreBase.getState();
    if (state.player.status === PlayerStatus.PLAYING) state.mediaPause();
};

export const usePrepAudio = (src: null | string): PrepAudio => {
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
        audio.src = src;
        audioRef.current = audio;

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
            audioRef.current = null;
        };
    }, [setLoop, src]);

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
            audio.play().catch(() => setIsPlaying(false));
        },
        [seek],
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

    return { auditioning, isPlaying, pause, play, playLoop, position, seek, toggle };
};
