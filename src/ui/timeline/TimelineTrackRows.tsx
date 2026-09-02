import LinkIcon from "@mui/icons-material/Link";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { observer } from "mobx-react-lite";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";

import { TimelineClipDragResolver } from "@/authoring/TimelineClipDrag";
import type { TimelineClipRange, TimelineDragKind } from "@/authoring/TimelineClipDrag";
import { TIMELINE_BAR_KIND, TIMELINE_MARK_KIND, TIMELINE_ROW_KIND } from "@/authoring/TimelineLayout";
import type { TimelineBar, TimelineBarKind, TimelineMark, TimelineRow, TimelineRowKind } from "@/authoring/TimelineLayout";
import { PROGRAM_SOURCE_KIND } from "@/camera/CameraProgramTrack";
import type { MotionClipProgramSource, ProgramSource, StaticShotProgramSource } from "@/camera/CameraProgramTrack";
import type { SerializedCommand } from "@/command/DirectorCommand";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { MONO_FONT_STACK } from "@/ui/shell/theme";

const TRACK_LABEL_WIDTH_PX = 168;
const TRACK_HEIGHT_PX = 32;
const TRACK_ACCENT_WIDTH_PX = 2;
const BAR_VERTICAL_INSET_PX = 4;
const KEY_SIZE_PX = 12;
/** 键盘微调步长(秒):菱形聚焦后方向键逐格挪帧,与拖拽吸附各管一路 */
const KEYBOARD_TIME_STEP_SECONDS = 0.1;
const KEY_HALF_SIZE_PX = KEY_SIZE_PX / 2;
const TIME_START_SECONDS = 0;
const PROGRESS_MIN = 0;
const PROGRESS_MAX = 1;
const PERCENT_FULL = 100;
const DRAG_READOUT_DECIMAL_PLACES = 2;
const DRAG_HANDLE_WIDTH_PX = 6;
const DRAG_MOVEMENT_EPSILON_SECONDS = 0.000001;
const KEY_DRAG_CURSOR = "ew-resize";
const HANDLE_OPACITY_TRANSITION = "opacity 120ms";
const HANDLE_HIDDEN_OPACITY = 0;
const HANDLE_VISIBLE_OPACITY = 1;
const TRANSFORM_BAR_Z_INDEX = 0;
const CLIP_BAR_Z_INDEX = 1;
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
const TRANSFORM_BAR_COLOR = "secondary.main";
const TRACK_DATA_ATTRIBUTE = "[data-timeline-track]";
const BAR_TRANSFORM_ORIGIN = "left center";
const DRAG_HANDLE_CLASS_NAME = "timeline-drag-handle";
const DRAG_READOUT_BACKGROUND = "rgba(0,0,0,0.72)";
const LINK_LABEL = "解除成片跟随";
const LINK_ICON_SIZE = "small" as const;

type ProgramRangeCommandOptions = {
    readonly clipId: string;
    readonly source: ProgramSource;
    readonly range: TimelineClipRange;
};
const TIMELINE_DRAG_HANDLE_SIDE = {
    START: "start",
    END: "end",
} as const;
type TimelineDragHandleSide = (typeof TIMELINE_DRAG_HANDLE_SIDE)[keyof typeof TIMELINE_DRAG_HANDLE_SIDE];

const DRAG_HANDLE_POSITION: Record<TimelineDragHandleSide, { readonly left?: number; readonly right?: number }> = {
    [TIMELINE_DRAG_HANDLE_SIDE.START]: { left: TIME_START_SECONDS },
    [TIMELINE_DRAG_HANDLE_SIDE.END]: { right: TIME_START_SECONDS },
};
type TrackAccent = typeof PROGRAM_TRACK_ACCENT | typeof KEYFRAME_TRACK_ACCENT | typeof MOTION_TRACK_ACCENT;
type TransformKeySelection = { readonly trackId: string; readonly keyframeId: string };

interface TimelineProjectedRowProps {
    readonly rowId: string;
    readonly onSelectProgramClip: (clipId: string) => void;
    readonly onSelectTransformKey: (selection: TransformKeySelection) => void;
}

interface TrackRowProps {
    readonly rowId: string;
    readonly children: ReactNode;
}

interface TimelineClipBarProps {
    readonly barId: string;
    readonly onSelectProgramClip?: (clipId: string) => void;
}

interface TransformKeyDiamondProps {
    readonly trackId: string;
    readonly keyId: string;
    readonly onSelect: (selection: TransformKeySelection) => void;
}

interface ClipDragState {
    readonly element: HTMLDivElement;
    readonly kind: TimelineDragKind;
    readonly originTimeSeconds: number;
    readonly range: TimelineClipRange;
    readonly trackWidthPx: number;
}

interface ClipDragHookOptions {
    readonly barId: string;
    readonly onCommit: (range: TimelineClipRange) => void;
}

interface ClipDragHookResult {
    readonly range: TimelineClipRange | null;
    readonly isDragging: boolean;
    readonly shouldIgnoreClick: () => boolean;
    readonly onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    readonly onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    readonly onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
    readonly onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
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
    return stores.timelineLayout
        .project(motionViewport(stores))
        .flatMap((row) => row.bars)
        .find((bar) => bar.id === barId);
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

const clipDragResolver = new TimelineClipDragResolver();

function clipDragCandidates(stores: DirectorDeskStores, bar: TimelineBar) {
    const rows = stores.timelineLayout.project(motionViewport(stores));
    const edges = rows
        .flatMap((row) => row.bars)
        .filter((candidate) => candidate.id !== bar.id || candidate.kind !== bar.kind)
        .flatMap((candidate) => [candidate.startSeconds, candidate.startSeconds + candidate.durationSeconds]);
    const keys = rows.flatMap((row) => row.marks.map((mark) => mark.timeSeconds));
    return { playheadSeconds: stores.playheadDisplay.value, edges, keys };
}

function rangeAtDragPointer(options: {
    readonly stores: DirectorDeskStores;
    readonly bar: TimelineBar;
    readonly drag: ClipDragState;
    readonly event: PointerEvent<HTMLDivElement>;
}): TimelineClipRange | null {
    const track = timelineTrackFor(options.drag.element);
    if (!track) return null;
    const pointer = trackTimeAtPointer(options.stores, track, options.event.clientX);
    return clipDragResolver.resolve({
        kind: options.drag.kind,
        pointer: { originTimeSeconds: options.drag.originTimeSeconds, currentTimeSeconds: pointer.timeSeconds },
        originalRange: options.drag.range,
        viewport: motionViewport(options.stores),
        trackWidthPx: options.drag.trackWidthPx,
        candidates: clipDragCandidates(options.stores, options.bar),
        isSnapEnabled: options.stores.motionAuthoring.snapEnabled && !options.event.altKey,
        durationSeconds: options.stores.timeline.document.duration,
    });
}

/** 三种时段条共用的瞬时手势层；只有落点通过 onCommit 进入命令与撤销栈。 */
function useTimelineClipDrag(options: ClipDragHookOptions): ClipDragHookResult {
    const stores = useDirectorDeskStores();
    const drag = useRef<ClipDragState | null>(null);
    const ignoreClick = useRef(false);
    const [range, setRange] = useState<TimelineClipRange | null>(null);
    const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
        const bar = projectedBar(stores, options.barId);
        const track = timelineTrackFor(event.currentTarget);
        if (!bar || !track) return;
        const trackBounds = track.getBoundingClientRect();
        const barBounds = event.currentTarget.getBoundingClientRect();
        const pointer = trackTimeAtPointer(stores, track, event.clientX);
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
            element: event.currentTarget,
            kind: clipDragResolver.dragKindAt({
                pointerOffsetPx: event.clientX - barBounds.left,
                barWidthPx: barBounds.width,
                handleWidthPx: DRAG_HANDLE_WIDTH_PX,
            }),
            originTimeSeconds: pointer.timeSeconds,
            range: { startTimeSeconds: bar.startSeconds, durationSeconds: bar.durationSeconds },
            trackWidthPx: trackBounds.width,
        };
        setRange(drag.current.range);
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
        const currentDrag = drag.current;
        const bar = projectedBar(stores, options.barId);
        if (!currentDrag || !bar) return;
        const nextRange = rangeAtDragPointer({ stores, bar, drag: currentDrag, event });
        if (!nextRange) return;
        currentDrag.element.style.transform = clipDragResolver.transformFor({
            kind: currentDrag.kind,
            originalRange: currentDrag.range,
            range: nextRange,
            viewport: motionViewport(stores),
            trackWidthPx: currentDrag.trackWidthPx,
        });
        setRange(nextRange);
    };
    const complete = (event: PointerEvent<HTMLDivElement>, shouldCommit: boolean): void => {
        const currentDrag = drag.current;
        const bar = projectedBar(stores, options.barId);
        const nextRange = currentDrag && bar ? rangeAtDragPointer({ stores, bar, drag: currentDrag, event }) : null;
        currentDrag?.element.releasePointerCapture(event.pointerId);
        if (currentDrag) currentDrag.element.style.transform = "";
        drag.current = null;
        setRange(null);
        const hasChanged =
            currentDrag !== null &&
            nextRange !== null &&
            (Math.abs(nextRange.startTimeSeconds - currentDrag.range.startTimeSeconds) > DRAG_MOVEMENT_EPSILON_SECONDS ||
                Math.abs(nextRange.durationSeconds - currentDrag.range.durationSeconds) > DRAG_MOVEMENT_EPSILON_SECONDS);
        ignoreClick.current = hasChanged;
        if (hasChanged && nextRange && shouldCommit) options.onCommit(nextRange);
    };
    return {
        range,
        isDragging: range !== null,
        shouldIgnoreClick: () => {
            const shouldIgnore = ignoreClick.current;
            ignoreClick.current = false;
            return shouldIgnore;
        },
        onPointerDown,
        onPointerMove,
        onPointerUp: (event) => complete(event, true),
        onPointerCancel: (event) => complete(event, false),
    };
}

function trackAccent(kind: TimelineRowKind): TrackAccent {
    const accents: Record<TimelineRowKind, TrackAccent> = {
        [TIMELINE_ROW_KIND.PROGRAM]: PROGRAM_TRACK_ACCENT,
        [TIMELINE_ROW_KIND.MOTION]: MOTION_TRACK_ACCENT,
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

function linkedProgramRangeCommand(options: ProgramRangeCommandOptions): SerializedCommand {
    const source = options.source as MotionClipProgramSource;
    return {
        type: "motion.set-clip-range",
        payload: { id: source.motionClipId, ...options.range },
    };
}

function staticProgramRangeCommand(options: ProgramRangeCommandOptions): SerializedCommand {
    const source = options.source as StaticShotProgramSource;
    return {
        type: "program.set-clip",
        payload: { clip: { id: options.clipId, source, ...options.range } },
    };
}

const PROGRAM_RANGE_COMMAND: Record<ProgramSource["kind"], (options: ProgramRangeCommandOptions) => SerializedCommand> = {
    [PROGRAM_SOURCE_KIND.MOTION_CLIP]: linkedProgramRangeCommand,
    [PROGRAM_SOURCE_KIND.STATIC_SHOT]: staticProgramRangeCommand,
};

function rangeCommandFor(stores: DirectorDeskStores, bar: TimelineBar, range: TimelineClipRange): SerializedCommand | null {
    const commands: Record<TimelineBarKind, () => SerializedCommand | null> = {
        [TIMELINE_BAR_KIND.MOTION]: () => ({ type: "motion.set-clip-range", payload: { id: bar.id, ...range } }),
        [TIMELINE_BAR_KIND.PROGRAM]: () => {
            const clip = stores.motion.program.clip(bar.id);
            return clip ? PROGRAM_RANGE_COMMAND[clip.source.kind]({ clipId: clip.id, source: clip.source, range }) : null;
        },
        [TIMELINE_BAR_KIND.TRANSFORM]: () => ({
            type: "timeline.retime-track",
            payload: { trackId: bar.id, ...range },
        }),
    };
    return commands[bar.kind]();
}

function activateMotionBar(stores: DirectorDeskStores, bar: TimelineBar): void {
    stores.selection.clear();
    stores.motionAuthoring.selectClip(bar.id);
    const result = stores.dispatcher.dispatch({ type: "motion.preview.enter", payload: { clipId: bar.id } }, stores);
    reportCommandFailure(stores, result);
}

const BAR_ACTIVATION: Record<TimelineBarKind, (stores: DirectorDeskStores, bar: TimelineBar, onSelect?: (id: string) => void) => void> = {
    [TIMELINE_BAR_KIND.MOTION]: activateMotionBar,
    [TIMELINE_BAR_KIND.PROGRAM]: (_stores, bar, onSelect) => onSelect?.(bar.id),
    [TIMELINE_BAR_KIND.TRANSFORM]: () => undefined,
};

const BAR_COLOR: Record<TimelineBarKind, string> = {
    [TIMELINE_BAR_KIND.MOTION]: MOTION_BAR_COLOR,
    [TIMELINE_BAR_KIND.PROGRAM]: PROGRAM_BAR_COLOR,
    [TIMELINE_BAR_KIND.TRANSFORM]: TRANSFORM_BAR_COLOR,
};

function TimelineDragHandle({ side }: { readonly side: TimelineDragHandleSide }) {
    return (
        <Box
            className={DRAG_HANDLE_CLASS_NAME}
            sx={{
                position: "absolute",
                top: TIME_START_SECONDS,
                bottom: TIME_START_SECONDS,
                width: DRAG_HANDLE_WIDTH_PX,
                ...DRAG_HANDLE_POSITION[side],
                opacity: HANDLE_HIDDEN_OPACITY,
                cursor: "col-resize",
                transition: HANDLE_OPACITY_TRANSITION,
            }}
        />
    );
};

/** Program、运镜与走位段条只在领域命令不同；手势、把手与读数必须完全同构。 */
const TimelineClipBar = observer(function TimelineClipBar({ barId, onSelectProgramClip }: TimelineClipBarProps) {
    const stores = useDirectorDeskStores();
    const drag = useTimelineClipDrag({
        barId,
        onCommit: (range) => {
            const currentBar = projectedBar(stores, barId);
            if (!currentBar) return;
            const command = rangeCommandFor(stores, currentBar, range);
            if (!command) return;
            reportCommandFailure(stores, stores.dispatcher.dispatch(command, stores));
        },
    });
    const bar = projectedBar(stores, barId);
    if (!bar) return null;
    const removeFollow = (): void => {
        reportCommandFailure(
            stores,
            stores.dispatcher.dispatch({ type: "program.remove-clip", payload: { id: bar.id } }, stores),
        );
    };
    const currentRange = drag.range ?? { startTimeSeconds: bar.startSeconds, durationSeconds: bar.durationSeconds };
    const activate = BAR_ACTIVATION[bar.kind];
    const isMotion = bar.kind === TIMELINE_BAR_KIND.MOTION;
    const isTransform = bar.kind === TIMELINE_BAR_KIND.TRANSFORM;
    return (
        <Box
            role="button"
            tabIndex={0}
            aria-label={`${bar.label} 片段 ${bar.startSeconds.toFixed(DRAG_READOUT_DECIMAL_PLACES)} 秒`}
            onClick={() => {
                if (drag.shouldIgnoreClick()) return;
                activate(stores, bar, onSelectProgramClip);
            }}
            onPointerDown={drag.onPointerDown}
            onPointerMove={drag.onPointerMove}
            onPointerUp={drag.onPointerUp}
            onPointerCancel={drag.onPointerCancel}
            sx={{
                position: "absolute",
                top: BAR_VERTICAL_INSET_PX,
                bottom: BAR_VERTICAL_INSET_PX,
                left: `${bar.startRatio * PERCENT_FULL}%`,
                width: `${bar.widthRatio * PERCENT_FULL}%`,
                px: 0.75,
                overflow: "hidden",
                transformOrigin: BAR_TRANSFORM_ORIGIN,
                border: 1,
                borderColor: isMotion && stores.motionAuthoring.selectedClipId === bar.id ? "primary.light" : BAR_COLOR[bar.kind],
                bgcolor: isMotion ? (theme) => alpha(theme.palette.primary.main, MOTION_CLIP_BACKGROUND_ALPHA) : BAR_COLOR[bar.kind],
                color: "common.white",
                cursor: drag.isDragging ? "grabbing" : "grab",
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: "nowrap",
                fontFamily: MONO_FONT_STACK,
                touchAction: "none",
                zIndex: isTransform ? TRANSFORM_BAR_Z_INDEX : CLIP_BAR_Z_INDEX,
                "&:hover .timeline-drag-handle, &:focus-visible .timeline-drag-handle": {
                    opacity: HANDLE_VISIBLE_OPACITY,
                },
            }}
        >
            {bar.label}
            <TimelineDragHandle side={TIMELINE_DRAG_HANDLE_SIDE.START} />
            <TimelineDragHandle side={TIMELINE_DRAG_HANDLE_SIDE.END} />
            {drag.range && (
                <Box
                    sx={{
                        position: "absolute",
                        inset: TIME_START_SECONDS,
                        display: "grid",
                        placeItems: "center",
                        pointerEvents: "none",
                        bgcolor: DRAG_READOUT_BACKGROUND,
                        fontFamily: MONO_FONT_STACK,
                    }}
                >
                    {`${currentRange.startTimeSeconds.toFixed(DRAG_READOUT_DECIMAL_PLACES)}s / ${currentRange.durationSeconds.toFixed(DRAG_READOUT_DECIMAL_PLACES)}s`}
                </Box>
            )}
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

const ProgramClipBar = observer(function ProgramClipBar({ barId, onSelect }: { readonly barId: string; readonly onSelect: (clipId: string) => void }) {
    return <TimelineClipBar barId={barId} onSelectProgramClip={onSelect} />;
});

const MotionClipBar = observer(function MotionClipBar({ clipId }: { readonly clipId: string }) {
    return <TimelineClipBar barId={clipId} />;
});

const TransformClipBar = observer(function TransformClipBar({ trackId }: { readonly trackId: string }) {
    return <TimelineClipBar barId={trackId} />;
});

const MotionKeyDiamond = observer(function MotionKeyDiamond({
    clipId,
    keyId,
}: {
    readonly clipId: string;
    readonly keyId: string;
}) {
    const stores = useDirectorDeskStores();
    const row = stores.timelineLayout
        .project(motionViewport(stores))
        .find((candidate) => candidate.kind === TIMELINE_ROW_KIND.MOTION);
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
                cursor: KEY_DRAG_CURSOR,
                zIndex: CLIP_BAR_Z_INDEX,
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
                cursor: KEY_DRAG_CURSOR,
                zIndex: CLIP_BAR_Z_INDEX,
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
            {row.bars
                .filter((bar) => bar.kind === TIMELINE_BAR_KIND.TRANSFORM)
                .map((bar) => (
                    <TransformClipBar key={bar.id} trackId={bar.id} />
                ))}
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
    [TIMELINE_ROW_KIND.MOTION]: (rowId) => <MotionTrackBody rowId={rowId} />,
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
