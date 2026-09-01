import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RepeatIcon from "@mui/icons-material/Repeat";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useRef } from "react";

import { TIMELINE_BAR_KIND, TIMELINE_MARK_KIND } from "@/authoring/TimelineLayout";
import { TimelineViewport } from "@/authoring/TimelineViewport";
import { formatShortcutHint, SHORTCUT_ID } from "@/shortcuts/builtinShortcuts";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { CHROME, MONO_FONT_STACK, SURFACE_PANEL_RADIUS_PX } from "@/ui/shell/theme";
import { useScrubGesture } from "@/ui/timeline/useScrubGesture";
import { TimelinePanel } from "@/ui/timeline/TimelinePanel";

const PREVIEW_FRAME_RATE = 30;
const SECONDS_PER_MINUTE = 60;
const TIMECODE_PART_WIDTH = 2;
const TIMECODE_ZERO = "0";
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
const MINI_DURATION_FALLBACK_SECONDS = 1;
const EXPANDED_OPACITY_DELAY = "100ms";
const COLLAPSED_OPACITY_DELAY = "0ms";
const TRANSPORT_BUTTON_SIZE_PX = 40;

const MINI_BAR_LAYER = {
    [TIMELINE_BAR_KIND.PROGRAM]: { top: MINI_PROGRAM_CLIP_TOP_PX, color: "secondary.main" },
    [TIMELINE_BAR_KIND.MOTION]: { top: MINI_MOTION_CLIP_TOP_PX, color: "primary.main" },
} as const;

type TransportCommandType = "transport.stop" | "transport.play" | "transport.pause";

function formatTimecodePart(value: number): string {
    return String(value).padStart(TIMECODE_PART_WIDTH, TIMECODE_ZERO);
}

function formatTimecode(seconds: number): string {
    const safeSeconds = Math.max(0, seconds);
    const wholeSeconds = Math.floor(safeSeconds);
    const minutes = Math.floor(wholeSeconds / SECONDS_PER_MINUTE);
    const secondsWithinMinute = wholeSeconds % SECONDS_PER_MINUTE;
    const frames = Math.floor((safeSeconds - wholeSeconds) * PREVIEW_FRAME_RATE);
    return [minutes, secondsWithinMinute, frames].map(formatTimecodePart).join(":");
}

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

/** 帧级 observable 的另一个渲染出口:等宽时间码「当前 / 总长」,位数固定不引起布局抖动。 */
const TimecodeReadout = observer(function TimecodeReadout() {
    const { playheadDisplay, timeline } = useDirectorDeskStores();
    const duration = timeline.document.duration;
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
            <Box component="span" sx={{ color: "primary.main" }}>
                {formatTimecode(Math.min(playheadDisplay.value, duration))}
            </Box>
            <Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}>
                {` / ${formatTimecode(duration)}`}
            </Box>
        </Typography>
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
            aria-label="时间轴定位"
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
            <MiniPlayhead />
        </Box>
    );
});

/** 方案 D 底部编排中枢:通栏停靠底边,收起是一整条迷你播放条;开合只走点击把手,不响应 hover。 */
export const TimelineConsole = observer(function TimelineConsole() {
    const stores = useDirectorDeskStores();
    const { clock, dispatcher, layout } = stores;
    const expanded = layout.timelineExpanded;
    const expandLabel = expanded ? "收起时间线" : "展开时间线";
    const transportCommandType = clock.isPlaying ? "transport.pause" : "transport.play";
    const transportLabel = clock.isPlaying ? "暂停时间轴" : "播放时间轴";

    const dispatchTransport = (type: TransportCommandType): void => {
        const result = dispatcher.dispatch({ type, payload: {} }, stores);
        reportCommandFailure(stores, result);
    };

    if (!layout.authoringVisible) return null;

    return (
        <Box className="pointer-events-none absolute inset-x-0 bottom-0 z-30">
            <Paper
                variant="panel"
                aria-label="时间线控制台"
                className="pointer-events-auto"
                sx={{
                    height: expanded ? CHROME.timelineExpandedPx : CHROME.timelineMiniPx,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    // 停靠底边的通栏:下侧两角必须直角贴边,底边描边与屏幕边缘重复故去掉
                    borderRadius: `${SURFACE_PANEL_RADIUS_PX}px ${SURFACE_PANEL_RADIUS_PX}px 0 0`,
                    borderBottom: 0,
                }}
            >
                <Box
                    className="shrink-0 flex items-center"
                    sx={{ height: CHROME.timelineMiniPx, gap: 1, px: 1.5, bgcolor: "rgba(0,0,0,0.2)" }}
                >
                    <Tooltip title="回到起点">
                        <IconButton aria-label="回到时间线起点" onClick={() => dispatchTransport("transport.stop")}>
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
                    <Tooltip title={`循环播放（${formatShortcutHint(SHORTCUT_ID.TRANSPORT_LOOP)}）`}>
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
                    <Tooltip title={expandLabel}>
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
