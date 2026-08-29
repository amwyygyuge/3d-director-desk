import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";

import type { TimelineEasing } from "../timeline/TransformKeyframe";
import { TIMELINE_EASING } from "../timeline/TransformKeyframe";
import { PlayheadDisplay } from "./PlayheadDisplay";
import { useDirectorDeskStores } from "./DirectorDeskContext";

const PANEL_INSET_PX = 12;
const PANEL_HEIGHT_PX = 190;
const RULER_HEIGHT_PX = 34;
const TRACK_LABEL_WIDTH_PX = 140;
const TRACK_HEIGHT_PX = 32;
const KEY_SIZE_PX = 12;
const MIN_DURATION_SECONDS = 0.001;
const KEYBOARD_TIME_STEP_SECONDS = 0.1;

type SelectedKey = { readonly trackId: string; readonly keyframeId: string };
type DragState = SelectedKey & { readonly time: number };

function clampTime(time: number, duration: number): number {
    return Math.max(0, Math.min(duration, time));
}

/** 底部时间轴：持续状态经 dispatcher 提交；拖拽仅保留局部瞬态时间，松手才创建一条历史记录。 */
export const TimelinePanel = observer(function TimelinePanel() {
    const stores = useDirectorDeskStores();
    const { clock, dispatcher, timeline } = stores;
    const [playheadDisplay] = useState(() => new PlayheadDisplay(clock));
    const [selectedKey, setSelectedKey] = useState<SelectedKey | null>(null);
    const [dragState, setDragState] = useState<DragState | null>(null);
    const rulerRef = useRef<HTMLDivElement>(null);
    const document = timeline.document;
    const duration = document.duration;
    const playhead = Math.min(playheadDisplay.value, duration);
    const selectedTrack = selectedKey ? document.track(selectedKey.trackId) : undefined;
    const selectedFrame = selectedKey ? selectedTrack?.keyframe(selectedKey.keyframeId) : undefined;

    const timeAtPointer = (event: PointerEvent<HTMLDivElement>): number => {
        const ruler = rulerRef.current;
        if (!ruler) return 0;
        const bounds = ruler.getBoundingClientRect();
        return clampTime(((event.clientX - bounds.left) / bounds.width) * duration, duration);
    };

    const setEasing = (easing: TimelineEasing): void => {
        if (!selectedKey) return;
        const track = document.track(selectedKey.trackId);
        if (!track) return;
        dispatcher.dispatch(
            {
                type: track.kind === "pose" ? "pose.set-key-easing" : "timeline.set-key-easing",
                payload: { ...selectedKey, easing },
            },
            stores,
        );
    };

    const completeDrag = (event: PointerEvent<HTMLDivElement>): void => {
        if (!dragState) return;
        const time = timeAtPointer(event);
        rulerRef.current?.releasePointerCapture(event.pointerId);
        setDragState(null);
        if (time === dragState.time) return;
        const track = document.track(dragState.trackId);
        if (!track) return;
        dispatcher.dispatch(
            {
                type: track.kind === "pose" ? "pose.move-key" : "timeline.move-key",
                payload: { trackId: dragState.trackId, keyframeId: dragState.keyframeId, time },
            },
            stores,
        );
    };

    const moveKeyWithKeyboard = (event: KeyboardEvent<HTMLDivElement>, trackId: string, keyframeId: string, time: number): void => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelectedKey({ trackId, keyframeId });
            return;
        }
        const timeDelta = event.key === "ArrowLeft"
            ? -KEYBOARD_TIME_STEP_SECONDS
            : event.key === "ArrowRight"
                ? KEYBOARD_TIME_STEP_SECONDS
                : null;
        if (timeDelta === null) return;
        event.preventDefault();
        const nextTime = clampTime(time + timeDelta, duration);
        setSelectedKey({ trackId, keyframeId });
        if (nextTime === time) return;
        const track = document.track(trackId);
        if (!track) return;
        dispatcher.dispatch(
            { type: track.kind === "pose" ? "pose.move-key" : "timeline.move-key", payload: { trackId, keyframeId, time: nextTime } },
            stores,
        );
    };

    return (
        <Paper
            elevation={4}
            aria-label="时间轴"
            sx={{
                position: "absolute",
                right: PANEL_INSET_PX,
                bottom: PANEL_INSET_PX,
                left: PANEL_INSET_PX,
                minHeight: PANEL_HEIGHT_PX,
                p: 1,
                zIndex: 1,
            }}
        >
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <IconButton
                    size="small"
                    aria-label={clock.isPlaying ? "暂停时间轴" : "播放时间轴"}
                    onClick={() =>
                        dispatcher.dispatch(
                            { type: clock.isPlaying ? "transport.pause" : "transport.play", payload: {} },
                            stores,
                        )
                    }
                >
                    {clock.isPlaying ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
                </IconButton>
                <IconButton
                    size="small"
                    aria-label="停止时间轴"
                    onClick={() => dispatcher.dispatch({ type: "transport.stop", payload: {} }, stores)}
                >
                    <StopIcon fontSize="small" />
                </IconButton>
                <Typography variant="caption" sx={{ minWidth: 74 }}>
                    {playhead.toFixed(2)}s / {duration.toFixed(2)}s
                </Typography>
                <Slider
                    size="small"
                    min={0}
                    max={Math.max(duration, MIN_DURATION_SECONDS)}
                    step={0.01}
                    value={playhead}
                    aria-label="时间轴播放头"
                    onChange={(_, value) =>
                        dispatcher.dispatch({ type: "transport.seek", payload: { time: value as number } }, stores)
                    }
                />
            </Stack>
            <Divider sx={{ my: 0.5 }} />
            <Box
                ref={rulerRef}
                role="presentation"
                onPointerMove={(event) => dragState && setDragState({ ...dragState, time: timeAtPointer(event) })}
                onPointerUp={completeDrag}
                onPointerCancel={() => setDragState(null)}
                sx={{
                    position: "relative",
                    minHeight: RULER_HEIGHT_PX,
                    ml: `${TRACK_LABEL_WIDTH_PX}px`,
                    borderBottom: 1,
                    borderColor: "divider",
                }}
            >
                <Box
                    aria-label="时间轴标尺"
                    sx={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(90deg, transparent 99%, rgba(255,255,255,.15) 100%)", backgroundSize: "10% 100%" }}
                />
                <Box
                    aria-label="播放头"
                    sx={{ position: "absolute", top: 0, bottom: 0, left: `${(playhead / duration) * 100}%`, borderLeft: 2, borderColor: "error.main" }}
                />
            </Box>
            {document.tracks.map((track) => (
                <Box key={track.id} sx={{ display: "grid", gridTemplateColumns: `${TRACK_LABEL_WIDTH_PX}px 1fr`, minHeight: TRACK_HEIGHT_PX, alignItems: "center" }}>
                    <Typography variant="caption" noWrap>{track.targetId}</Typography>
                    <Box sx={{ position: "relative", height: TRACK_HEIGHT_PX }}>
                        {track.keyframes.map((keyframe) => {
                            const transientTime = dragState?.keyframeId === keyframe.id ? dragState.time : keyframe.time;
                            return (
                                <Box
                                    key={keyframe.id}
                                    role="button"
                                    tabIndex={0}
                                    aria-keyshortcuts="ArrowLeft ArrowRight Enter Space"
                                    aria-label={`关键帧 ${keyframe.time.toFixed(2)} 秒`}
                                    onFocus={() => setSelectedKey({ trackId: track.id, keyframeId: keyframe.id })}
                                    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) =>
                                        moveKeyWithKeyboard(event, track.id, keyframe.id, keyframe.time)
                                    }
                                    onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
                                        event.stopPropagation();
                                        rulerRef.current?.setPointerCapture(event.pointerId);
                                        setSelectedKey({ trackId: track.id, keyframeId: keyframe.id });
                                        setDragState({ trackId: track.id, keyframeId: keyframe.id, time: keyframe.time });
                                    }}
                                    sx={{
                                        position: "absolute",
                                        top: (TRACK_HEIGHT_PX - KEY_SIZE_PX) / 2,
                                        left: `calc(${(transientTime / duration) * 100}% - ${KEY_SIZE_PX / 2}px)`,
                                        width: KEY_SIZE_PX,
                                        height: KEY_SIZE_PX,
                                        transform: "rotate(45deg)",
                                        bgcolor: selectedKey?.keyframeId === keyframe.id ? "primary.main" : "text.secondary",
                                        cursor: "ew-resize",
                                    }}
                                />
                            );
                        })}
                    </Box>
                </Box>
            ))}
            {selectedFrame && selectedKey && (
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 0.5 }}>
                    <Typography variant="caption">关键帧缓动</Typography>
                    {[TIMELINE_EASING.LINEAR, TIMELINE_EASING.SMOOTH].map((easing) => (
                        <Button
                            key={easing}
                            size="small"
                            variant={selectedFrame.easing === easing ? "contained" : "outlined"}
                            onClick={() => setEasing(easing)}
                        >
                            {easing}
                        </Button>
                    ))}
                    <Button
                        size="small"
                        color="error"
                        onClick={() =>
                            dispatcher.dispatch(
                                { type: selectedTrack?.kind === "pose" ? "pose.remove-key" : "timeline.remove-key", payload: selectedKey },
                                stores,
                            )
                        }
                    >
                        删除关键帧
                    </Button>
                </Stack>
            )}
        </Paper>
    );
});
