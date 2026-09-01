import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useRef } from "react";

import type { CommandResult } from "@/command/DirectorCommand";
import { formatShortcutHint, SHORTCUT_ID } from "@/shortcuts/builtinShortcuts";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { CHROME, MONO_FONT_STACK } from "@/ui/shell/theme";
import { useScrubGesture } from "@/ui/timeline/useScrubGesture";
import { TimelinePanel } from "@/ui/timeline/TimelinePanel";
import { useHoverIntent } from "@/ui/workspace/useHoverIntent";

const PREVIEW_FRAME_RATE = 30;
const SECONDS_PER_MINUTE = 60;
const TIMECODE_PART_WIDTH = 2;
const TIMECODE_ZERO = "0";
/** 等宽时间码 mm:ss:ff 的固定占位,防止位数变化推挤旁边的迷你轨 */
const TIMECODE_MIN_WIDTH_PX = 82;
const HOVER_OPEN_DELAY_MS = 200;
const HOVER_CLOSE_DELAY_MS = 400;
const MINI_TRACK_HEIGHT_PX = 24;
const MINI_CLIP_HEIGHT_PX = 6;
const MINI_CLIP_TOP_PX = 9;
const MINI_KEYFRAME_SIZE_PX = 8;
const MINI_KEYFRAME_TOP_PX = 8;
const MINI_PLAYHEAD_GLOW = "0 0 8px #ef4444";
const MINI_PLAYHEAD_WIDTH_PX = 2;
const MINI_TRACK_BORDER = "rgba(255,255,255,0.08)";
const MINI_TRACK_BACKGROUND = "rgba(0,0,0,0.4)";
/** 左右让位量:悬浮岛不与左栏图标条、右侧检查器争同一段像素 */
const RAIL_CLEARANCE_PX = CHROME.edgeGapPx * 2 + CHROME.railCollapsedPx;
const INSPECTOR_CLEARANCE_PX = CHROME.edgeGapPx * 2 + CHROME.inspectorWidthPx;
const MINI_CLIP_OPACITY = 0.5;
const MINI_DURATION_FALLBACK_SECONDS = 1;
const EXPANDED_OPACITY_DELAY = "100ms";
const COLLAPSED_OPACITY_DELAY = "0ms";

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

function reportCommandFailure({ result, setNotice }: { readonly result: CommandResult; readonly setNotice: (message: string) => void }): void {
    if (!result.ok) setNotice(result.issues?.join(";") ?? result.error);
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

/** 帧级 observable 的另一个渲染出口:等宽时间码,位数固定不引起布局抖动。 */
const TimecodeReadout = observer(function TimecodeReadout() {
    const { playheadDisplay, timeline } = useDirectorDeskStores();
    const duration = timeline.document.duration;
    return (
        <Typography
            sx={{
                minWidth: TIMECODE_MIN_WIDTH_PX,
                color: "primary.main",
                fontFamily: MONO_FONT_STACK,
                fontWeight: 700,
                textAlign: "center",
            }}
        >
            {formatTimecode(Math.min(playheadDisplay.value, duration))}
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
    const { motion, timeline, ui } = stores;
    const duration = timeline.document.duration;
    const programClips = motion.program.clips;
    const tracks = timeline.document.tracks;
    const trackRef = useRef<HTMLDivElement>(null);
    const scrub = useScrubGesture({
        trackRef,
        onScrub: (ratio) => {
            const result = stores.dispatcher.dispatch(
                { type: "transport.seek", payload: { time: ratio * duration } },
                stores,
            );
            reportCommandFailure({ result, setNotice: (message) => ui.setApplicationNotice(message) });
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
                borderRadius: 1,
                bgcolor: MINI_TRACK_BACKGROUND,
                cursor: "ew-resize",
                touchAction: "none",
                "& > *": { pointerEvents: "none" },
            }}
        >
            {programClips.map((clip) => (
                <Box
                    key={clip.id}
                    sx={{
                        position: "absolute",
                        top: MINI_CLIP_TOP_PX,
                        left: timePercent(clip.startTimeSeconds, duration),
                        width: `${(clip.durationSeconds / Math.max(duration, MINI_DURATION_FALLBACK_SECONDS)) * 100}%`,
                        height: MINI_CLIP_HEIGHT_PX,
                        borderRadius: 99,
                        bgcolor: "secondary.main",
                        opacity: MINI_CLIP_OPACITY,
                    }}
                />
            ))}
            {tracks.flatMap((track) =>
                track.keyframes.map((keyframe) => (
                    <Box
                        key={`${track.id}-${keyframe.id}`}
                        sx={{
                            position: "absolute",
                            top: MINI_KEYFRAME_TOP_PX,
                            left: `calc(${timePercent(keyframe.time, duration)} - ${MINI_KEYFRAME_SIZE_PX / 2}px)`,
                            width: MINI_KEYFRAME_SIZE_PX,
                            height: MINI_KEYFRAME_SIZE_PX,
                            transform: "rotate(45deg)",
                            bgcolor: "primary.main",
                        }}
                    />
                )),
            )}
            <MiniPlayhead />
        </Box>
    );
});

/** 方案 D 底部编排中枢:默认只保留低遮挡的迷你播放条。 */
export const TimelineConsole = observer(function TimelineConsole() {
    const stores = useDirectorDeskStores();
    const { clock, dispatcher, layout, selection, ui } = stores;
    const { active: hoverIntent, handlers } = useHoverIntent({
        openDelayMs: HOVER_OPEN_DELAY_MS,
        closeDelayMs: HOVER_CLOSE_DELAY_MS,
    });
    const expanded = layout.timelinePinned || hoverIntent;
    const transportCommandType = clock.isPlaying ? "transport.pause" : "transport.play";
    const transportLabel = clock.isPlaying ? "暂停时间轴" : "播放时间轴";

    const dispatchTransport = (type: TransportCommandType): void => {
        const result = dispatcher.dispatch({ type, payload: {} }, stores);
        reportCommandFailure({ result, setNotice: (message) => ui.setApplicationNotice(message) });
    };

    if (!layout.authoringVisible) return null;

    // 悬浮岛在左栏与检查器之间居中:检查器出现时整条左移,避免两块玻璃互相压盖
    return (
        <Box
            className="pointer-events-none absolute bottom-[16px] left-0 right-0 z-30 flex justify-center"
            sx={{
                pl: `${RAIL_CLEARANCE_PX}px`,
                pr: `${selection.primaryId === null ? CHROME.edgeGapPx : INSPECTOR_CLEARANCE_PX}px`,
            }}
        >
            <Paper
                variant="panel"
                aria-label="时间线控制台"
                className="pointer-events-auto w-4/5 max-w-5xl"
                {...handlers}
                sx={{
                    height: expanded ? CHROME.timelineExpandedPx : CHROME.timelineMiniPx,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}
            >
            <Box className="shrink-0 flex items-center" sx={{ height: CHROME.timelineMiniPx, gap: 1, px: 1.5, bgcolor: "rgba(0,0,0,0.2)" }}>
                <Tooltip title="回到起点">
                    <IconButton aria-label="回到时间线起点" onClick={() => dispatchTransport("transport.stop")}>
                        <SkipPreviousIcon />
                    </IconButton>
                </Tooltip>
                <Tooltip title={`${transportLabel}（${formatShortcutHint(SHORTCUT_ID.TRANSPORT_TOGGLE)}）`}>
                    <IconButton
                        aria-label={transportLabel}
                        onClick={() => dispatchTransport(transportCommandType)}
                        sx={{ width: 40, height: 40, bgcolor: "common.white", color: "common.black", "&:hover": { bgcolor: "grey.200", color: "common.black" } }}
                    >
                        {clock.isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                    </IconButton>
                </Tooltip>
                <TimecodeReadout />
                <MiniTimeline />
                <Tooltip title={layout.timelinePinned ? "取消钉住时间线" : "钉住展开时间线"}>
                    <IconButton
                        aria-label={layout.timelinePinned ? "取消钉住展开时间线" : "钉住展开时间线"}
                        onClick={() => layout.toggleTimelinePin()}
                    >
                        {layout.timelinePinned ? <KeyboardArrowDownIcon /> : <KeyboardArrowUpIcon />}
                    </IconButton>
                </Tooltip>
            </Box>
            <Box
                className="flex-1 min-h-0 overflow-hidden"
                sx={{ borderTop: 1, borderColor: "divider", opacity: expanded ? 1 : 0, transition: "opacity 200ms", transitionDelay: expanded ? EXPANDED_OPACITY_DELAY : COLLAPSED_OPACITY_DELAY }}
            >
                {/* 收起态不挂载轨道编辑器:播放期它会随 playhead 持续重渲,不可见也要付代价 */}
                {expanded && <TimelinePanel />}
            </Box>
            </Paper>
        </Box>
    );
});
