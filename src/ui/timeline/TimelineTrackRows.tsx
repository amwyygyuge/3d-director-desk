import LinkIcon from "@mui/icons-material/Link";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { observer } from "mobx-react-lite";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef } from "react";

import { TIMELINE_BAR_KIND, TIMELINE_MARK_KIND, TIMELINE_ROW_KIND } from "@/authoring/TimelineLayout";
import type { TimelineBar, TimelineMark, TimelineRow, TimelineRowKind } from "@/authoring/TimelineLayout";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { MONO_FONT_STACK } from "@/ui/shell/theme";

const TRACK_LABEL_WIDTH_PX = 168;
const TRACK_HEIGHT_PX = 32;
const TRACK_ACCENT_WIDTH_PX = 2;
const BAR_VERTICAL_INSET_PX = 4;
const KEY_SIZE_PX = 12;
const KEY_HALF_SIZE_PX = KEY_SIZE_PX / 2;
const KEYBOARD_TIME_STEP_SECONDS = 0.1;
const MINIMUM_DURATION_SECONDS = 0.001;
const TIME_START_SECONDS = 0;
const PROGRESS_MIN = 0;
const PROGRESS_MAX = 1;
const PERCENT_FULL = 100;
const DRAG_HANDLE_WIDTH_PX = 6;
const DRAG_MOVEMENT_EPSILON_SECONDS = 0.000001;
const TRACK_BACKGROUND_ALPHA = 0.14;
const MOTION_TRACK_BACKGROUND_ALPHA = 0.12;
const MOTION_CLIP_BACKGROUND_ALPHA = 0.4;
const TRACK_HEADER_BACKGROUND = "rgba(0,0,0,0.3)";
const TRACK_BORDER_COLOR = "divider";
const PROGRAM_TRACK_ACCENT = "primary.main";
const KEYFRAME_TRACK_ACCENT = "secondary.main";
const MOTION_TRACK_ACCENT = "primary.main";
const PROGRAM_BAR_COLOR = "secondary.main";
const MOTION_BAR_COLOR = "primary.main";
const TRACK_DATA_ATTRIBUTE = "[data-timeline-track]";
const MOTION_DRAG_CURSOR = "ew-resize";
const CLIP_TRANSFORM_ORIGIN = "left center";
const LINK_LABEL = "解除 Program 跟随";
const LINK_ICON_SIZE = "small" as const;

type TrackAccent = typeof PROGRAM_TRACK_ACCENT | typeof KEYFRAME_TRACK_ACCENT | typeof MOTION_TRACK_ACCENT;
type TransformKeySelection = { readonly trackId: string; readonly keyframeId: string };
type MotionDragKind = "move" | "resize-start" | "resize-end";

interface TimelineProjectedRowProps {
    readonly rowId: string;
    readonly onSelectProgramClip: (clipId: string) => void;
    readonly onSelectTransformKey: (selection: TransformKeySelection) => void;
}

interface TrackRowProps {
    readonly rowId: string;
    readonly children: ReactNode;
}

interface ProgramClipBarProps {
    readonly barId: string;
    readonly onSelect: (clipId: string) => void;
}

interface TransformKeyDiamondProps {
    readonly trackId: string;
    readonly keyId: string;
    readonly onSelect: (selection: TransformKeySelection) => void;
}

interface MotionDragState {
    readonly element: HTMLDivElement;
    readonly kind: MotionDragKind;
    readonly originClientX: number;
    readonly startSeconds: number;
    readonly durationSeconds: number;
}

interface KeyDragState {
    readonly element: HTMLDivElement;
    readonly originTimeSeconds: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}

function motionViewport(stores: DirectorDeskStores) {
    return stores.motionAuthoring.timelineViewportFor(stores.timeline.document.duration);
}

function projectedRow(stores: DirectorDeskStores, rowId: string): TimelineRow | undefined {
    return stores.timelineLayout.project(motionViewport(stores)).find((row) => row.id === rowId);
}

function projectedBar(stores: DirectorDeskStores, barId: string): TimelineBar | undefined {
    return stores.timelineLayout.bars(motionViewport(stores)).find((bar) => bar.id === barId);
}

function projectedMark(stores: DirectorDeskStores, rowId: string, markId: string): TimelineMark | undefined {
    return projectedRow(stores, rowId)?.marks.find((mark) => mark.id === markId);
}

function timelineTrackFor(element: HTMLElement): HTMLDivElement | null {
    return element.closest(TRACK_DATA_ATTRIBUTE) as HTMLDivElement | null;
}

function trackTimeAtPointer(
    stores: DirectorDeskStores,
    track: HTMLDivElement,
    clientX: number,
): { readonly secondsPerPixel: number; readonly timeSeconds: number } {
    const bounds = track.getBoundingClientRect();
    const viewport = motionViewport(stores);
    const ratio =
        bounds.width > TIME_START_SECONDS
            ? clamp((clientX - bounds.left) / bounds.width, PROGRESS_MIN, PROGRESS_MAX)
            : PROGRESS_MIN;
    return {
        secondsPerPixel: viewport.secondsPerPixel(bounds.width),
        timeSeconds: viewport.timeAt(ratio),
    };
}

function snapTime(
    stores: DirectorDeskStores,
    clipId: string,
    excludedKeyId: string | null,
    timeSeconds: number,
    secondsPerPixel: number,
    altKey: boolean,
): number {
    const clip = stores.motion.clip(clipId);
    const otherKeys =
        clip?.keys.filter((key) => key.id !== excludedKeyId).map((key) => clip.timeAtProgress(key.progress)) ?? [];
    const edges = stores.motion.clips
        .filter((motionClip) => motionClip.id !== clipId)
        .flatMap((motionClip) => [motionClip.startTimeSeconds, motionClip.endTimeSeconds]);
    return stores.snapResolver.resolve({
        timeSeconds,
        secondsPerPixel,
        candidates: { playheadSeconds: stores.playheadDisplay.value, edges, keys: otherKeys },
        enabled: stores.motionAuthoring.snapEnabled && !altKey,
        durationSeconds: stores.timeline.document.duration,
    });
}

function clipTransform(
    kind: MotionDragKind,
    deltaSeconds: number,
    initialDurationSeconds: number,
    secondsPerPixel: number,
): string {
    const deltaPixels = deltaSeconds / secondsPerPixel;
    const scale =
        kind === "move"
            ? PROGRESS_MAX
            : (initialDurationSeconds + (kind === "resize-start" ? -deltaSeconds : deltaSeconds)) /
              initialDurationSeconds;
    const translate = kind === "resize-end" ? TIME_START_SECONDS : deltaPixels;
    return `translateX(${translate}px) scaleX(${scale})`;
}

function resolveClipRange(
    stores: DirectorDeskStores,
    clipId: string,
    drag: MotionDragState,
    event: PointerEvent<HTMLDivElement>,
): { readonly startTimeSeconds: number; readonly durationSeconds: number } | null {
    const track = timelineTrackFor(drag.element);
    const clip = stores.motion.clip(clipId);
    if (!track || !clip) return null;
    const pointer = trackTimeAtPointer(stores, track, event.clientX);
    const rawDelta = pointer.timeSeconds - trackTimeAtPointer(stores, track, drag.originClientX).timeSeconds;
    const duration = stores.timeline.document.duration;
    const rawStart = drag.startSeconds + rawDelta;
    const rawEnd = drag.startSeconds + drag.durationSeconds + rawDelta;
    const snappedMoveStart = snapTime(
        stores,
        clipId,
        null,
        clamp(rawStart, TIME_START_SECONDS, duration - drag.durationSeconds),
        pointer.secondsPerPixel,
        event.altKey,
    );
    const snappedStart = snapTime(
        stores,
        clipId,
        null,
        clamp(rawStart, TIME_START_SECONDS, drag.startSeconds + drag.durationSeconds - MINIMUM_DURATION_SECONDS),
        pointer.secondsPerPixel,
        event.altKey,
    );
    const snappedEnd = snapTime(
        stores,
        clipId,
        null,
        clamp(rawEnd, drag.startSeconds + MINIMUM_DURATION_SECONDS, duration),
        pointer.secondsPerPixel,
        event.altKey,
    );
    const ranges: Record<MotionDragKind, { readonly startTimeSeconds: number; readonly durationSeconds: number }> = {
        move: {
            startTimeSeconds: clamp(snappedMoveStart, TIME_START_SECONDS, duration - drag.durationSeconds),
            durationSeconds: drag.durationSeconds,
        },
        "resize-start": {
            startTimeSeconds: clamp(
                snappedStart,
                TIME_START_SECONDS,
                drag.startSeconds + drag.durationSeconds - MINIMUM_DURATION_SECONDS,
            ),
            durationSeconds:
                drag.startSeconds +
                drag.durationSeconds -
                clamp(
                    snappedStart,
                    TIME_START_SECONDS,
                    drag.startSeconds + drag.durationSeconds - MINIMUM_DURATION_SECONDS,
                ),
        },
        "resize-end": {
            startTimeSeconds: drag.startSeconds,
            durationSeconds:
                clamp(snappedEnd, drag.startSeconds + MINIMUM_DURATION_SECONDS, duration) - drag.startSeconds,
        },
    };
    return ranges[drag.kind];
}

function motionDragKind(event: PointerEvent<HTMLDivElement>): MotionDragKind {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerOffset = event.clientX - bounds.left;
    const nearStart = pointerOffset <= DRAG_HANDLE_WIDTH_PX;
    const nearEnd = bounds.width - pointerOffset <= DRAG_HANDLE_WIDTH_PX;
    if (nearStart) return "resize-start";
    return nearEnd ? "resize-end" : "move";
}

function trackAccent(kind: TimelineRowKind): TrackAccent {
    const accents: Record<TimelineRowKind, TrackAccent> = {
        [TIMELINE_ROW_KIND.PROGRAM]: PROGRAM_TRACK_ACCENT,
        [TIMELINE_ROW_KIND.CAMERA]: MOTION_TRACK_ACCENT,
        [TIMELINE_ROW_KIND.TRANSFORM]: KEYFRAME_TRACK_ACCENT,
    };
    return accents[kind];
}

const TimelineTrackRow = observer(function TimelineTrackRow({ rowId, children }: TrackRowProps) {
    const stores = useDirectorDeskStores();
    const row = projectedRow(stores, rowId);
    if (!row) return null;
    return (
        <Box
            sx={{
                display: "grid",
                gridTemplateColumns: `${TRACK_LABEL_WIDTH_PX}px minmax(0, 1fr)`,
                minHeight: TRACK_HEIGHT_PX,
            }}
        >
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    px: 1,
                    bgcolor: TRACK_HEADER_BACKGROUND,
                    borderRight: 1,
                    borderLeft: TRACK_ACCENT_WIDTH_PX,
                    borderColor: TRACK_BORDER_COLOR,
                    borderLeftColor: trackAccent(row.kind),
                }}
            >
                <Typography variant="caption" noWrap>
                    {row.label}
                </Typography>
            </Box>
            {children}
        </Box>
    );
});

const ProgramClipBar = observer(function ProgramClipBar({ barId, onSelect }: ProgramClipBarProps) {
    const stores = useDirectorDeskStores();
    const bar = projectedBar(stores, barId);
    if (!bar) return null;
    const removeFollow = (): void => {
        const result = stores.dispatcher.dispatch({ type: "program.remove-clip", payload: { id: bar.id } }, stores);
        reportCommandFailure(stores, result);
    };
    return (
        <Box
            role="button"
            tabIndex={0}
            aria-label={`${bar.cameraId} 输出片段 ${bar.startSeconds.toFixed(2)} 秒`}
            onClick={() => onSelect(bar.id)}
            sx={{
                position: "absolute",
                top: BAR_VERTICAL_INSET_PX,
                bottom: BAR_VERTICAL_INSET_PX,
                left: `${bar.startRatio * PERCENT_FULL}%`,
                width: `${bar.widthRatio * PERCENT_FULL}%`,
                px: 0.75,
                overflow: "hidden",
                bgcolor: PROGRAM_BAR_COLOR,
                color: "common.white",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: "nowrap",
                fontFamily: MONO_FONT_STACK,
            }}
        >
            {bar.label}
            {bar.linked && (
                <Tooltip title={LINK_LABEL}>
                    <IconButton
                        aria-label={LINK_LABEL}
                        size={LINK_ICON_SIZE}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            removeFollow();
                        }}
                        sx={{ color: "inherit", p: 0, ml: 0.5 }}
                    >
                        <LinkIcon fontSize="inherit" />
                    </IconButton>
                </Tooltip>
            )}
        </Box>
    );
});

const MotionClipBar = observer(function MotionClipBar({ clipId }: { readonly clipId: string }) {
    const stores = useDirectorDeskStores();
    const bar = projectedBar(stores, clipId);
    const drag = useRef<MotionDragState | null>(null);
    const ignoreClick = useRef(false);
    if (!bar) return null;
    const clip = stores.motion.clip(clipId);
    if (!clip) return null;
    const completeDrag = (event: PointerEvent<HTMLDivElement>): void => {
        const currentDrag = drag.current;
        if (!currentDrag) return;
        const nextRange = resolveClipRange(stores, clipId, currentDrag, event);
        currentDrag.element.style.transform = "";
        currentDrag.element.releasePointerCapture(event.pointerId);
        drag.current = null;
        if (!nextRange) return;
        const changed =
            Math.abs(nextRange.startTimeSeconds - currentDrag.startSeconds) > DRAG_MOVEMENT_EPSILON_SECONDS ||
            Math.abs(nextRange.durationSeconds - currentDrag.durationSeconds) > DRAG_MOVEMENT_EPSILON_SECONDS;
        ignoreClick.current = changed;
        if (!changed) return;
        const result = stores.dispatcher.dispatch(
            { type: "motion.set-clip-range", payload: { id: clipId, ...nextRange } },
            stores,
        );
        reportCommandFailure(stores, result);
    };
    return (
        <Box
            role="button"
            tabIndex={0}
            aria-label={`${clip.cameraId} 运镜片段 ${clip.startTimeSeconds.toFixed(2)} 秒`}
            onClick={() => {
                if (ignoreClick.current) {
                    ignoreClick.current = false;
                    return;
                }
                // 运镜片段的属性面板挂在机位上:点片段即把右栏收敛到它所属机位
                stores.motionAuthoring.selectClip(clipId);
                stores.selection.select(clip.cameraId);
                const result = stores.dispatcher.dispatch(
                    { type: "motion.preview.enter", payload: { clipId } },
                    stores,
                );
                reportCommandFailure(stores, result);
            }}
            onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = {
                    element: event.currentTarget,
                    kind: motionDragKind(event),
                    originClientX: event.clientX,
                    startSeconds: clip.startTimeSeconds,
                    durationSeconds: clip.durationSeconds,
                };
            }}
            onPointerMove={(event) => {
                const currentDrag = drag.current;
                if (!currentDrag) return;
                const nextRange = resolveClipRange(stores, clipId, currentDrag, event);
                if (!nextRange) return;
                const transformDelta =
                    currentDrag.kind === "resize-end"
                        ? nextRange.durationSeconds - currentDrag.durationSeconds
                        : nextRange.startTimeSeconds - currentDrag.startSeconds;
                currentDrag.element.style.transform = clipTransform(
                    currentDrag.kind,
                    transformDelta,
                    currentDrag.durationSeconds,
                    motionViewport(stores).secondsPerPixel(
                        timelineTrackFor(currentDrag.element)?.getBoundingClientRect().width ?? TIME_START_SECONDS,
                    ),
                );
            }}
            onPointerUp={completeDrag}
            onPointerCancel={(event) => {
                const currentDrag = drag.current;
                if (!currentDrag) return;
                currentDrag.element.style.transform = "";
                currentDrag.element.releasePointerCapture(event.pointerId);
                drag.current = null;
            }}
            sx={{
                position: "absolute",
                top: BAR_VERTICAL_INSET_PX,
                bottom: BAR_VERTICAL_INSET_PX,
                left: `${bar.startRatio * PERCENT_FULL}%`,
                width: `${bar.widthRatio * PERCENT_FULL}%`,
                transformOrigin: CLIP_TRANSFORM_ORIGIN,
                border: 1,
                borderColor: stores.motionAuthoring.selectedClipId === clipId ? "primary.light" : MOTION_BAR_COLOR,
                bgcolor: (theme) => alpha(theme.palette.primary.main, MOTION_CLIP_BACKGROUND_ALPHA),
                cursor: MOTION_DRAG_CURSOR,
                touchAction: "none",
            }}
        />
    );
});

const MotionKeyDiamond = observer(function MotionKeyDiamond({
    clipId,
    keyId,
}: {
    readonly clipId: string;
    readonly keyId: string;
}) {
    const stores = useDirectorDeskStores();
    const row = projectedRow(stores, stores.motion.clip(clipId)?.cameraId ?? "");
    const mark = row?.marks.find(
        (candidate) =>
            candidate.id === keyId && candidate.ownerId === clipId && candidate.kind === TIMELINE_MARK_KIND.CAMERA_KEY,
    );
    const drag = useRef<KeyDragState | null>(null);
    const ignoreClick = useRef(false);
    if (!mark) return null;
    const clip = stores.motion.clip(clipId);
    if (!clip) return null;
    const positionFor = (event: PointerEvent<HTMLDivElement>): number | null => {
        const track = timelineTrackFor(event.currentTarget);
        if (!track) return null;
        const pointer = trackTimeAtPointer(stores, track, event.clientX);
        return snapTime(stores, clipId, keyId, pointer.timeSeconds, pointer.secondsPerPixel, event.altKey);
    };
    const finish = (event: PointerEvent<HTMLDivElement>): void => {
        const currentDrag = drag.current;
        if (!currentDrag) return;
        const timeSeconds = positionFor(event);
        currentDrag.element.style.transform = "";
        currentDrag.element.releasePointerCapture(event.pointerId);
        drag.current = null;
        if (timeSeconds === null) return;
        const progress = clamp(clip.trajectoryProgressAt(timeSeconds), PROGRESS_MIN, PROGRESS_MAX);
        const changed = Math.abs(timeSeconds - currentDrag.originTimeSeconds) > DRAG_MOVEMENT_EPSILON_SECONDS;
        ignoreClick.current = changed;
        if (!changed) return;
        const result = stores.dispatcher.dispatch(
            { type: "motion.move-key", payload: { clipId, keyId, progress } },
            stores,
        );
        reportCommandFailure(stores, result);
    };
    return (
        <Box
            role="button"
            tabIndex={0}
            aria-label={`镜头关键帧 ${mark.timeSeconds.toFixed(2)} 秒`}
            onClick={() => {
                if (ignoreClick.current) {
                    ignoreClick.current = false;
                    return;
                }
                stores.motionAuthoring.selectKey(clipId, keyId);
            }}
            onDoubleClick={() => {
                const result = stores.dispatcher.dispatch(
                    { type: "transport.seek", payload: { time: mark.timeSeconds } },
                    stores,
                );
                reportCommandFailure(stores, result);
            }}
            onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { element: event.currentTarget, originTimeSeconds: mark.timeSeconds };
                stores.motionAuthoring.selectKey(clipId, keyId);
            }}
            onPointerMove={(event) => {
                const currentDrag = drag.current;
                const nextTime = positionFor(event);
                if (!currentDrag || nextTime === null) return;
                const track = timelineTrackFor(event.currentTarget);
                if (!track) return;
                const deltaPixels =
                    (nextTime - currentDrag.originTimeSeconds) /
                    motionViewport(stores).secondsPerPixel(track.getBoundingClientRect().width);
                currentDrag.element.style.transform = `translateX(${deltaPixels}px) rotate(45deg)`;
            }}
            onPointerUp={finish}
            onPointerCancel={(event) => {
                const currentDrag = drag.current;
                if (!currentDrag) return;
                currentDrag.element.style.transform = "";
                currentDrag.element.releasePointerCapture(event.pointerId);
                drag.current = null;
            }}
            sx={{
                position: "absolute",
                top: (TRACK_HEIGHT_PX - KEY_SIZE_PX) / 2,
                left: `calc(${mark.ratio * PERCENT_FULL}% - ${KEY_HALF_SIZE_PX}px)`,
                width: KEY_SIZE_PX,
                height: KEY_SIZE_PX,
                transform: "rotate(45deg)",
                bgcolor:
                    stores.motionAuthoring.selectedKeyId === keyId && stores.motionAuthoring.selectedClipId === clipId
                        ? MOTION_BAR_COLOR
                        : "primary.light",
                cursor: MOTION_DRAG_CURSOR,
                touchAction: "none",
            }}
        />
    );
});

const TransformKeyDiamond = observer(function TransformKeyDiamond({
    trackId,
    keyId,
    onSelect,
}: TransformKeyDiamondProps) {
    const stores = useDirectorDeskStores();
    const mark = projectedMark(stores, trackId, keyId);
    const drag = useRef<KeyDragState | null>(null);
    if (!mark || mark.kind !== TIMELINE_MARK_KIND.TRANSFORM_KEY) return null;
    const complete = (event: PointerEvent<HTMLDivElement>): void => {
        const currentDrag = drag.current;
        if (!currentDrag) return;
        const track = timelineTrackFor(event.currentTarget);
        currentDrag.element.style.transform = "";
        currentDrag.element.releasePointerCapture(event.pointerId);
        drag.current = null;
        if (!track) return;
        const nextTime = trackTimeAtPointer(stores, track, event.clientX).timeSeconds;
        if (Math.abs(nextTime - currentDrag.originTimeSeconds) <= DRAG_MOVEMENT_EPSILON_SECONDS) return;
        const result = stores.dispatcher.dispatch(
            { type: "timeline.move-key", payload: { trackId, keyframeId: keyId, time: nextTime } },
            stores,
        );
        reportCommandFailure(stores, result);
    };
    const keydown = (event: KeyboardEvent<HTMLDivElement>): void => {
        const deltaByKey: Record<string, number | null> = {
            ArrowLeft: -KEYBOARD_TIME_STEP_SECONDS,
            ArrowRight: KEYBOARD_TIME_STEP_SECONDS,
        };
        const isSelectionKey = event.key === "Enter" || event.key === " ";
        if (isSelectionKey) {
            event.preventDefault();
            onSelect({ trackId, keyframeId: keyId });
            return;
        }
        const delta = deltaByKey[event.key] ?? null;
        if (delta === null) return;
        event.preventDefault();
        const duration = stores.timeline.document.duration;
        const nextTime = clamp(mark.timeSeconds + delta, TIME_START_SECONDS, duration);
        onSelect({ trackId, keyframeId: keyId });
        if (nextTime === mark.timeSeconds) return;
        const result = stores.dispatcher.dispatch(
            { type: "timeline.move-key", payload: { trackId, keyframeId: keyId, time: nextTime } },
            stores,
        );
        reportCommandFailure(stores, result);
    };
    return (
        <Box
            role="button"
            tabIndex={0}
            aria-keyshortcuts="ArrowLeft ArrowRight Enter Space"
            aria-label={`关键帧 ${mark.timeSeconds.toFixed(2)} 秒`}
            onFocus={() => onSelect({ trackId, keyframeId: keyId })}
            onKeyDown={keydown}
            onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { element: event.currentTarget, originTimeSeconds: mark.timeSeconds };
                onSelect({ trackId, keyframeId: keyId });
            }}
            onPointerMove={(event) => {
                const currentDrag = drag.current;
                const track = timelineTrackFor(event.currentTarget);
                if (!currentDrag || !track) return;
                const nextTime = trackTimeAtPointer(stores, track, event.clientX).timeSeconds;
                const deltaPixels =
                    (nextTime - currentDrag.originTimeSeconds) /
                    motionViewport(stores).secondsPerPixel(track.getBoundingClientRect().width);
                currentDrag.element.style.transform = `translateX(${deltaPixels}px) rotate(45deg)`;
            }}
            onPointerUp={complete}
            onPointerCancel={(event) => {
                const currentDrag = drag.current;
                if (!currentDrag) return;
                currentDrag.element.style.transform = "";
                currentDrag.element.releasePointerCapture(event.pointerId);
                drag.current = null;
            }}
            sx={{
                position: "absolute",
                top: (TRACK_HEIGHT_PX - KEY_SIZE_PX) / 2,
                left: `calc(${mark.ratio * PERCENT_FULL}% - ${KEY_HALF_SIZE_PX}px)`,
                width: KEY_SIZE_PX,
                height: KEY_SIZE_PX,
                transform: "rotate(45deg)",
                bgcolor: KEYFRAME_TRACK_ACCENT,
                cursor: MOTION_DRAG_CURSOR,
                touchAction: "none",
            }}
        />
    );
});

const ProgramTrackBody = observer(function ProgramTrackBody({
    rowId,
    onSelect,
}: {
    readonly rowId: string;
    readonly onSelect: (clipId: string) => void;
}) {
    const stores = useDirectorDeskStores();
    const row = projectedRow(stores, rowId);
    if (!row) return null;
    return (
        <Box
            data-timeline-track
            sx={{
                position: "relative",
                height: TRACK_HEIGHT_PX,
                bgcolor: (theme) => alpha(theme.palette.secondary.main, TRACK_BACKGROUND_ALPHA),
            }}
        >
            {row.bars
                .filter((bar) => bar.kind === TIMELINE_BAR_KIND.PROGRAM)
                .map((bar) => (
                    <ProgramClipBar key={bar.id} barId={bar.id} onSelect={onSelect} />
                ))}
        </Box>
    );
});

const MotionTrackBody = observer(function MotionTrackBody({ rowId }: { readonly rowId: string }) {
    const stores = useDirectorDeskStores();
    const row = projectedRow(stores, rowId);
    if (!row) return null;
    return (
        <Box
            data-timeline-track
            sx={{
                position: "relative",
                height: TRACK_HEIGHT_PX,
                bgcolor: (theme) => alpha(theme.palette.primary.main, MOTION_TRACK_BACKGROUND_ALPHA),
            }}
        >
            {row.bars
                .filter((bar) => bar.kind === TIMELINE_BAR_KIND.MOTION)
                .map((bar) => (
                    <MotionClipBar key={bar.id} clipId={bar.id} />
                ))}
            {row.marks
                .filter((mark) => mark.kind === TIMELINE_MARK_KIND.CAMERA_KEY)
                .map((mark) => (
                    <MotionKeyDiamond key={`${mark.ownerId}-${mark.id}`} clipId={mark.ownerId} keyId={mark.id} />
                ))}
        </Box>
    );
});

const TransformTrackBody = observer(function TransformTrackBody({
    rowId,
    onSelect,
}: {
    readonly rowId: string;
    readonly onSelect: (selection: TransformKeySelection) => void;
}) {
    const stores = useDirectorDeskStores();
    const row = projectedRow(stores, rowId);
    if (!row) return null;
    return (
        <Box
            data-timeline-track
            sx={{
                position: "relative",
                height: TRACK_HEIGHT_PX,
                bgcolor: (theme) => alpha(theme.palette.secondary.main, TRACK_BACKGROUND_ALPHA),
            }}
        >
            {row.marks
                .filter((mark) => mark.kind === TIMELINE_MARK_KIND.TRANSFORM_KEY)
                .map((mark) => (
                    <TransformKeyDiamond key={mark.id} trackId={mark.ownerId} keyId={mark.id} onSelect={onSelect} />
                ))}
        </Box>
    );
});

const ROW_CONTENT: Record<
    TimelineRowKind,
    (
        rowId: string,
        onSelectProgramClip: (clipId: string) => void,
        onSelectTransformKey: (selection: TransformKeySelection) => void,
    ) => ReactNode
> = {
    [TIMELINE_ROW_KIND.PROGRAM]: (rowId, onSelectProgramClip) => (
        <ProgramTrackBody rowId={rowId} onSelect={onSelectProgramClip} />
    ),
    [TIMELINE_ROW_KIND.CAMERA]: (rowId) => <MotionTrackBody rowId={rowId} />,
    [TIMELINE_ROW_KIND.TRANSFORM]: (rowId, _onSelectProgramClip, onSelectTransformKey) => (
        <TransformTrackBody rowId={rowId} onSelect={onSelectTransformKey} />
    ),
};

export const TimelineProjectedRow = observer(function TimelineProjectedRow({
    rowId,
    onSelectProgramClip,
    onSelectTransformKey,
}: TimelineProjectedRowProps) {
    const stores = useDirectorDeskStores();
    const row = projectedRow(stores, rowId);
    if (!row) return null;
    return (
        <TimelineTrackRow rowId={rowId}>
            {ROW_CONTENT[row.kind](row.id, onSelectProgramClip, onSelectTransformKey)}
        </TimelineTrackRow>
    );
});
