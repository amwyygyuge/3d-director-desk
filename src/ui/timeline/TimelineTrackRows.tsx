import LinkIcon from "@mui/icons-material/Link";
import DirectionsWalkIcon from "@mui/icons-material/DirectionsWalk";
import Switch from "@mui/material/Switch";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { observer } from "mobx-react-lite";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";

import { TIMELINE_DRAG_KIND, TimelineClipDragResolver } from "@/authoring/TimelineClipDrag";
import type { SnapCandidates, SnapResolution } from "@/authoring/SnapResolver";
import type { TimelineClipRange, TimelineDragKind } from "@/authoring/TimelineClipDrag";
import { TimelineSelection } from "@/authoring/TimelineSelection";
import { TIMELINE_BAR_KIND, TIMELINE_MARK_KIND, TIMELINE_ROW_KIND } from "@/authoring/TimelineLayout";
import type {
    TimelineBar,
    TimelineBarKind,
    TimelineMark,
    TimelineRow,
    TimelineRowKind,
} from "@/authoring/TimelineLayout";
import { PROGRAM_SOURCE_KIND } from "@/camera/CameraProgramTrack";
import type { MotionClipProgramSource, ProgramSource, StaticShotProgramSource } from "@/camera/CameraProgramTrack";
import type { SerializedCommand } from "@/command/DirectorCommand";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { TimelineContextMenu, useTimelineContextMenu } from "@/ui/timeline/TimelineContextMenu";
import { MONO_FONT_STACK } from "@/ui/shell/theme";

const TRACK_LABEL_WIDTH_PX = 168;
const TRACK_HEIGHT_PX = 32;
const TRACK_ACCENT_WIDTH_PX = 2;
/**
 * 行内分层:段条与关键帧菱形各占一条互不重叠的 lane。
 *
 * 分层不是排版偏好,是命中问题:菱形绝对定位在关键帧时刻,而运镜/走位的首末帧恰好落在
 * 段条两端——12px 的菱形正好盖住 6px 的 resize 把手,于是「拖边缘改时长」永远抢不到指针,
 * 拖出来的是单枚帧的位移。让两者各占一条 lane 后,把手全程裸露,无需任何像素级命中裁决。
 */
const BAR_LANE_TOP_PX = 3;
const BAR_LANE_HEIGHT_PX = 15;
const MARK_LANE_TOP_PX = 20;
const KEY_SIZE_PX = 10;
const KEY_HALF_SIZE_PX = KEY_SIZE_PX / 2;
/** Shift+方向键保持秒级粗调;无修饰键按当前帧率微调。 */
const KEYBOARD_SHIFT_TIME_STEP_SECONDS = 1;
/** 键盘改时长的下限:再短就退化成一个点,重定时命令也会拒 */
const MINIMUM_BAR_DURATION_SECONDS = 0.1;
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
const ACTION_TRACK_ACCENT = "success.main";
const PROGRAM_BAR_COLOR = "secondary.main";
const MOTION_BAR_COLOR = "primary.main";
const ACTION_BAR_COLOR = "success.main";
const TRANSFORM_BAR_COLOR = "secondary.main";
const TRACK_DATA_ATTRIBUTE = "[data-timeline-track]";
const BAR_TRANSFORM_ORIGIN = "left center";
const DRAG_HANDLE_CLASS_NAME = "timeline-drag-handle";
const SNAP_GUIDE_COLOR = "warning.main";
const SNAP_GUIDE_WIDTH_PX = 1;
const SNAP_GUIDE_HEIGHT_PX = TRACK_HEIGHT_PX;
const MARKER_PIN_WIDTH_PX = 2;
const MARKER_LABEL_OFFSET_PX = 4;
const MARKER_TRACK_ACCENT = "warning.main";
const PROGRAM_CONFLICT_BORDER = "error.main";
const PROGRAM_CONFLICT_LABEL = "成片片段与另一片段重叠：同一时刻有两路输出，导出以排在后面的为准";
const SNAP_LABEL = "启用吸附";
const SNAP_HINT = "拖拽时自动贴到播放头、片段边缘、关键帧与标记；按住 Alt 临时关闭";
const DRAG_READOUT_BACKGROUND = "rgba(0,0,0,0.72)";
const LINK_LABEL = "解除时段联动";
const LINK_HINT = "解除后成片片段与运镜片段的时段各自独立";
const LINK_ICON_SIZE = "small" as const;
const BAR_BADGE_MARGIN = 0.5;
const FOLLOW_LABEL = "跟拍";
const FOLLOW_UNBIND_HINT = "点击解除跟拍";

type ProgramRangeCommandOptions = {
    readonly clipId: string;
    readonly source: ProgramSource;
    readonly range: TimelineClipRange;
};
function followBadgeTooltip(subjectName: string): string {
    return `${FOLLOW_LABEL} ${subjectName} · ${FOLLOW_UNBIND_HINT}`;
}

const TIMELINE_DRAG_HANDLE_SIDE = {
    START: "start",
    END: "end",
} as const;
type TimelineDragHandleSide = (typeof TIMELINE_DRAG_HANDLE_SIDE)[keyof typeof TIMELINE_DRAG_HANDLE_SIDE];

const DRAG_HANDLE_POSITION: Record<TimelineDragHandleSide, { readonly left?: number; readonly right?: number }> = {
    [TIMELINE_DRAG_HANDLE_SIDE.START]: { left: TIME_START_SECONDS },
    [TIMELINE_DRAG_HANDLE_SIDE.END]: { right: TIME_START_SECONDS },
};
type TrackAccent =
    | typeof MARKER_TRACK_ACCENT
    | typeof PROGRAM_TRACK_ACCENT
    | typeof KEYFRAME_TRACK_ACCENT
    | typeof MOTION_TRACK_ACCENT
    | typeof ACTION_TRACK_ACCENT;

/** 行组件只收身份 id:选中态自取自写,不经父组件回调(props 边界纪律) */
interface TimelineProjectedRowProps {
    readonly rowId: string;
}

interface TrackRowProps {
    readonly rowId: string;
    readonly children: ReactNode;
}

interface TimelineClipBarProps {
    readonly barId: string;
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
    /** 拖拽种类决定读数措辞:改起点还是改时长,作者必须当场看得出来 */
    readonly kind: TimelineDragKind | null;
    readonly snap: SnapResolution | null;
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
): SnapResolution {
    const clip = stores.motion.clip(clipId);
    const keys =
        clip?.keys.filter((key) => key.id !== excludedKeyId).map((key) => clip.timeAtProgress(key.progress)) ?? [];
    const edges = stores.motion.clips
        .filter((motionClip) => motionClip.id !== clipId)
        .flatMap((motionClip) => [motionClip.startTimeSeconds, motionClip.endTimeSeconds]);
    return stores.snapResolver.resolve({
        timeSeconds,
        secondsPerPixel,
        candidates: {
            playheadSeconds: stores.playheadDisplay.value,
            edges,
            keys,
            markers: stores.timeline.document.markers.map((marker) => marker.timeSeconds),
        },
        enabled: stores.motionAuthoring.snapEnabled && !altKey,
        durationSeconds: stores.timeline.document.duration,
    });
}

const clipDragResolver = new TimelineClipDragResolver();

function clipDragCandidates(stores: DirectorDeskStores, bar: TimelineBar): SnapCandidates {
    const rows = stores.timelineLayout.project(motionViewport(stores));
    // 吸附吸到实际占用末端(含一次性动作的 release 尾巴),否则贴到视觉末端会被重叠围栏拒掉
    const edges = rows
        .flatMap((row) => row.bars)
        .filter((candidate) => candidate.id !== bar.id || candidate.kind !== bar.kind)
        .flatMap((candidate) => [candidate.startSeconds, candidate.occupancyEndSeconds]);
    const keys = rows
        .flatMap((row) => row.marks)
        .filter((mark) => mark.kind !== TIMELINE_MARK_KIND.MARKER)
        .map((mark) => mark.timeSeconds);
    return {
        playheadSeconds: stores.playheadDisplay.value,
        edges,
        keys,
        markers: stores.timeline.document.markers.map((marker) => marker.timeSeconds),
    };
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

function clipSnapResolution(options: {
    readonly stores: DirectorDeskStores;
    readonly bar: TimelineBar;
    readonly range: TimelineClipRange;
    readonly trackWidthPx: number;
    readonly kind: TimelineDragKind;
}): SnapResolution {
    const boundaryTimeSeconds =
        options.kind === TIMELINE_DRAG_KIND.RESIZE_END
            ? options.range.startTimeSeconds + options.range.durationSeconds
            : options.range.startTimeSeconds;
    return options.stores.snapResolver.resolve({
        timeSeconds: boundaryTimeSeconds,
        secondsPerPixel: motionViewport(options.stores).secondsPerPixel(options.trackWidthPx),
        candidates: clipDragCandidates(options.stores, options.bar),
        enabled: options.stores.motionAuthoring.snapEnabled,
        durationSeconds: options.stores.timeline.document.duration,
    });
}

/** 三种时段条共用的瞬时手势层；只有落点通过 onCommit 进入命令与撤销栈。 */
function useTimelineClipDrag(options: ClipDragHookOptions): ClipDragHookResult {
    const stores = useDirectorDeskStores();
    const drag = useRef<ClipDragState | null>(null);
    const ignoreClick = useRef(false);
    const [range, setRange] = useState<TimelineClipRange | null>(null);
    const [kind, setKind] = useState<TimelineDragKind | null>(null);
    const [snap, setSnap] = useState<SnapResolution | null>(null);
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
        setKind(drag.current.kind);
        setRange(drag.current.range);
        setSnap(null);
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
        setSnap(
            clipSnapResolution({
                stores,
                bar,
                range: nextRange,
                trackWidthPx: currentDrag.trackWidthPx,
                kind: currentDrag.kind,
            }),
        );
    };
    const complete = (event: PointerEvent<HTMLDivElement>, shouldCommit: boolean): void => {
        const currentDrag = drag.current;
        const bar = projectedBar(stores, options.barId);
        const nextRange = currentDrag && bar ? rangeAtDragPointer({ stores, bar, drag: currentDrag, event }) : null;
        currentDrag?.element.releasePointerCapture(event.pointerId);
        if (currentDrag) currentDrag.element.style.transform = "";
        drag.current = null;
        setRange(null);
        setKind(null);
        setSnap(null);
        const hasChanged =
            currentDrag !== null &&
            nextRange !== null &&
            (Math.abs(nextRange.startTimeSeconds - currentDrag.range.startTimeSeconds) >
                DRAG_MOVEMENT_EPSILON_SECONDS ||
                Math.abs(nextRange.durationSeconds - currentDrag.range.durationSeconds) >
                    DRAG_MOVEMENT_EPSILON_SECONDS);
        ignoreClick.current = hasChanged;
        if (hasChanged && nextRange && shouldCommit) options.onCommit(nextRange);
    };
    return {
        range,
        kind,
        snap,
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
        [TIMELINE_ROW_KIND.MARKER]: MARKER_TRACK_ACCENT,
        [TIMELINE_ROW_KIND.PROGRAM]: PROGRAM_TRACK_ACCENT,
        [TIMELINE_ROW_KIND.MOTION]: MOTION_TRACK_ACCENT,
        [TIMELINE_ROW_KIND.ACTION]: ACTION_TRACK_ACCENT,
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
                {row.kind === TIMELINE_ROW_KIND.MARKER && (
                    <Tooltip title={SNAP_HINT}>
                        <Switch
                            checked={stores.motionAuthoring.snapEnabled}
                            slotProps={{ input: { "aria-label": SNAP_LABEL } }}
                            onChange={(event) => stores.motionAuthoring.setSnapEnabled(event.target.checked)}
                            size="small"
                            sx={{ ml: "auto" }}
                        />
                    </Tooltip>
                )}
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

const PROGRAM_RANGE_COMMAND: Record<ProgramSource["kind"], (options: ProgramRangeCommandOptions) => SerializedCommand> =
    {
        [PROGRAM_SOURCE_KIND.MOTION_CLIP]: linkedProgramRangeCommand,
        [PROGRAM_SOURCE_KIND.STATIC_SHOT]: staticProgramRangeCommand,
    };

function rangeCommandFor(
    stores: DirectorDeskStores,
    bar: TimelineBar,
    range: TimelineClipRange,
): SerializedCommand | null {
    const commands: Record<TimelineBarKind, () => SerializedCommand | null> = {
        [TIMELINE_BAR_KIND.MOTION]: () => ({ type: "motion.set-clip-range", payload: { id: bar.id, ...range } }),
        [TIMELINE_BAR_KIND.PROGRAM]: () => {
            const clip = stores.motion.program.clip(bar.id);
            return clip
                ? PROGRAM_RANGE_COMMAND[clip.source.kind]({ clipId: clip.id, source: clip.source, range })
                : null;
        },
        // 段条 id 是排期段 id,ownerId 才是实体:两者都要带上,否则会改到同实体的另一段
        [TIMELINE_BAR_KIND.ACTION]: () => ({
            type: "action.set-range",
            payload: { objectId: bar.ownerId, performanceId: bar.id, ...range },
        }),
        [TIMELINE_BAR_KIND.TRANSFORM]: () => ({
            type: "timeline.retime-track",
            payload: { trackId: bar.id, ...range },
        }),
    };
    return commands[bar.kind]();
}

/** 右键与单击共享选中语义；仅普通单击运镜条才进入预览。 */
const BAR_SELECTION: Record<TimelineBarKind, (stores: DirectorDeskStores, bar: TimelineBar) => void> = {
    [TIMELINE_BAR_KIND.MOTION]: (stores, bar) => stores.timelineSelection.select(TimelineSelection.motionClip(bar.id)),
    [TIMELINE_BAR_KIND.PROGRAM]: (stores, bar) =>
        stores.timelineSelection.select(TimelineSelection.programClip(bar.id)),
    [TIMELINE_BAR_KIND.ACTION]: (stores, bar) =>
        stores.timelineSelection.select(TimelineSelection.actionClip(bar.ownerId, bar.id)),
    [TIMELINE_BAR_KIND.TRANSFORM]: (stores, bar) =>
        stores.timelineSelection.select(TimelineSelection.walkTrack(bar.id)),
};

function selectTimelineBar(stores: DirectorDeskStores, bar: TimelineBar): void {
    stores.selection.clear();
    BAR_SELECTION[bar.kind](stores, bar);
}

/** 点运镜条 = 选中它并进镜头预览:看这段画面与编辑这段是同一个意图。 */
function activateMotionBar(stores: DirectorDeskStores, bar: TimelineBar): void {
    selectTimelineBar(stores, bar);
    const result = stores.dispatcher.dispatch({ type: "motion.preview.enter", payload: { clipId: bar.id } }, stores);
    reportCommandFailure(stores, result);
}

/** 三类段条的点击落点:一律写进同一个时间轴选中态,底栏与 Delete 因此永远同源。 */
const BAR_ACTIVATION: Record<TimelineBarKind, (stores: DirectorDeskStores, bar: TimelineBar) => void> = {
    [TIMELINE_BAR_KIND.MOTION]: activateMotionBar,
    [TIMELINE_BAR_KIND.PROGRAM]: selectTimelineBar,
    [TIMELINE_BAR_KIND.ACTION]: selectTimelineBar,
    [TIMELINE_BAR_KIND.TRANSFORM]: selectTimelineBar,
};

const BAR_COLOR: Record<TimelineBarKind, string> = {
    [TIMELINE_BAR_KIND.MOTION]: MOTION_BAR_COLOR,
    [TIMELINE_BAR_KIND.PROGRAM]: PROGRAM_BAR_COLOR,
    [TIMELINE_BAR_KIND.ACTION]: ACTION_BAR_COLOR,
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
}

/**
 * 拖拽读数:同一条段条上「挪位置」与「改时长」是两种领域操作(平移 vs 整段重定时),
 * 读数必须当场说清改的是哪一个,否则作者只能靠事后观察猜。
 */
function dragReadout(kind: TimelineDragKind | null, range: TimelineClipRange): string {
    const startText = `${range.startTimeSeconds.toFixed(DRAG_READOUT_DECIMAL_PLACES)}s`;
    const durationText = `${range.durationSeconds.toFixed(DRAG_READOUT_DECIMAL_PLACES)}s`;
    const readouts: Record<TimelineDragKind, string> = {
        [TIMELINE_DRAG_KIND.MOVE]: `起点 ${startText}`,
        [TIMELINE_DRAG_KIND.RESIZE_START]: `起点 ${startText} · 重定时 ${durationText}`,
        [TIMELINE_DRAG_KIND.RESIZE_END]: `重定时 ${durationText}`,
    };
    return kind === null ? `${startText} / ${durationText}` : readouts[kind];
}

function overlapsProgramBar(stores: DirectorDeskStores, bar: TimelineBar): boolean {
    if (bar.kind !== TIMELINE_BAR_KIND.PROGRAM) return false;
    const endTimeSeconds = bar.startSeconds + bar.durationSeconds;
    const programBars = stores.timelineLayout
        .project(motionViewport(stores))
        .find((row) => row.kind === TIMELINE_ROW_KIND.PROGRAM)?.bars;
    return (
        programBars?.some(
            (candidate) =>
                candidate.id !== bar.id &&
                candidate.startSeconds < endTimeSeconds &&
                bar.startSeconds < candidate.startSeconds + candidate.durationSeconds,
        ) ?? false
    );
}

/** Program、运镜与走位段条只在领域命令不同；手势、把手与读数必须全同构。 */
const TimelineClipBar = observer(function TimelineClipBar({ barId }: TimelineClipBarProps) {
    const stores = useDirectorDeskStores();
    const { open } = useTimelineContextMenu();
    const commitRange = (range: TimelineClipRange): void => {
        const currentBar = projectedBar(stores, barId);
        if (!currentBar) return;
        const command = rangeCommandFor(stores, currentBar, range);
        if (!command) return;
        reportCommandFailure(stores, stores.dispatcher.dispatch(command, stores));
    };
    const drag = useTimelineClipDrag({ barId, onCommit: commitRange });
    const bar = projectedBar(stores, barId);
    if (!bar) return null;
    const removeLinkedProgram = (): void => {
        reportCommandFailure(
            stores,
            stores.dispatcher.dispatch({ type: "program.remove-clip", payload: { id: bar.id } }, stores),
        );
    };
    const unbindFollow = (): void => {
        if (bar.followSubjectId === null) return;
        reportCommandFailure(
            stores,
            stores.dispatcher.dispatch({ type: "motion.unbind-follow", payload: { id: bar.id } }, stores),
        );
    };
    const currentRange = drag.range ?? { startTimeSeconds: bar.startSeconds, durationSeconds: bar.durationSeconds };
    const activate = BAR_ACTIVATION[bar.kind];
    const isMotion = bar.kind === TIMELINE_BAR_KIND.MOTION;
    const followSubjectName = bar.followSubjectId
        ? (stores.scene.manager.getEntity(bar.followSubjectId)?.name ?? bar.followSubjectId)
        : null;
    const isTransform = bar.kind === TIMELINE_BAR_KIND.TRANSFORM;
    const isSelected = stores.timelineSelection.current.ownerId === bar.id;
    const isProgramConflict = overlapsProgramBar(stores, bar);
    const snapGuideLeft = drag.kind === TIMELINE_DRAG_KIND.RESIZE_END ? `${PERCENT_FULL}%` : TIME_START_SECONDS;
    /** 键盘等价路径:方向键平移,Shift+方向键改时长——与拖拽走同一条命令。 */
    const keydown = (event: KeyboardEvent<HTMLDivElement>): void => {
        const keyboardTimeStepSeconds = event.shiftKey
            ? KEYBOARD_SHIFT_TIME_STEP_SECONDS
            : stores.timeline.document.frameRate.frameDurationSeconds;
        const stepByKey: Record<string, number> = {
            ArrowLeft: -keyboardTimeStepSeconds,
            ArrowRight: keyboardTimeStepSeconds,
        };
        const step = stepByKey[event.key];
        if (step === undefined) return;
        event.preventDefault();
        // 段条自己消费方向键:必须掐断冒泡,否则 window 上的快捷键注册表会同时把播放头也挪一格
        event.stopPropagation();
        const duration = stores.timeline.document.duration;
        const range = event.shiftKey
            ? {
                  startTimeSeconds: bar.startSeconds,
                  durationSeconds: clamp(
                      bar.durationSeconds + step,
                      MINIMUM_BAR_DURATION_SECONDS,
                      duration - bar.startSeconds,
                  ),
              }
            : {
                  startTimeSeconds: clamp(bar.startSeconds + step, TIME_START_SECONDS, duration - bar.durationSeconds),
                  durationSeconds: bar.durationSeconds,
              };
        commitRange(range);
    };
    return (
        <Tooltip title={isProgramConflict ? PROGRAM_CONFLICT_LABEL : ""}>
            <Box
                role="button"
                tabIndex={0}
                aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight"
                aria-label={`${bar.label} 片段 ${bar.startSeconds.toFixed(DRAG_READOUT_DECIMAL_PLACES)} 秒，时长 ${bar.durationSeconds.toFixed(DRAG_READOUT_DECIMAL_PLACES)} 秒`}
                onClick={() => {
                    if (drag.shouldIgnoreClick()) return;
                    activate(stores, bar);
                }}
                onContextMenu={(event) => {
                    const track = timelineTrackFor(event.currentTarget);
                    selectTimelineBar(stores, bar);
                    open(
                        event,
                        track ? trackTimeAtPointer(stores, track, event.clientX).timeSeconds : bar.startSeconds,
                        isMotion ? bar.id : null,
                    );
                }}
                onKeyDown={keydown}
                onPointerDown={drag.onPointerDown}
                onPointerMove={drag.onPointerMove}
                onPointerUp={drag.onPointerUp}
                onPointerCancel={drag.onPointerCancel}
                sx={{
                    position: "absolute",
                    top: BAR_LANE_TOP_PX,
                    height: BAR_LANE_HEIGHT_PX,
                    left: `${bar.startRatio * PERCENT_FULL}%`,
                    width: `${bar.widthRatio * PERCENT_FULL}%`,
                    px: 0.75,
                    display: "flex",
                    alignItems: "center",
                    overflow: "hidden",
                    transformOrigin: BAR_TRANSFORM_ORIGIN,
                    border: 1,
                    borderColor: isProgramConflict
                        ? PROGRAM_CONFLICT_BORDER
                        : isSelected
                          ? "common.white"
                          : BAR_COLOR[bar.kind],
                    bgcolor: isMotion
                        ? (theme) => alpha(theme.palette.primary.main, MOTION_CLIP_BACKGROUND_ALPHA)
                        : BAR_COLOR[bar.kind],
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
                        {dragReadout(drag.kind, currentRange)}
                    </Box>
                )}
                {drag.isDragging && (
                    <Box
                        sx={{
                            position: "absolute",
                            top: -BAR_LANE_TOP_PX,
                            bottom: -MARK_LANE_TOP_PX,
                            left: snapGuideLeft,
                            width: SNAP_GUIDE_WIDTH_PX,
                            bgcolor: SNAP_GUIDE_COLOR,
                            opacity: drag.snap?.candidate ? HANDLE_VISIBLE_OPACITY : HANDLE_HIDDEN_OPACITY,
                            pointerEvents: "none",
                        }}
                    />
                )}
                {(bar.linked || followSubjectName) && (
                    <Box sx={{ display: "flex", alignItems: "center", ml: BAR_BADGE_MARGIN }}>
                        {bar.linked && (
                            <Tooltip title={`${LINK_LABEL}：${LINK_HINT}`}>
                                <IconButton
                                    aria-label={LINK_LABEL}
                                    size={LINK_ICON_SIZE}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        removeLinkedProgram();
                                    }}
                                    sx={{ color: "inherit", p: 0 }}
                                >
                                    <LinkIcon fontSize="inherit" />
                                </IconButton>
                            </Tooltip>
                        )}
                        {followSubjectName && (
                            <Tooltip title={followBadgeTooltip(followSubjectName)}>
                                <IconButton
                                    aria-label={`${FOLLOW_LABEL} ${followSubjectName}`}
                                    size={LINK_ICON_SIZE}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        unbindFollow();
                                    }}
                                    sx={{ color: "inherit", p: 0 }}
                                >
                                    <DirectionsWalkIcon fontSize="inherit" />
                                </IconButton>
                            </Tooltip>
                        )}
                    </Box>
                )}
            </Box>
        </Tooltip>
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
    const { open } = useTimelineContextMenu();
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
        return snapTime(stores, clipId, keyId, pointer.timeSeconds, pointer.secondsPerPixel, event.altKey).timeSeconds;
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
                stores.timelineSelection.select(TimelineSelection.motionKey(clipId, keyId));
            }}
            onDoubleClick={() => {
                const result = stores.dispatcher.dispatch(
                    { type: "transport.seek", payload: { time: mark.timeSeconds } },
                    stores,
                );
                reportCommandFailure(stores, result);
            }}
            onContextMenu={(event) => {
                stores.timelineSelection.select(TimelineSelection.motionKey(clipId, keyId));
                open(event, mark.timeSeconds);
            }}
            onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { element: event.currentTarget, originTimeSeconds: mark.timeSeconds };
                stores.timelineSelection.select(TimelineSelection.motionKey(clipId, keyId));
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
                top: MARK_LANE_TOP_PX,
                left: `calc(${mark.ratio * PERCENT_FULL}% - ${KEY_HALF_SIZE_PX}px)`,
                width: KEY_SIZE_PX,
                height: KEY_SIZE_PX,
                transform: "rotate(45deg)",
                bgcolor:
                    stores.timelineSelection.current.motionKeyId === keyId &&
                    stores.timelineSelection.current.motionClipId === clipId
                        ? "common.white"
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
}: {
    readonly trackId: string;
    readonly keyId: string;
}) {
    const stores = useDirectorDeskStores();
    const mark = projectedMark(stores, trackId, keyId);
    const drag = useRef<KeyDragState | null>(null);
    const { open } = useTimelineContextMenu();
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
    const select = (): void => {
        stores.timelineSelection.select(TimelineSelection.walkKey(trackId, keyId));
    };
    const keydown = (event: KeyboardEvent<HTMLDivElement>): void => {
        const keyboardTimeStepSeconds = event.shiftKey
            ? KEYBOARD_SHIFT_TIME_STEP_SECONDS
            : stores.timeline.document.frameRate.frameDurationSeconds;
        const deltaByKey: Record<string, number | null> = {
            ArrowLeft: -keyboardTimeStepSeconds,
            ArrowRight: keyboardTimeStepSeconds,
        };
        // 菱形自己消费 Enter/Space/方向键:掐断冒泡,避免 window 注册表把同一次按键再当成播放/挪播放头
        const isSelectionKey = event.key === "Enter" || event.key === " ";
        if (isSelectionKey) {
            event.preventDefault();
            event.stopPropagation();
            select();
            return;
        }
        const delta = deltaByKey[event.key] ?? null;
        if (delta === null) return;
        event.preventDefault();
        event.stopPropagation();
        const duration = stores.timeline.document.duration;
        const nextTime = clamp(mark.timeSeconds + delta, TIME_START_SECONDS, duration);
        select();
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
            onFocus={select}
            onKeyDown={keydown}
            onContextMenu={(event) => {
                select();
                open(event, mark.timeSeconds);
            }}
            onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { element: event.currentTarget, originTimeSeconds: mark.timeSeconds };
                select();
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
                top: MARK_LANE_TOP_PX,
                left: `calc(${mark.ratio * PERCENT_FULL}% - ${KEY_HALF_SIZE_PX}px)`,
                width: KEY_SIZE_PX,
                height: KEY_SIZE_PX,
                transform: "rotate(45deg)",
                bgcolor:
                    stores.timelineSelection.current.walkKeyframeId === keyId ? "common.white" : KEYFRAME_TRACK_ACCENT,
                cursor: KEY_DRAG_CURSOR,
                zIndex: CLIP_BAR_Z_INDEX,
                touchAction: "none",
            }}
        />
    );
});

function markerSnapResolution(options: {
    readonly stores: DirectorDeskStores;
    readonly markerId: string;
    readonly timeSeconds: number;
    readonly secondsPerPixel: number;
    readonly altKey: boolean;
}): SnapResolution {
    const rows = options.stores.timelineLayout.project(motionViewport(options.stores));
    const edges = rows
        .flatMap((row) => row.bars)
        .flatMap((bar) => [bar.startSeconds, bar.startSeconds + bar.durationSeconds]);
    const keys = rows
        .flatMap((row) => row.marks)
        .filter((mark) => mark.kind !== TIMELINE_MARK_KIND.MARKER)
        .map((mark) => mark.timeSeconds);
    const markers = options.stores.timeline.document.markers
        .filter((marker) => marker.id !== options.markerId)
        .map((marker) => marker.timeSeconds);
    return options.stores.snapResolver.resolve({
        timeSeconds: options.timeSeconds,
        secondsPerPixel: options.secondsPerPixel,
        candidates: { playheadSeconds: options.stores.playheadDisplay.value, edges, keys, markers },
        enabled: options.stores.motionAuthoring.snapEnabled && !options.altKey,
        durationSeconds: options.stores.timeline.document.duration,
    });
}

interface TimelineMarkerDrag {
    readonly isDragging: boolean;
    readonly snap: SnapResolution | null;
    readonly shouldIgnoreClick: () => boolean;
    readonly onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    readonly onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    readonly onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
    readonly onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
}

function markerResolutionAtPointer(options: {
    readonly stores: DirectorDeskStores;
    readonly markerId: string;
    readonly event: PointerEvent<HTMLDivElement>;
}): SnapResolution | null {
    const track = timelineTrackFor(options.event.currentTarget);
    if (!track) return null;
    const pointer = trackTimeAtPointer(options.stores, track, options.event.clientX);
    return markerSnapResolution({
        stores: options.stores,
        markerId: options.markerId,
        timeSeconds: pointer.timeSeconds,
        secondsPerPixel: pointer.secondsPerPixel,
        altKey: options.event.altKey,
    });
}

function useTimelineMarkerDrag(options: {
    readonly markerId: string;
    readonly timeSeconds: number;
}): TimelineMarkerDrag {
    const stores = useDirectorDeskStores();
    const drag = useRef<KeyDragState | null>(null);
    const ignoreClick = useRef(false);
    const [snap, setSnap] = useState<SnapResolution | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const complete = (event: PointerEvent<HTMLDivElement>, shouldCommit: boolean): void => {
        const currentDrag = drag.current;
        const resolution = markerResolutionAtPointer({ stores, markerId: options.markerId, event });
        currentDrag?.element.releasePointerCapture(event.pointerId);
        if (currentDrag) currentDrag.element.style.transform = "";
        drag.current = null;
        setIsDragging(false);
        setSnap(null);
        if (!currentDrag || !resolution) return;
        const changed =
            Math.abs(resolution.timeSeconds - currentDrag.originTimeSeconds) > DRAG_MOVEMENT_EPSILON_SECONDS;
        ignoreClick.current = changed;
        if (!changed || !shouldCommit) return;
        reportCommandFailure(
            stores,
            stores.dispatcher.dispatch(
                {
                    type: "timeline.move-marker",
                    payload: { id: options.markerId, timeSeconds: resolution.timeSeconds },
                },
                stores,
            ),
        );
    };
    return {
        isDragging,
        snap,
        shouldIgnoreClick: () => {
            const shouldIgnore = ignoreClick.current;
            ignoreClick.current = false;
            return shouldIgnore;
        },
        onPointerDown: (event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { element: event.currentTarget, originTimeSeconds: options.timeSeconds };
            setIsDragging(true);
            setSnap(null);
        },
        onPointerMove: (event) => {
            const currentDrag = drag.current;
            const resolution = markerResolutionAtPointer({ stores, markerId: options.markerId, event });
            const track = timelineTrackFor(event.currentTarget);
            if (!currentDrag || !resolution || !track) return;
            const deltaPixels =
                (resolution.timeSeconds - currentDrag.originTimeSeconds) /
                motionViewport(stores).secondsPerPixel(track.getBoundingClientRect().width);
            currentDrag.element.style.transform = `translateX(${deltaPixels}px)`;
            setSnap(resolution);
        },
        onPointerUp: (event) => complete(event, true),
        onPointerCancel: (event) => complete(event, false),
    };
}

const TimelineMarkerPin = observer(function TimelineMarkerPin({ markerId }: { readonly markerId: string }) {
    const stores = useDirectorDeskStores();
    const { open } = useTimelineContextMenu();
    const marker = stores.timeline.document.marker(markerId);
    const row = stores.timelineLayout
        .project(motionViewport(stores))
        .find((candidate) => candidate.kind === TIMELINE_ROW_KIND.MARKER);
    const mark = row?.marks.find((candidate) => candidate.id === markerId);
    const drag = useTimelineMarkerDrag({ markerId, timeSeconds: mark?.timeSeconds ?? TIME_START_SECONDS });
    if (!marker || !mark) return null;
    const select = (): void => stores.timelineSelection.select(TimelineSelection.marker(markerId));
    return (
        <Box
            role="button"
            tabIndex={0}
            aria-label={`标记 ${marker.label} ${mark.timeSeconds.toFixed(DRAG_READOUT_DECIMAL_PLACES)} 秒`}
            onClick={() => {
                if (drag.shouldIgnoreClick()) return;
                select();
            }}
            onDoubleClick={() => {
                reportCommandFailure(
                    stores,
                    stores.dispatcher.dispatch({ type: "transport.seek", payload: { time: mark.timeSeconds } }, stores),
                );
            }}
            onContextMenu={(event) => {
                select();
                open(event, mark.timeSeconds);
            }}
            onPointerDown={(event) => {
                select();
                drag.onPointerDown(event);
            }}
            onPointerMove={drag.onPointerMove}
            onPointerUp={drag.onPointerUp}
            onPointerCancel={drag.onPointerCancel}
            sx={{
                position: "absolute",
                top: TIME_START_SECONDS,
                bottom: TIME_START_SECONDS,
                left: `calc(${mark.ratio * PERCENT_FULL}% - ${MARKER_PIN_WIDTH_PX / 2}px)`,
                width: MARKER_PIN_WIDTH_PX,
                bgcolor: marker.colorToken ?? MARKER_TRACK_ACCENT,
                cursor: KEY_DRAG_CURSOR,
                touchAction: "none",
                zIndex: CLIP_BAR_Z_INDEX,
            }}
        >
            {drag.isDragging && (
                <Box
                    sx={{
                        position: "absolute",
                        top: TIME_START_SECONDS,
                        height: SNAP_GUIDE_HEIGHT_PX,
                        width: SNAP_GUIDE_WIDTH_PX,
                        bgcolor: SNAP_GUIDE_COLOR,
                        opacity: drag.snap?.candidate ? HANDLE_VISIBLE_OPACITY : HANDLE_HIDDEN_OPACITY,
                        pointerEvents: "none",
                    }}
                />
            )}
            <Typography
                variant="caption"
                noWrap
                sx={{
                    position: "absolute",
                    top: MARKER_LABEL_OFFSET_PX,
                    left: MARKER_LABEL_OFFSET_PX,
                    color: marker.colorToken ?? MARKER_TRACK_ACCENT,
                    fontFamily: MONO_FONT_STACK,
                }}
            >
                {marker.label}
            </Typography>
        </Box>
    );
});

const MarkerTrackBody = observer(function MarkerTrackBody({ rowId }: { readonly rowId: string }) {
    const stores = useDirectorDeskStores();
    const { open } = useTimelineContextMenu();
    const row = projectedRow(stores, rowId);
    if (!row) return null;
    return (
        <Box
            data-timeline-track
            onContextMenu={(event) => {
                stores.timelineSelection.clear();
                open(event, trackTimeAtPointer(stores, event.currentTarget, event.clientX).timeSeconds);
            }}
            sx={{
                position: "relative",
                height: TRACK_HEIGHT_PX,
                bgcolor: (theme) => alpha(theme.palette.warning.main, TRACK_BACKGROUND_ALPHA),
            }}
        >
            {row.marks
                .filter((mark) => mark.kind === TIMELINE_MARK_KIND.MARKER)
                .map((mark) => (
                    <TimelineMarkerPin key={mark.id} markerId={mark.id} />
                ))}
        </Box>
    );
});

const ProgramTrackBody = observer(function ProgramTrackBody({ rowId }: { readonly rowId: string }) {
    const stores = useDirectorDeskStores();
    const { open } = useTimelineContextMenu();
    const row = projectedRow(stores, rowId);
    if (!row) return null;
    return (
        <Box
            data-timeline-track
            onContextMenu={(event) => {
                stores.timelineSelection.clear();
                open(event, trackTimeAtPointer(stores, event.currentTarget, event.clientX).timeSeconds);
            }}
            sx={{
                position: "relative",
                height: TRACK_HEIGHT_PX,
                bgcolor: (theme) => alpha(theme.palette.secondary.main, TRACK_BACKGROUND_ALPHA),
            }}
        >
            {row.bars
                .filter((bar) => bar.kind === TIMELINE_BAR_KIND.PROGRAM)
                .map((bar) => (
                    <TimelineClipBar key={bar.id} barId={bar.id} />
                ))}
        </Box>
    );
});

const MotionTrackBody = observer(function MotionTrackBody({ rowId }: { readonly rowId: string }) {
    const stores = useDirectorDeskStores();
    const { open } = useTimelineContextMenu();
    const row = projectedRow(stores, rowId);
    if (!row) return null;
    return (
        <Box
            data-timeline-track
            onContextMenu={(event) => {
                stores.timelineSelection.clear();
                open(event, trackTimeAtPointer(stores, event.currentTarget, event.clientX).timeSeconds);
            }}
            sx={{
                position: "relative",
                height: TRACK_HEIGHT_PX,
                bgcolor: (theme) => alpha(theme.palette.primary.main, MOTION_TRACK_BACKGROUND_ALPHA),
            }}
        >
            {row.bars
                .filter((bar) => bar.kind === TIMELINE_BAR_KIND.MOTION)
                .map((bar) => (
                    <TimelineClipBar key={bar.id} barId={bar.id} />
                ))}
            {row.marks
                .filter((mark) => mark.kind === TIMELINE_MARK_KIND.CAMERA_KEY)
                .map((mark) => (
                    <MotionKeyDiamond key={`${mark.ownerId}-${mark.id}`} clipId={mark.ownerId} keyId={mark.id} />
                ))}
        </Box>
    );
});

const ActionTrackBody = observer(function ActionTrackBody({ rowId }: { readonly rowId: string }) {
    const stores = useDirectorDeskStores();
    const { open } = useTimelineContextMenu();
    const row = projectedRow(stores, rowId);
    if (!row) return null;
    return (
        <Box
            data-timeline-track
            onContextMenu={(event) => {
                stores.timelineSelection.clear();
                open(event, trackTimeAtPointer(stores, event.currentTarget, event.clientX).timeSeconds);
            }}
            sx={{
                position: "relative",
                height: TRACK_HEIGHT_PX,
                bgcolor: (theme) => alpha(theme.palette.success.main, TRACK_BACKGROUND_ALPHA),
            }}
        >
            {row.bars
                .filter((bar) => bar.kind === TIMELINE_BAR_KIND.ACTION)
                .map((bar) => (
                    <TimelineClipBar key={bar.id} barId={bar.id} />
                ))}
        </Box>
    );
});

const TransformTrackBody = observer(function TransformTrackBody({ rowId }: { readonly rowId: string }) {
    const stores = useDirectorDeskStores();
    const { open } = useTimelineContextMenu();
    const row = projectedRow(stores, rowId);
    if (!row) return null;
    return (
        <Box
            data-timeline-track
            onContextMenu={(event) => {
                stores.timelineSelection.clear();
                open(event, trackTimeAtPointer(stores, event.currentTarget, event.clientX).timeSeconds);
            }}
            sx={{
                position: "relative",
                height: TRACK_HEIGHT_PX,
                bgcolor: (theme) => alpha(theme.palette.secondary.main, TRACK_BACKGROUND_ALPHA),
            }}
        >
            {row.bars
                .filter((bar) => bar.kind === TIMELINE_BAR_KIND.TRANSFORM)
                .map((bar) => (
                    <TimelineClipBar key={bar.id} barId={bar.id} />
                ))}
            {row.marks
                .filter((mark) => mark.kind === TIMELINE_MARK_KIND.TRANSFORM_KEY)
                .map((mark) => (
                    <TransformKeyDiamond key={mark.id} trackId={mark.ownerId} keyId={mark.id} />
                ))}
        </Box>
    );
});

const ROW_CONTENT: Record<TimelineRowKind, (rowId: string) => ReactNode> = {
    [TIMELINE_ROW_KIND.MARKER]: (rowId) => <MarkerTrackBody rowId={rowId} />,
    [TIMELINE_ROW_KIND.PROGRAM]: (rowId) => <ProgramTrackBody rowId={rowId} />,
    [TIMELINE_ROW_KIND.MOTION]: (rowId) => <MotionTrackBody rowId={rowId} />,
    [TIMELINE_ROW_KIND.ACTION]: (rowId) => <ActionTrackBody rowId={rowId} />,
    [TIMELINE_ROW_KIND.TRANSFORM]: (rowId) => <TransformTrackBody rowId={rowId} />,
};

export const TimelineProjectedRow = observer(function TimelineProjectedRow({ rowId }: TimelineProjectedRowProps) {
    const stores = useDirectorDeskStores();
    const row = projectedRow(stores, rowId);
    if (!row) return null;
    return (
        <TimelineContextMenu>
            <TimelineTrackRow rowId={rowId}>{ROW_CONTENT[row.kind](row.id)}</TimelineTrackRow>
        </TimelineContextMenu>
    );
});
