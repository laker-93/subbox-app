import { subscribeWithSelector } from 'zustand/middleware';
import { createWithEqualityFn } from 'zustand/traditional';

import { usePlayerSong, usePlayerStatus } from '/@/renderer/store';
import { QueueSong, Song } from '/@/shared/types/domain-types';
import { PlayerStatus } from '/@/shared/types/types';

// Subbox-only: while the prep view is open, the player bar drives the prep view's own
// <audio> element instead of the app's player (subbox-app#249 review). The prep route
// publishes its track and transport here; the bar's play button, clock, seek slider,
// prev/next and track info read it. The audio itself stays the prep view's: the bar
// only changes which player it controls, never how the prep track is decoded
// (design-dj-ui §3.1).

export interface PrepSession {
    /** The loop being auditioned, if any. */
    auditioning: boolean;
    durationSeconds: number;
    /** Decode seconds → the time the DJ apps show for it. */
    formatTime: (decodeSeconds: number) => string;
    isPlaying: boolean;
    next: (() => void) | null;
    /** Decode seconds. */
    position: number;
    prev: (() => void) | null;
    seek: (decodeSeconds: number) => void;
    /** Null while prev/next loads the next track: the bar stays on prep, play disabled. */
    song: null | Song;
    stop: () => void;
    toggle: () => void;
}

interface PrepSessionState {
    session: null | PrepSession;
}

export const usePrepSessionStore = createWithEqualityFn<PrepSessionState>()(
    subscribeWithSelector((): PrepSessionState => ({ session: null })),
);

export const setPrepSession = (session: null | PrepSession) =>
    usePrepSessionStore.setState({ session });

/**
 * The prep session the player bar should show, or null for the app's player. The app's
 * player wins while it is playing (a media key can start it under the prep view), so the
 * bar always shows whichever one is live and its pause button stops what you hear.
 */
export const usePlayerbarPrepSession = (): null | PrepSession => {
    const session = usePrepSessionStore((state) => state.session);
    const status = usePlayerStatus();
    return session && status !== PlayerStatus.PLAYING ? session : null;
};

/** The song every part of the player bar shows and acts on (rating, favourite, menu). */
export const usePlayerbarSong = (): QueueSong | Song | undefined => {
    const session = usePlayerbarPrepSession();
    const playerSong = usePlayerSong();
    return session ? (session.song ?? undefined) : playerSong;
};
