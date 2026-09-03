import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RepeatIcon from "@mui/icons-material/Repeat";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useRef, useState } from "react";

import { TIMELINE_BAR_KIND, TIMELINE_MARK_KIND } from "@/authoring/TimelineLayout";
import { TimelineViewport } from "@/authoring/TimelineViewport";
import { Timecode } from "@/timeline/Timecode";
import { formatShortcutHint, SHORTCUT_ID } from "@/shortcuts/builtinShortcuts";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import {
    CHROME,
    MONO_FONT_STACK,
    SURFACE_PANEL_RADIUS_PX,
    TIMELINE_HEIGHT,
    TIMELINE_HEIGHT_VAR,
} from "@/ui/shell/theme";
import { useScrubGesture } from "@/ui/timeline/useScrubGesture";
import { TimelinePanel } from "@/ui/timeline/TimelinePanel";
import { TimelineDurationField } from "@/ui/workspace/TimelineDurationField";

/** 等宽时间码「当前 / 总长」的固定占位,防止位数变化推挤旁边的迷你轨 */
const TIMECODE_MIN_WIDTH_PX = 150;
const MINI_TRACK_HEIGHT_PX = 24;
const MINI_CLIP_HEIGHT_PX = 6;
const MINI_MOTION_CLIP_TOP_PX = 4;
const MINI_PROGRAM_CLIP_TOP_PX = 14;
const MINI_KEYFRAME_SIZE_PX = 8;
const MINI_KEYFRAME_TOP_PX = 8;
const MINI_PLAYHEAD_GLOW = "0 0 8px #ef4444";
const MINI_PLAYHEAD_WIDTH_PX = 2;
const MINI_TRACK_BORDER = "rgba(255,255,255,0.08)";
const MINI_TRACK_BACKGROUND = "rgba(0,0,0,0.4)";
const MINI_CLIP_OPACITY = 0.85;
const MINI_PERCENT_FULL = 100;
const MINI_KEYFRAME_HALF_SIZE_PX = MINI_KEYFRAME_SIZE_PX / 2;
const MINI_PILL_RADIUS_PX = 99;
/** 高度把手:通栏上缘的抓握区与其视觉握把;握把常态半隐,hover/聚焦才实体化 */
const RESIZE_HANDLE_HEIGHT_PX = 8;
const RESIZE_GRIP_WIDTH_PX = 48;
const RESIZE_GRIP_HEIGHT_PX = 3;
const RESIZE_GRIP_IDLE_OPACITY = 0.35;
/** 键盘调节步长(px):方向键逐档改高,不必精确到像素 */
const RESIZE_KEYBOARD_STEP_PX = 16;
const DESK_ROOT_SELECTOR = "[data-desk-root]";
const RESIZE_HANDLE_HINT = "上下拖动调整时间线高度（聚焦后 ↑/↓ 也可调）";
const MINI_DURATION_FALLBACK_SECONDS = 1;
const EXPANDED_OPACITY_DELAY = "100ms";
const COLLAPSED_OPACITY_DELAY = "0ms";
const TRANSPORT_BUTTON_SIZE_PX = 40;
/** 展开轨的窗口框:边框比填充更省重绘,且不遮挡下方片段色块 */
const MINI_WINDOW_BORDER = "1px solid rgba(255,255,255,0.55)";
const MINI_WINDOW_BACKGROUND = "rgba(255,255,255,0.10)";
const MINI_PLAYBACK_RANGE_BACKGROUND = "rgba(25, 118, 210, 0.22)";

const MINI_BAR_LAYER = {
    [TIMELINE_BAR_KIND.PROGRAM]: { top: MINI_PROGRAM_CLIP_TOP_PX, color: "secondary.main" },
    [TIMELINE_BAR_KIND.MOTION]: { top: MINI_MOTION_CLIP_TOP_PX, color: "primary.main" },
} as const;

type TransportCommandType = "transport.stop" | "transport.play" | "transport.pause";

function timePercent(time: number, duration: number): string {
    const safeDuration = Math.max(duration, MINI_DURATION_FALLBACK_SECONDS);
    const safeTime = Math.min(Math.max(time, 0), safeDuration);
    return `${(safeTime / safeDuration) * 100}%`;
}

/** 帧级 observable 的唯一渲染出口之一:只有这条 2px 游标随 playhead 重渲。 */
const MiniPlayhead = observer(function MiniPlayhead() {
    const { playheadDisplay, timeline } = useDirectorDeskStores();
    const duration = timeline.document.duration;
    return (
        <Box
            sx={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: timePercent(Math.min(playheadDisplay.value, duration), duration),
                width: `${MINI_PLAYHEAD_WIDTH_PX}px`,
                bgcolor: "error.main",
                boxShadow: MINI_PLAYHEAD_GLOW,
            }}
        />
    );
});

/**
 * 展开轨当前窗口在全片中的位置。
 *
 * 迷你轨此前恒按全长绘制,放大后作者完全失去方位感——「我在整片的哪一段」只能靠刻度反推。
 * 未缩放时不画:满幅的框等于噪声。
 */
const MiniViewportWindow = observer(function MiniViewportWindow() {
    const { motionAuthoring, timeline } = useDirectorDeskStores();
    const duration = timeline.document.duration;
    const viewport = motionAuthoring.timelineViewportFor(duration);
    if (viewport.visibleSeconds >= duration) return null;
    return (
        <Box
            aria-label="展开轨窗口范围"
            sx={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: timePercent(viewport.startSeconds, duration),
                width: timePercent(viewport.visibleSeconds, duration),
                border: MINI_WINDOW_BORDER,
                borderRadius: MINI_PILL_RADIUS_PX,
                bgcolor: MINI_WINDOW_BACKGROUND,
            }}
        />
    );
});

/** 帧级 observable 的另一个渲染出口:点击时间码可精确定位，解析失败保持当前时刻。 */
const TimecodeReadout = observer(function TimecodeReadout() {
    const stores = useDirectorDeskStores();
    const { playheadDisplay, timeline } = stores;
    const duration = timeline.document.duration;
    const timecode = Timecode.format(Math.min(playheadDisplay.value, duration), timeline.document.frameRate);
    const [draft, setDraft] = useState<string | null>(null);
    const commit = (raw: string): void => {
        setDraft(null);
        const parsed = Timecode.parse(raw, timeline.document.frameRate);
        if (parsed === null) return;
        const result = stores.dispatcher.dispatch({ type: "transport.seek", payload: { time: parsed } }, stores);
        reportCommandFailure(stores, result);
    };
    return (
        <Typography
            sx={{
                minWidth: TIMECODE_MIN_WIDTH_PX,
                fontFamily: MONO_FONT_STACK,
                fontWeight: 700,
                textAlign: "center",
                whiteSpace: "nowrap",
            }}
        >
            {draft === null ? (
                <Box component="span" onClick={() => setDraft(timecode)} sx={{ color: "primary.main", cursor: "text" }}>
                    {timecode}
                </Box>
            ) : (
                <InputBase
                    autoFocus
                    inputProps={{ "aria-label": "输入时间码" }}
                    onBlur={(event) => commit(event.target.value)}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") commit((event.target as HTMLInputElement).value);
                        if (event.key === "Escape") setDraft(null);
                    }}
                    sx={{ color: "primary.main", fontFamily: MONO_FONT_STACK, fontWeight: 700, width: "8ch" }}
                    value={draft}
                />
            )}
            <Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}>
                {" / "}
            </Box>
            <TimelineDurationField />
        </Typography>
    );
});

/** 总览中的淡色带是实际播放/导出范围，白框仍只表示展开轨查看窗口。 */
const MiniPlaybackRange = observer(function MiniPlaybackRange() {
    const { timeline } = useDirectorDeskStores();
    const { duration, playbackRange } = timeline.document;
    if (playbackRange.isFull(duration)) return null;
    return (
        <Box
            aria-label="播放范围"
            sx={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: timePercent(playbackRange.inSeconds, duration),
                width: timePercent(playbackRange.spanSeconds, duration),
                bgcolor: MINI_PLAYBACK_RANGE_BACKGROUND,
            }}
        />
    );
});

/**
 * 迷你指示轨:只画片段与关键帧,**不读 playhead**。
 * playhead 是帧级 observable,若在这里直读,整条轨的片段与关键帧节点会跟着重建;
 * 红色游标因此拆成独立 observer,重渲染面收敛到一个 2px 的盒子。
 * 收起态也要能定位,故本轨接管拖拽 seek;内部标记全部 pointer-events:none 不挡手势。
 */
const MiniTimeline = observer(function MiniTimeline() {
    const stores = useDirectorDeskStores();
    const { timeline } = stores;
    const duration = timeline.document.duration;
    const viewport = TimelineViewport.full(duration);
    const bars = stores.timelineLayout.bars(viewport);
    const transformMarks = stores.timelineLayout
        .project(viewport)
        .flatMap((row) => row.marks.filter((mark) => mark.kind === TIMELINE_MARK_KIND.TRANSFORM_KEY));
    const trackRef = useRef<HTMLDivElement>(null);
    const scrub = useScrubGesture({
        trackRef,
        onScrub: (ratio) => {
            const result = stores.dispatcher.dispatch(
                { type: "transport.seek", payload: { time: viewport.timeAt(ratio) } },
                stores,
            );
            reportCommandFailure(stores, result);
        },
    });
    return (
        <Box
            ref={trackRef}
            className="relative flex-1"
            role="slider"
            aria-label="时间轴定位（总览轨）"
            aria-valuemin={0}
            aria-valuemax={duration}
            {...scrub}
            sx={{
                height: MINI_TRACK_HEIGHT_PX,
                overflow: "hidden",
                border: `1px solid ${MINI_TRACK_BORDER}`,
                borderRadius: MINI_PILL_RADIUS_PX,
                bgcolor: MINI_TRACK_BACKGROUND,
                cursor: "ew-resize",
                touchAction: "none",
                "& > *": { pointerEvents: "none" },
            }}
        >
            <MiniPlaybackRange />
            {bars.map((bar) => {
                const layer = MINI_BAR_LAYER[bar.kind];
                return (
                    <Box
                        key={bar.id}
                        sx={{
                            position: "absolute",
                            top: layer.top,
                            left: `${bar.startRatio * MINI_PERCENT_FULL}%`,
                            width: `${bar.widthRatio * MINI_PERCENT_FULL}%`,
                            height: MINI_CLIP_HEIGHT_PX,
                            borderRadius: MINI_PILL_RADIUS_PX,
                            bgcolor: layer.color,
                            opacity: MINI_CLIP_OPACITY,
                        }}
                    />
                );
            })}
            {transformMarks.map((mark) => (
                <Box
                    key={`${mark.ownerId}-${mark.id}`}
                    sx={{
                        position: "absolute",
                        top: MINI_KEYFRAME_TOP_PX,
                        left: `calc(${mark.ratio * MINI_PERCENT_FULL}% - ${MINI_KEYFRAME_HALF_SIZE_PX}px)`,
                        width: MINI_KEYFRAME_SIZE_PX,
                        height: MINI_KEYFRAME_SIZE_PX,
                        transform: "rotate(45deg)",
                        bgcolor: "primary.main",
                    }}
                />
            ))}
            <MiniViewportWindow />
            <MiniPlayhead />
        </Box>
    );
});

/**
 * 时间线高度调节把手(通栏上缘)。
 *
 * 拖拽期只改导演台根节点上的 CSS 变量:侧栏、产物停靠层与本控制台都读同一个变量,
 * 因此一次变量写入即可让整套壳层几何跟手,而**不触发任何 React 重渲**——
 * 若走 store,时间轴的轨道/片段/关键帧会随每一帧指针移动重建,与画布渲染叠加。
 * 指针抬起才把落点写回 store(唯一持久真相)。
 */
const TimelineResizeHandle = observer(function TimelineResizeHandle() {
    const { layout } = useDirectorDeskStores();
    const dragRef = useRef<{
        readonly root: HTMLElement;
        readonly startY: number;
        readonly startHeight: number;
    } | null>(null);
    const heightAt = (clientY: number): number => {
        const drag = dragRef.current;
        if (!drag) return layout.timelineExpandedHeightPx;
        const raw = drag.startHeight + (drag.startY - clientY);
        return Math.min(Math.max(raw, TIMELINE_HEIGHT.MIN_PX), TIMELINE_HEIGHT.MAX_PX);
    };
    const commit = (heightPx: number): void => {
        layout.setTimelineExpandedHeightPx(heightPx);
        dragRef.current = null;
    };
    const stepBy = (deltaPx: number): void => {
        layout.setTimelineExpandedHeightPx(layout.timelineExpandedHeightPx + deltaPx);
    };
    return (
        <Tooltip title={RESIZE_HANDLE_HINT}>
            <Box
                role="separator"
                aria-orientation="horizontal"
                aria-label="拖动调整时间线高度"
                aria-valuenow={layout.timelineExpandedHeightPx}
                aria-valuemin={TIMELINE_HEIGHT.MIN_PX}
                aria-valuemax={TIMELINE_HEIGHT.MAX_PX}
                tabIndex={0}
                onPointerDown={(event) => {
                    const root = event.currentTarget.closest(DESK_ROOT_SELECTOR);
                    if (!(root instanceof HTMLElement)) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    dragRef.current = { root, startY: event.clientY, startHeight: layout.timelineExpandedHeightPx };
                }}
                onPointerMove={(event) => {
                    const drag = dragRef.current;
                    if (!drag) return;
                    drag.root.style.setProperty(TIMELINE_HEIGHT_VAR, `${heightAt(event.clientY)}px`);
                }}
                onPointerUp={(event) => {
                    if (!dragRef.current) return;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    commit(heightAt(event.clientY));
                }}
                onPointerCancel={() => commit(layout.timelineExpandedHeightPx)}
                onKeyDown={(event) => {
                    const stepByKey: Record<string, number> = {
                        ArrowUp: RESIZE_KEYBOARD_STEP_PX,
                        ArrowDown: -RESIZE_KEYBOARD_STEP_PX,
                    };
                    const step = stepByKey[event.key];
                    if (step === undefined) return;
                    event.preventDefault();
                    // 把手自己消费方向键:否则同一次按键还会被时间轴作用域当成挪播放头
                    event.stopPropagation();
                    stepBy(step);
                }}
                sx={{
                    height: RESIZE_HANDLE_HEIGHT_PX,
                    flexShrink: 0,
                    cursor: "ns-resize",
                    touchAction: "none",
                    display: "grid",
                    placeItems: "center",
                    "&:hover .timeline-resize-grip, &:focus-visible .timeline-resize-grip": { opacity: 1 },
                }}
            >
                <Box
                    className="timeline-resize-grip"
                    sx={{
                        width: RESIZE_GRIP_WIDTH_PX,
                        height: RESIZE_GRIP_HEIGHT_PX,
                        borderRadius: MINI_PILL_RADIUS_PX,
                        bgcolor: "text.secondary",
                        opacity: RESIZE_GRIP_IDLE_OPACITY,
                        transition: "opacity 120ms",
                    }}
                />
            </Box>
        </Tooltip>
    );
});

/** 方案 D 底部编排中枢:通栏停靠底边,收起是一整条迷你播放条;开合只走点击把手,不响应 hover。 */
export const TimelineConsole = observer(function TimelineConsole() {
    const stores = useDirectorDeskStores();
    const { clock, dispatcher, layout } = stores;
    const expanded = layout.timelineExpanded;
    const expandLabel = expanded ? "收起时间线" : "展开时间线";
    const expandHint = expanded ? "只留底部迷你播放条，腾出画面" : "展开轨道区，编辑片段、关键帧与标记";
    const transportCommandType = clock.isPlaying ? "transport.pause" : "transport.play";
    const transportLabel = clock.isPlaying ? "暂停时间轴" : "播放时间轴";

    const dispatchTransport = (type: TransportCommandType): void => {
        const result = dispatcher.dispatch({ type, payload: {} }, stores);
        reportCommandFailure(stores, result);
    };

    if (!layout.chromeVisible) return null;

    return (
        <Box className="pointer-events-none absolute inset-x-0 bottom-0 z-30">
            <Paper
                variant="panel"
                aria-label="时间线控制台"
                className="pointer-events-auto"
                // 指针进出即键盘归属:时间轴键位与视口飞行导航共用物理键,由此裁决谁接管
                onPointerEnter={() => layout.setTimelinePointerOver(true)}
                onPointerLeave={() => layout.setTimelinePointerOver(false)}
                sx={{
                    height: `var(${TIMELINE_HEIGHT_VAR}, ${CHROME.timelineMiniPx}px)`,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    // 停靠底边的通栏:下侧两角必须直角贴边,底边描边与屏幕边缘重复故去掉
                    borderRadius: `${SURFACE_PANEL_RADIUS_PX}px ${SURFACE_PANEL_RADIUS_PX}px 0 0`,
                    borderBottom: 0,
                }}
            >
                {expanded && <TimelineResizeHandle />}
                <Box
                    className="shrink-0 flex items-center"
                    sx={{ height: CHROME.timelineMiniPx, gap: 1, px: 1.5, bgcolor: "rgba(0,0,0,0.2)" }}
                >
                    <Tooltip title="播放头跳回播放入点（未设入点即整片起点）">
                        <IconButton aria-label="回到播放入点" onClick={() => dispatchTransport("transport.stop")}>
                            <SkipPreviousIcon />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={`${transportLabel}（${formatShortcutHint(SHORTCUT_ID.TRANSPORT_TOGGLE)}）`}>
                        <IconButton
                            aria-label={transportLabel}
                            onClick={() => dispatchTransport(transportCommandType)}
                            sx={{
                                width: TRANSPORT_BUTTON_SIZE_PX,
                                height: TRANSPORT_BUTTON_SIZE_PX,
                                bgcolor: "common.white",
                                color: "common.black",
                                "&:hover": { bgcolor: "grey.200", color: "common.black" },
                            }}
                        >
                            {clock.isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                        </IconButton>
                    </Tooltip>
                    <TimecodeReadout />
                    <Tooltip
                        title={`循环播放：放到出点后自动回入点重放（${formatShortcutHint(SHORTCUT_ID.TRANSPORT_LOOP)}）`}
                    >
                        <IconButton
                            aria-label="循环播放"
                            aria-pressed={clock.isLooping}
                            onClick={() => {
                                const result = dispatcher.dispatch(
                                    { type: "transport.set-loop", payload: { loop: !clock.isLooping } },
                                    stores,
                                );
                                reportCommandFailure(stores, result);
                            }}
                            sx={{ color: clock.isLooping ? "primary.main" : undefined }}
                        >
                            <RepeatIcon />
                        </IconButton>
                    </Tooltip>
                    <MiniTimeline />
                    <Tooltip
                        title={`${expandLabel}：${expandHint}（${formatShortcutHint(SHORTCUT_ID.TIMELINE_EXPAND_TOGGLE)}）`}
                    >
                        <IconButton
                            aria-label={expandLabel}
                            aria-expanded={expanded}
                            onClick={() => layout.toggleTimelineExpanded()}
                        >
                            {expanded ? <KeyboardArrowDownIcon /> : <KeyboardArrowUpIcon />}
                        </IconButton>
                    </Tooltip>
                </Box>
                <Box
                    className="flex-1 min-h-0 overflow-hidden"
                    sx={{
                        borderTop: 1,
                        borderColor: "divider",
                        opacity: expanded ? 1 : 0,
                        transition: "opacity 200ms",
                        transitionDelay: expanded ? EXPANDED_OPACITY_DELAY : COLLAPSED_OPACITY_DELAY,
                    }}
                >
                    {/* 收起态不挂载轨道编辑器:播放期它会随 playhead 持续重渲,不可见也要付代价 */}
                    {expanded && <TimelinePanel />}
                </Box>
            </Paper>
        </Box>
    );
});
