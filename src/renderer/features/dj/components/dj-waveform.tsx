import { useElementSize } from '@mantine/hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import styles from './dj-waveform.module.css';

import { DjPeaks } from '/@/renderer/features/dj/peaks/peaks-source';
import { DjMarks, djMarks, EMPTY_MARKS } from '/@/renderer/features/dj/utils/dj-marks';
import { TrackOffsetContext } from '/@/renderer/features/dj/utils/dj-offset';
import {
    drawCues,
    drawGrid,
    drawLoops,
    drawPeaks,
    drawPlayhead,
    fitCanvas,
    View,
} from '/@/renderer/features/dj/utils/draw-waveform';
import { DjCuedata } from '/@/shared/api/pymix/pymix-types';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Text } from '/@/shared/components/text/text';

// Subbox-only: the DJ waveform (subbox-app#237, design-dj-ui §4.1). Two views of one
// track: the overview (the whole track, cues and loops, the played region and the
// detail view's window), and the detail (zoomed, scrolling under a fixed playhead, with
// the beat grid, bar numbers and named cue flags). Everything it draws is in decode
// time; stored DJ-app times are converted in dj-marks, through dj-offset.

const MIN_ZOOM_SECONDS = 2;
const MAX_ZOOM_SECONDS = 64;
const DEFAULT_ZOOM_SECONDS = 8;

/** The detail view's editing gestures (#241). Every time is decode seconds. */
export interface DjWaveformEditing {
    /** Double-click: a cue there. */
    onCueAdd: (seconds: number) => void;
    /** A cue flag dragged and dropped. */
    onCueMove: (slot: number, seconds: number) => void;
    /** Shift-drag: a loop over the dragged range. */
    onLoopDraw: (start: number, end: number) => void;
    snap: (seconds: number) => number;
}

export interface DjWaveformProps {
    cuedata: DjCuedata | null | undefined;
    detailHeight?: number;
    /** Seconds. Used until the peaks say how long the decode really is. */
    durationSeconds: number;
    editing?: DjWaveformEditing | null;
    error?: null | string;
    isPlaying: boolean;
    /** How this track's stored times convert to decode time (dj-offset). */
    offset: TrackOffsetContext;
    onSeek: (decodeSeconds: number) => void;
    overviewHeight?: number;
    peaks: DjPeaks | null;
    /** The player's position, decode seconds. Extrapolated between updates while playing. */
    position: number;
    showDetail?: boolean;
}

export const DjWaveform = ({
    cuedata,
    detailHeight = 120,
    durationSeconds,
    editing,
    error,
    isPlaying,
    offset,
    onSeek,
    overviewHeight = 56,
    peaks,
    position,
    showDetail = true,
}: DjWaveformProps) => {
    const duration = peaks?.durationSeconds || durationSeconds || 0;
    const marks = useMemo(
        () => (duration ? djMarks(cuedata, duration, offset) : EMPTY_MARKS),
        [cuedata, duration, offset],
    );

    const overview = useElementSize();
    const detail = useElementSize();
    const overviewCanvas = useRef<HTMLCanvasElement>(null);
    const detailCanvas = useRef<HTMLCanvasElement>(null);
    const [zoomSeconds, setZoomSeconds] = useState(DEFAULT_ZOOM_SECONDS);

    // The player reports its position a few times a second; the detail view scrolls
    // smoothly by running on from the last report while playing.
    const clock = useRef({ at: 0, position });
    useEffect(() => {
        clock.current = { at: performance.now(), position };
    }, [position, isPlaying]);
    const drag = useRef<null | { position: number; startX: number }>(null);
    // An edit in progress on the detail view: drawn as it would land, applied on release.
    const gesture = useRef<
        | null
        | { end: number; kind: 'loop'; start: number }
        | { kind: 'cue'; moved: boolean; seconds: number; slot: number; startX: number }
    >(null);
    const shown = useCallback((): DjMarks => {
        const g = gesture.current;
        if (!g) return marks;
        if (g.kind === 'cue') {
            return {
                ...marks,
                cues: marks.cues.map((c) => (c.slot === g.slot ? { ...c, seconds: g.seconds } : c)),
            };
        }
        const [start, end] = g.start <= g.end ? [g.start, g.end] : [g.end, g.start];
        return {
            ...marks,
            loops: [
                ...marks.loops,
                {
                    color: '#ffffff',
                    endSeconds: end,
                    label: '+',
                    name: '',
                    slot: -1,
                    startSeconds: start,
                },
            ],
        };
    }, [marks]);
    const [dragging, setDragging] = useState(false);
    // Bumped on each seek, to redraw while paused.
    const [seeks, setSeeks] = useState(0);
    const now = useCallback(() => {
        if (drag.current) return drag.current.position;
        const { at, position: p } = clock.current;
        const t = isPlaying ? p + (performance.now() - at) / 1000 : p;
        return Math.min(Math.max(t, 0), duration || t);
    }, [duration, isPlaying]);

    const drawOverview = useCallback(() => {
        const canvas = overviewCanvas.current;
        if (!canvas || !overview.width || !duration) return;
        const ctx = fitCanvas(canvas, overview.width, overviewHeight);
        if (!ctx) return;
        const view: View = {
            height: overviewHeight,
            secondsPerPx: duration / overview.width,
            startSeconds: 0,
            width: overview.width,
        };
        if (peaks) drawPeaks(ctx, view, peaks, 4, overviewHeight - 8);
        const drawn = shown();
        drawLoops(ctx, view, drawn, false);
        const t = now();
        // The played part, dimmed.
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(0, 0, t / view.secondsPerPx, overviewHeight);
        if (showDetail) {
            const x0 = (t - zoomSeconds / 2) / view.secondsPerPx;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.strokeRect(x0 + 0.5, 0.5, zoomSeconds / view.secondsPerPx, overviewHeight - 1);
        }
        drawCues(ctx, view, drawn, false);
        drawPlayhead(ctx, view, t);
    }, [duration, now, overview.width, overviewHeight, peaks, shown, showDetail, zoomSeconds]);

    const drawDetail = useCallback(() => {
        const canvas = detailCanvas.current;
        if (!canvas || !detail.width || !duration) return;
        const ctx = fitCanvas(canvas, detail.width, detailHeight);
        if (!ctx) return;
        const t = now();
        const secondsPerPx = zoomSeconds / detail.width;
        const view: View = {
            height: detailHeight,
            secondsPerPx,
            startSeconds: t - zoomSeconds / 2,
            width: detail.width,
        };
        if (peaks) drawPeaks(ctx, view, peaks, 14, detailHeight - 30);
        const drawn = shown();
        // Over the peaks: the fill is translucent, and under them it would be hidden.
        drawLoops(ctx, view, drawn, true);
        drawGrid(ctx, view, drawn);
        drawCues(ctx, view, drawn, true);
        drawPlayhead(ctx, view, t);
    }, [detail.width, detailHeight, duration, now, peaks, shown, zoomSeconds]);

    // Redraw on every frame while playing or dragging; otherwise when something changes.
    useEffect(() => {
        drawOverview();
        if (showDetail) drawDetail();
        if (!isPlaying && !dragging) return undefined;
        let frame = 0;
        let last = 0;
        const tick = (ts: number) => {
            if (showDetail) drawDetail();
            // The overview moves a pixel every few seconds: a few times a second is plenty.
            if (ts - last > 250) {
                drawOverview();
                last = ts;
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [drawDetail, drawOverview, dragging, isPlaying, position, seeks, showDetail]);

    // Move the playhead at once rather than when the player next reports: a paused
    // player may not report a seek until it plays again.
    const seek = (seconds: number) => {
        clock.current = { at: performance.now(), position: seconds };
        setSeeks((n) => n + 1);
        onSeek(seconds);
    };

    // Overview: click or drag to seek.
    const seekFromOverview = (clientX: number) => {
        const rect = overviewCanvas.current?.getBoundingClientRect();
        if (!rect || !duration) return;
        const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
        seek(ratio * duration);
    };

    // Detail: drag scrubs (the track moves under the playhead), seeking on release;
    // the wheel zooms.
    // Editing: the time under the pointer, and the cue flag (if any) it's on.
    const secondsAt = (clientX: number) => {
        const rect = detailCanvas.current?.getBoundingClientRect();
        if (!rect || !detail.width) return 0;
        const at = now() - zoomSeconds / 2 + (clientX - rect.left) * (zoomSeconds / detail.width);
        return Math.min(Math.max(at, 0), duration);
    };
    const cueAt = (clientX: number) => {
        const rect = detailCanvas.current?.getBoundingClientRect();
        if (!rect || !detail.width) return null;
        const pxPerSecond = detail.width / zoomSeconds;
        const t = now() - zoomSeconds / 2;
        let best: null | { distance: number; slot: number } = null;
        for (const cue of marks.cues) {
            const x = rect.left + (cue.seconds - t) * pxPerSecond;
            // The line, or the tab drawn to its right.
            const distance = clientX >= x && clientX <= x + 18 ? 0 : Math.abs(clientX - x);
            if (distance <= 6 && (!best || distance < best.distance)) {
                best = { distance, slot: cue.slot };
            }
        }
        return best && marks.cues.find((c) => c.slot === best.slot)!;
    };

    const onDetailPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        if (editing && e.shiftKey) {
            const at = editing.snap(secondsAt(e.clientX));
            gesture.current = { end: at, kind: 'loop', start: at };
            setDragging(true);
            return;
        }
        const cue = editing ? cueAt(e.clientX) : null;
        if (cue) {
            gesture.current = {
                kind: 'cue',
                moved: false,
                seconds: cue.seconds,
                slot: cue.slot,
                startX: e.clientX,
            };
            setDragging(true);
            return;
        }
        drag.current = { position: now(), startX: e.clientX };
        setDragging(true);
    };
    const [overCue, setOverCue] = useState(false);
    const onDetailPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        // A flag that can be dragged says so.
        if (editing && !gesture.current && !drag.current) {
            const over = Boolean(cueAt(e.clientX));
            if (over !== overCue) setOverCue(over);
        }
        const g = gesture.current;
        if (g && editing) {
            if (g.kind === 'loop') {
                g.end = editing.snap(secondsAt(e.clientX));
            } else {
                g.moved ||= Math.abs(e.clientX - g.startX) > 2;
                if (g.moved) g.seconds = editing.snap(secondsAt(e.clientX));
            }
            return;
        }
        const d = drag.current;
        if (!d || !detail.width) return;
        const secondsPerPx = zoomSeconds / detail.width;
        const next = d.position - (e.clientX - d.startX) * secondsPerPx;
        drag.current = { position: Math.min(Math.max(next, 0), duration), startX: e.clientX };
    };
    const onDetailPointerUp = () => {
        const g = gesture.current;
        if (g) {
            gesture.current = null;
            setDragging(false);
            if (g.kind === 'loop') {
                const [start, end] = g.start <= g.end ? [g.start, g.end] : [g.end, g.start];
                if (end - start > 0.05) editing?.onLoopDraw(start, end);
            } else if (g.moved) {
                editing?.onCueMove(g.slot, g.seconds);
            }
            return;
        }
        const d = drag.current;
        drag.current = null;
        setDragging(false);
        if (d) seek(d.position);
    };

    const detailRef = detail.ref;
    useEffect(() => {
        const el = detailRef.current;
        if (!el) return undefined;
        // Not React's onWheel: that listener is passive, and zooming must stop the
        // page scrolling.
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            setZoomSeconds((z) =>
                Math.min(
                    Math.max(z * Math.exp(e.deltaY * 0.002), MIN_ZOOM_SECONDS),
                    MAX_ZOOM_SECONDS,
                ),
            );
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [detailRef]);

    const status = error ? (
        <Text isMuted size="sm">
            {error}
        </Text>
    ) : !peaks ? (
        <Spinner />
    ) : null;

    return (
        <div className={styles.root}>
            <div
                aria-label="Track overview"
                className={styles.overview}
                onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    seekFromOverview(e.clientX);
                }}
                onPointerMove={(e) => {
                    if (e.buttons === 1) seekFromOverview(e.clientX);
                }}
                ref={overview.ref}
                style={{ height: overviewHeight }}
            >
                <canvas className={styles.canvas} ref={overviewCanvas} />
                {status && !showDetail && <div className={styles.status}>{status}</div>}
            </div>
            {showDetail && (
                <div
                    aria-label="Track detail"
                    className={styles.detail}
                    data-dragging={dragging}
                    data-over-cue={overCue || undefined}
                    onDoubleClick={
                        editing
                            ? (e) => editing.onCueAdd(editing.snap(secondsAt(e.clientX)))
                            : undefined
                    }
                    onPointerCancel={onDetailPointerUp}
                    onPointerDown={onDetailPointerDown}
                    onPointerMove={onDetailPointerMove}
                    onPointerUp={onDetailPointerUp}
                    ref={detail.ref}
                    style={{ height: detailHeight }}
                >
                    <canvas className={styles.canvas} ref={detailCanvas} />
                    {status && <div className={styles.status}>{status}</div>}
                </div>
            )}
        </div>
    );
};
