import CloseIcon from "@mui/icons-material/Close";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import VideocamIcon from "@mui/icons-material/Videocam";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { reaction } from "mobx";
import { type ReactNode, useEffect, useRef } from "react";

import { TIMELINE_ROW_KIND } from "@/authoring/TimelineLayout";
import { TIMELINE_SELECTION_KIND } from "@/authoring/TimelineSelection";
import type { TimelineSelection, TimelineSelectionKind } from "@/authoring/TimelineSelection";
import { PROGRAM_SOURCE_KIND } from "@/camera/CameraProgramTrack";
import { TimelineViewport } from "@/authoring/TimelineViewport";
import { EASING, EASING_LABEL } from "@/motion/EasingCurve";
import type { EasingCurve } from "@/motion/EasingCurve";
import { formatShortcutHint, SHORTCUT_ID } from "@/shortcuts/builtinShortcuts";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { MONO_FONT_STACK } from "@/ui/shell/theme";
import { TimelineProjectedRow } from "@/ui/timeline/TimelineTrackRows";
import { useScrubGesture } from "@/ui/timeline/useScrubGesture";

const RULER_HEIGHT_PX = 34;
const TRACK_LABEL_WIDTH_PX = 168;
const TIME_START_SECONDS = 0;
const TIME_END_RATIO = 1;
const PERCENT_FULL = 100;
const PLAYHEAD_Z_INDEX = 3;
const PROGRAM_DEFAULT_DURATION_SECONDS = 2;
const RULER_TARGET_TICK_COUNT = 10;
const RULER_MAX_TICK_COUNT = 14;
const RULER_TICK_STEPS_SECONDS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120] as const;
const RULER_DECIMAL_PRECISION = [
    { maximumStep: 0.1, places: 1 },
    { maximumStep: 0.25, places: 2 },
    { maximumStep: Number.POSITIVE_INFINITY, places: 0 },
] as const;
const ZOOM_IN_FACTOR = 0.8;
const ZOOM_OUT_FACTOR = 1.25;
const TRACK_HEADER_BACKGROUND = "rgba(0,0,0,0.3)";
const TRACK_GRID_BACKGROUND =
    "repeating-linear-gradient(90deg, transparent, transparent 19px, rgba(255,255,255,0.03) 20px)";
const TRACK_BORDER_COLOR = "divider";

/** 滚轮语义按 NLE 惯例分派:裸滚轮留给轨道列表纵向滚动,修饰键才改时间窗口 */
type WheelMode = "scroll" | "pan" | "zoom";

function clampTime(timeSeconds: number, durationSeconds: number): number {
    return Math.min(Math.max(timeSeconds, TIME_START_SECONDS), durationSeconds);
}

function viewportFor(stores: DirectorDeskStores): TimelineViewport {
    return stores.motionAuthoring.timelineViewportFor(stores.timeline.document.duration);
}

function timePercent(viewport: TimelineViewport, timeSeconds: number): string {
    return `${viewport.ratioAt(timeSeconds) * PERCENT_FULL}%`;
}

function rulerTickStep(viewport: TimelineViewport): number {
    const targetStep = viewport.visibleSeconds / RULER_TARGET_TICK_COUNT;
    return (
        RULER_TICK_STEPS_SECONDS.find((step) => step >= targetStep) ?? viewport.visibleSeconds / RULER_MAX_TICK_COUNT
    );
}

function rulerDecimalPlaces(stepSeconds: number): number {
    return (
        RULER_DECIMAL_PRECISION.find((precision) => stepSeconds <= precision.maximumStep)?.places ?? TIME_START_SECONDS
    );
}

function rulerTicks(viewport: TimelineViewport): readonly number[] {
    const step = rulerTickStep(viewport);
    const first = Math.ceil(viewport.startSeconds / step) * step;
    const count = Math.floor((viewport.endSeconds - first) / step) + TIME_END_RATIO;
    return Array.from({ length: Math.max(count, TIME_END_RATIO) }, (_, index) => first + index * step);
}

/**
 * 裸滚轮不再吞掉纵向滚动:轨道一多就得能滚,而它此前被无条件当成缩放。
 * ⌘/Ctrl+滚轮缩放(触控板捏合同样报 ctrlKey),Shift+滚轮平移时间——与 NLE 惯例一致。
 */
function wheelMode(event: WheelEvent): WheelMode {
    if (event.ctrlKey || event.metaKey) return "zoom";
    return event.shiftKey ? "pan" : "scroll";
}

/** 首末刻度贴边:居中位移会把恰好落在窗口两端的刻度推出去半个字宽 */
function tickLabelTransform(viewport: TimelineViewport, timeSeconds: number): string {
    const ratio = viewport.ratioAt(timeSeconds);
    if (ratio <= TIME_START_SECONDS) return "none";
    return ratio >= TIME_END_RATIO ? "translateX(-100%)" : "translateX(-50%)";
}

function reportFailure(
    stores: DirectorDeskStores,
    result: { readonly ok: boolean; readonly error?: string; readonly issues?: readonly string[] },
): void {
    if (result.ok) return;
    stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error ?? "命令执行失败");
}

/** 播放头是帧级 observable 的唯一展开态出口，轨道网格不随播放重建。 */
const RulerPlayhead = observer(function RulerPlayhead() {
    const stores = useDirectorDeskStores();
    const duration = stores.timeline.document.duration;
    const viewport = viewportFor(stores);
    return (
        <Box
            aria-label="播放头"
            sx={{
                position: "absolute",
                top: TIME_START_SECONDS,
                bottom: TIME_START_SECONDS,
                left: timePercent(viewport, clampTime(stores.playheadDisplay.value, duration)),
                borderLeft: 2,
                borderColor: "error.main",
                zIndex: PLAYHEAD_Z_INDEX,
            }}
        />
    );
});

/** 在当前播放头为选中机位建立 Program 输出；播放头读隔离在此叶子内。 */
const ProgramCutInButton = observer(function ProgramCutInButton() {
    const stores = useDirectorDeskStores();
    const duration = stores.timeline.document.duration;
    const playhead = Math.min(stores.playheadDisplay.value, duration);
    const cameraId = stores.selection.primaryId;
    const isShotSelected = cameraId !== null && stores.camera.director.getShot(cameraId) !== undefined;
    const programRow = stores.timelineLayout
        .project(viewportFor(stores))
        .find((row) => row.kind === TIMELINE_ROW_KIND.PROGRAM);
    const nextClipStart = programRow?.bars.find((bar) => bar.startSeconds > playhead)?.startSeconds;
    const clipDuration = Math.min(PROGRAM_DEFAULT_DURATION_SECONDS, (nextClipStart ?? duration) - playhead);
    const canCutIn =
        isShotSelected &&
        !programRow?.bars.some(
            (bar) => playhead >= bar.startSeconds && playhead <= bar.startSeconds + bar.durationSeconds,
        ) &&
        clipDuration > TIME_START_SECONDS;
    const cutIn = (): void => {
        if (!canCutIn || cameraId === null) return;
        const result = stores.dispatcher.dispatch(
            {
                type: "program.set-clip",
                payload: {
                    clip: {
                        id: crypto.randomUUID(),
                        source: { kind: PROGRAM_SOURCE_KIND.STATIC_SHOT, shotId: cameraId },
                        startTimeSeconds: playhead,
                        durationSeconds: clipDuration,
                    },
                },
            },
            stores,
        );
        reportFailure(stores, result);
    };
    return (
        <Button startIcon={<VideocamIcon />} disabled={!canCutIn} onClick={cutIn}>
            切入选中机位
        </Button>
    );
});

/** 选中项在时间轴上的时段:缩放到选中据此取范围,取不到就退回全长。 */
function selectionRange(stores: DirectorDeskStores): { readonly start: number; readonly end: number } | null {
    const ownerId = stores.timelineSelection.current.ownerId;
    if (ownerId === null) return null;
    const bar = stores.timelineLayout
        .project(viewportFor(stores))
        .flatMap((row) => row.bars)
        .find((candidate) => candidate.id === ownerId);
    return bar ? { start: bar.startSeconds, end: bar.startSeconds + bar.durationSeconds } : null;
}

/** 缩放进去就出不来是此前的死角:全长与选中两个确定性出口,不依赖滚轮手感。 */
const TimelineZoomControls = observer(function TimelineZoomControls() {
    const stores = useDirectorDeskStores();
    const duration = stores.timeline.document.duration;
    const range = selectionRange(stores);
    return (
        <>
            <Tooltip title="缩放到全长">
                <IconButton
                    aria-label="缩放到全长"
                    size="small"
                    onClick={() => stores.motionAuthoring.setTimelineViewport(TimelineViewport.full(duration))}
                >
                    <FitScreenIcon fontSize="small" />
                </IconButton>
            </Tooltip>
            <Tooltip title="缩放到选中片段">
                <span>
                    <IconButton
                        aria-label="缩放到选中片段"
                        size="small"
                        disabled={range === null}
                        onClick={() => {
                            if (!range) return;
                            stores.motionAuthoring.setTimelineViewport(
                                viewportFor(stores).zoomedToRange(range.start, range.end, duration),
                            );
                        }}
                    >
                        <CenterFocusStrongIcon fontSize="small" />
                    </IconButton>
                </span>
            </Tooltip>
        </>
    );
});

/** 走位关键帧的缓动:与运镜检查器共用 EASING_LABEL,不再直出英文枚举值。 */
const WalkKeyEasingControls = observer(function WalkKeyEasingControls() {
    const stores = useDirectorDeskStores();
    const selection = stores.timelineSelection.current;
    const trackId = selection.walkTrackId;
    const keyframeId = selection.walkKeyframeId;
    const keyframe = trackId && keyframeId ? stores.timeline.document.track(trackId)?.keyframe(keyframeId) : undefined;
    if (!trackId || !keyframeId || !keyframe) return null;
    const setEasing = (easing: EasingCurve): void => {
        const result = stores.dispatcher.dispatch(
            { type: "timeline.set-key-easing", payload: { trackId, keyframeId, easing } },
            stores,
        );
        reportFailure(stores, result);
    };
    return (
        <>
            <Typography variant="caption">关键帧缓动</Typography>
            {Object.values(EASING).map((easing) => (
                <Button
                    key={easing}
                    size="small"
                    sx={{ textTransform: "none" }}
                    variant={keyframe.easing === easing ? "contained" : "outlined"}
                    onClick={() => setEasing(easing)}
                >
                    {EASING_LABEL[easing]}
                </Button>
            ))}
        </>
    );
});

const SELECTION_LABEL: Record<TimelineSelectionKind, string> = {
    [TIMELINE_SELECTION_KIND.NONE]: "",
    [TIMELINE_SELECTION_KIND.PROGRAM_CLIP]: "成片片段",
    [TIMELINE_SELECTION_KIND.MOTION_CLIP]: "运镜片段",
    [TIMELINE_SELECTION_KIND.MOTION_KEY]: "镜头关键帧",
    [TIMELINE_SELECTION_KIND.WALK_TRACK]: "走位轨迹",
    [TIMELINE_SELECTION_KIND.WALK_KEY]: "走位关键帧",
};

/** 选中项各自的附加控件:目前只有走位关键帧带缓动,表驱动以便后续逐类补齐。 */
const SELECTION_CONTROLS: Record<TimelineSelectionKind, () => ReactNode> = {
    [TIMELINE_SELECTION_KIND.NONE]: () => null,
    [TIMELINE_SELECTION_KIND.PROGRAM_CLIP]: () => null,
    [TIMELINE_SELECTION_KIND.MOTION_CLIP]: () => null,
    [TIMELINE_SELECTION_KIND.MOTION_KEY]: () => null,
    [TIMELINE_SELECTION_KIND.WALK_TRACK]: () => null,
    [TIMELINE_SELECTION_KIND.WALK_KEY]: () => <WalkKeyEasingControls />,
};

/**
 * 时间轴选中项的操作条。
 *
 * 它此前是面板的局部 state,没有任何清除路径——一旦选中过一枚帧,这条就永久挂在底部。
 * 现在它自取 TimelineSelectionStore:关闭按钮与 Esc 走同一个 clear(),删除按钮与 Delete
 * 走同一个 deleteCommand(),不存在「按钮删的和快捷键删的不是同一枚」的可能。
 */
const TimelineSelectionBar = observer(function TimelineSelectionBar() {
    const stores = useDirectorDeskStores();
    const selection: TimelineSelection = stores.timelineSelection.current;
    if (selection.isEmpty) return null;
    const deleteCommand = selection.deleteCommand();
    const remove = (): void => {
        if (!deleteCommand) return;
        reportFailure(stores, stores.dispatcher.dispatch(deleteCommand, stores));
    };
    return (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
                {SELECTION_LABEL[selection.kind]}
            </Typography>
            {SELECTION_CONTROLS[selection.kind]()}
            {deleteCommand && (
                <Button size="small" color="error" sx={{ textTransform: "none" }} onClick={remove}>
                    删除
                </Button>
            )}
            <Box sx={{ flex: 1 }} />
            <Tooltip title={`取消选中（${formatShortcutHint(SHORTCUT_ID.TIMELINE_SELECTION_CLEAR)}）`}>
                <IconButton aria-label="取消时间轴选中" size="small" onClick={() => stores.timelineSelection.clear()}>
                    <CloseIcon fontSize="small" />
                </IconButton>
            </Tooltip>
        </Stack>
    );
});

/** 运镜、Program 与 transform 轨共享 TimelineLayout 投影与可缩放可平移窗口。 */
export const TimelinePanel = observer(function TimelinePanel() {
    const stores = useDirectorDeskStores();
    const rulerRef = useRef<HTMLDivElement>(null);
    const scrollerRef = useRef<HTMLDivElement>(null);
    const duration = stores.timeline.document.duration;
    const viewport = viewportFor(stores);
    const rows = stores.timelineLayout.project(viewport);
    const dispatchCommand = (command: { readonly type: string; readonly payload: unknown }): void => {
        const result = stores.dispatcher.dispatch(command, stores);
        reportFailure(stores, result);
    };
    const scrub = useScrubGesture({
        trackRef: rulerRef,
        onScrub: (ratio) => dispatchCommand({ type: "transport.seek", payload: { time: viewport.timeAt(ratio) } }),
    });
    // 播放头跟随:窗口缩放后播放必然跑出视野。经 reaction 消费低频显示值,
    // 越界那一帧才翻页——渲染期直读会让整条轨道跟着 playhead 重建。
    useEffect(
        () =>
            reaction(
                () => stores.playheadDisplay.value,
                (timeSeconds) => {
                    const current = viewportFor(stores);
                    const next = current.followingPlayhead(timeSeconds, stores.timeline.document.duration);
                    if (next !== current) stores.motionAuthoring.setTimelineViewport(next);
                },
            ),
        [stores],
    );
    // 缩放/平移必须吃掉默认滚动:React 的 onWheel 是 passive,preventDefault 在里面是空调用,
    // 于是「⌘+滚轮缩放」会同时把轨道列表滚一段。原生非 passive 监听才拦得住。
    useEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        const onWheel = (event: WheelEvent): void => {
            const ruler = rulerRef.current;
            const mode = wheelMode(event);
            if (!ruler || mode === "scroll") return;
            event.preventDefault();
            const bounds = ruler.getBoundingClientRect();
            const current = viewportFor(stores);
            const durationSeconds = stores.timeline.document.duration;
            const anchorRatio =
                bounds.width > TIME_START_SECONDS
                    ? Math.min(
                          Math.max((event.clientX - bounds.left) / bounds.width, TIME_START_SECONDS),
                          TIME_END_RATIO,
                      )
                    : TIME_START_SECONDS;
            const nextViewport: Record<Exclude<WheelMode, "scroll">, TimelineViewport> = {
                pan: current.pannedBy(event.deltaY * current.secondsPerPixel(bounds.width), durationSeconds),
                zoom: current.zoomedAt(
                    event.deltaY > TIME_START_SECONDS ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR,
                    anchorRatio,
                    durationSeconds,
                ),
            };
            stores.motionAuthoring.setTimelineViewport(nextViewport[mode]);
        };
        scroller.addEventListener("wheel", onWheel, { passive: false });
        return () => scroller.removeEventListener("wheel", onWheel);
    }, [stores]);
    return (
        <Box aria-label="时间轴" sx={{ height: "100%", display: "flex", flexDirection: "column", p: 1 }}>
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    pb: 0.5,
                    borderBottom: 1,
                    borderColor: TRACK_BORDER_COLOR,
                }}
            >
                <Typography variant="overline">时间轴</Typography>
                <TimelineZoomControls />
                <Box sx={{ flex: 1 }} />
                <ProgramCutInButton />
            </Box>
            <Box
                ref={scrollerRef}
                sx={{ flex: 1, minHeight: TIME_START_SECONDS, overflowY: "auto", overflowX: "auto" }}
            >
                <Box sx={{ minWidth: "100%" }}>
                    <Box sx={{ display: "grid", gridTemplateColumns: `${TRACK_LABEL_WIDTH_PX}px minmax(0, 1fr)` }}>
                        <Box
                            sx={{
                                height: RULER_HEIGHT_PX,
                                bgcolor: TRACK_HEADER_BACKGROUND,
                                borderRight: 1,
                                borderColor: TRACK_BORDER_COLOR,
                            }}
                        />
                        <Box
                            ref={rulerRef}
                            role="slider"
                            aria-label="时间轴定位"
                            aria-valuemin={TIME_START_SECONDS}
                            aria-valuemax={duration}
                            {...scrub}
                            sx={{
                                position: "relative",
                                minHeight: RULER_HEIGHT_PX,
                                borderBottom: 1,
                                borderColor: TRACK_BORDER_COLOR,
                                backgroundImage: TRACK_GRID_BACKGROUND,
                                cursor: "ew-resize",
                                touchAction: "none",
                            }}
                        >
                            {rulerTicks(viewport).map((timeSeconds) => (
                                <Typography
                                    key={timeSeconds}
                                    variant="caption"
                                    sx={{
                                        position: "absolute",
                                        left: timePercent(viewport, timeSeconds),
                                        transform: tickLabelTransform(viewport, timeSeconds),
                                        color: "text.secondary",
                                        fontFamily: MONO_FONT_STACK,
                                    }}
                                >
                                    {timeSeconds.toFixed(rulerDecimalPlaces(rulerTickStep(viewport)))} 秒
                                </Typography>
                            ))}
                            <RulerPlayhead />
                        </Box>
                    </Box>
                    {rows.map((row) => (
                        <TimelineProjectedRow key={row.id} rowId={row.id} />
                    ))}
                </Box>
            </Box>
            <TimelineSelectionBar />
        </Box>
    );
});
