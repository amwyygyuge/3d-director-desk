import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import VideocamIcon from "@mui/icons-material/Videocam";
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

const PANEL_HEIGHT_PX = 230;
const RULER_HEIGHT_PX = 34;
const TRACK_LABEL_WIDTH_PX = 168;
const TRACK_HEIGHT_PX = 32;
const KEY_SIZE_PX = 12;
const MIN_DURATION_SECONDS = 0.001;
const KEYBOARD_TIME_STEP_SECONDS = 0.1;
const PROGRAM_DEFAULT_DURATION_SECONDS = 2;
const RULER_DIVISIONS = 10;
const PROGRAM_TRACK_BACKGROUND = "rgba(0, 188, 212, .14)";
const PROGRAM_CLIP_COLOR = "#00bcd4";
const MOTION_CLIP_COLOR = "#9c7ae8";
const MOTION_TRACK_BACKGROUND = "rgba(156, 122, 232, .12)";

type SelectedKey = { readonly trackId: string; readonly keyframeId: string };
type DragState = SelectedKey & { readonly time: number };

function clampTime(time: number, duration: number): number {
    return Math.max(0, Math.min(duration, time));
}

function timePercent(time: number, duration: number): string {
    return `${(clampTime(time, duration) / duration) * 100}%`;
}

/** Bottom timeline: Program output, camera motions, and object keys share the same playhead without sharing state. */
export const TimelinePanel = observer(function TimelinePanel() {
    const stores = useDirectorDeskStores();
    const { camera, clock, dispatcher, motion, selection, timeline } = stores;
    const [playheadDisplay] = useState(() => new PlayheadDisplay(clock));
    const [selectedKey, setSelectedKey] = useState<SelectedKey | null>(null);
    const [selectedProgramClipId, setSelectedProgramClipId] = useState<string | null>(null);
    const [dragState, setDragState] = useState<DragState | null>(null);
    const rulerRef = useRef<HTMLDivElement>(null);
    const document = timeline.document;
    const duration = document.duration;
    const rulerDecimalPlaces = duration % RULER_DIVISIONS === 0 ? 0 : 1;
    const playhead = Math.min(playheadDisplay.value, duration);
    const selectedTrack = selectedKey ? document.track(selectedKey.trackId) : undefined;
    const selectedFrame = selectedKey ? selectedTrack?.keyframe(selectedKey.keyframeId) : undefined;
    const selectedProgramClip = selectedProgramClipId ? motion.program.clip(selectedProgramClipId) : undefined;
    const selectedCameraId = selection.primaryId;
    const selectedCamera = selectedCameraId ? camera.director.getShot(selectedCameraId) : undefined;
    const nextProgramClip = motion.program.clips.find((clip) => clip.startTimeSeconds > playhead);
    const availableProgramDuration = (nextProgramClip?.startTimeSeconds ?? duration) - playhead;
    const programDuration = Math.min(PROGRAM_DEFAULT_DURATION_SECONDS, availableProgramDuration);
    const canCreateProgramClip =
        selectedCameraId !== null && selectedCamera !== undefined && motion.program.cameraAt(playhead) === null && programDuration > 0;

    const timeAtPointer = (event: PointerEvent<HTMLDivElement>): number => {
        const ruler = rulerRef.current;
        if (!ruler) return 0;
        const bounds = ruler.getBoundingClientRect();
        return clampTime(((event.clientX - bounds.left) / bounds.width) * duration, duration);
    };

    const setEasing = (easing: TimelineEasing): void => {
        if (!selectedKey) return;
        dispatcher.dispatch({ type: "timeline.set-key-easing", payload: { ...selectedKey, easing } }, stores);
    };

    const completeDrag = (event: PointerEvent<HTMLDivElement>): void => {
        if (!dragState) return;
        const time = timeAtPointer(event);
        rulerRef.current?.releasePointerCapture(event.pointerId);
        setDragState(null);
        if (time === dragState.time) return;
        dispatcher.dispatch(
            {
                type: "timeline.move-key",
                payload: { trackId: dragState.trackId, keyframeId: dragState.keyframeId, time },
            },
            stores,
        );
    };

    const moveKeyWithKeyboard = (
        event: KeyboardEvent<HTMLDivElement>,
        trackId: string,
        keyframeId: string,
        time: number,
    ): void => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelectedKey({ trackId, keyframeId });
            return;
        }
        const timeDelta =
            event.key === "ArrowLeft"
                ? -KEYBOARD_TIME_STEP_SECONDS
                : event.key === "ArrowRight"
                  ? KEYBOARD_TIME_STEP_SECONDS
                  : null;
        if (timeDelta === null) return;
        event.preventDefault();
        const nextTime = clampTime(time + timeDelta, duration);
        setSelectedKey({ trackId, keyframeId });
        if (nextTime === time) return;
        dispatcher.dispatch({ type: "timeline.move-key", payload: { trackId, keyframeId, time: nextTime } }, stores);
    };

    const createProgramClip = (): void => {
        if (!selectedCameraId || !canCreateProgramClip) return;
        dispatcher.dispatch(
            {
                type: "program.set-clip",
                payload: {
                    clip: {
                        id: crypto.randomUUID(),
                        cameraId: selectedCameraId,
                        startTimeSeconds: playhead,
                        durationSeconds: programDuration,
                    },
                },
            },
            stores,
        );
    };

    return (
        <Paper elevation={4} aria-label="时间轴" sx={{ minHeight: PANEL_HEIGHT_PX, p: 1, bgcolor: "#15191a" }}>
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
                <Typography variant="caption" sx={{ minWidth: 74, fontVariantNumeric: "tabular-nums" }}>
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
                <Button
                    size="small"
                    startIcon={<VideocamIcon />}
                    disabled={!canCreateProgramClip}
                    onClick={createProgramClip}
                >
                    切入选中机位
                </Button>
            </Stack>
            <Divider sx={{ my: 0.5 }} />
            <Box
                ref={rulerRef}
                role="presentation"
                onPointerMove={(event) => dragState && setDragState({ ...dragState, time: timeAtPointer(event) })}
                onPointerUp={completeDrag}
                onPointerCancel={() => setDragState(null)}
                sx={{ position: "relative", minHeight: RULER_HEIGHT_PX, ml: `${TRACK_LABEL_WIDTH_PX}px`, borderBottom: 1, borderColor: "divider" }}
            >
                {Array.from({ length: RULER_DIVISIONS + 1 }, (_, index) => {
                    const time = (duration * index) / RULER_DIVISIONS;
                    return (
                        <Typography
                            key={index}
                            variant="caption"
                            sx={{ position: "absolute", left: timePercent(time, duration), transform: "translateX(-50%)", color: "text.secondary" }}
                        >
                            {time.toFixed(rulerDecimalPlaces)}s
                        </Typography>
                    );
                })}
                <Box
                    aria-label="播放头"
                    sx={{ position: "absolute", top: 0, bottom: 0, left: timePercent(playhead, duration), borderLeft: 2, borderColor: "error.main", zIndex: 3 }}
                />
            </Box>
            <Box sx={{ display: "grid", gridTemplateColumns: `${TRACK_LABEL_WIDTH_PX}px 1fr`, minHeight: TRACK_HEIGHT_PX, alignItems: "center" }}>
                <Typography variant="caption" noWrap>
                    Program 输出
                </Typography>
                <Box sx={{ position: "relative", height: TRACK_HEIGHT_PX, bgcolor: PROGRAM_TRACK_BACKGROUND }}>
                    {motion.program.clips.map((clip) => (
                        <Box
                            key={clip.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`${clip.cameraId} 输出片段 ${clip.startTimeSeconds.toFixed(2)} 秒至 ${clip.endTimeSeconds.toFixed(2)} 秒`}
                            onClick={() => setSelectedProgramClipId(clip.id)}
                            sx={{
                                position: "absolute",
                                top: 3,
                                bottom: 3,
                                left: timePercent(clip.startTimeSeconds, duration),
                                width: `calc(${(clip.durationSeconds / duration) * 100}% - 2px)`,
                                px: 0.75,
                                overflow: "hidden",
                                bgcolor: PROGRAM_CLIP_COLOR,
                                color: "#082226",
                                cursor: "pointer",
                                fontSize: 11,
                                fontWeight: 700,
                                whiteSpace: "nowrap",
                            }}
                        >
                            {clip.cameraId}
                        </Box>
                    ))}
                </Box>
            </Box>
            {motion.clips.map((clip) => (
                <Box
                    key={clip.id}
                    sx={{ display: "grid", gridTemplateColumns: `${TRACK_LABEL_WIDTH_PX}px 1fr`, minHeight: TRACK_HEIGHT_PX, alignItems: "center" }}
                >
                    <Typography variant="caption" noWrap>
                        {clip.cameraId} · 运镜
                    </Typography>
                    <Box sx={{ position: "relative", height: TRACK_HEIGHT_PX, bgcolor: MOTION_TRACK_BACKGROUND }}>
                        <Box
                            sx={{
                                position: "absolute",
                                top: 7,
                                bottom: 7,
                                left: timePercent(clip.startTimeSeconds, duration),
                                width: `calc(${(clip.durationSeconds / duration) * 100}% - 2px)`,
                                border: 1,
                                borderColor: MOTION_CLIP_COLOR,
                                bgcolor: "rgba(156, 122, 232, .4)",
                            }}
                        />
                    </Box>
                </Box>
            ))}
            {document.tracks.map((track) => (
                <Box
                    key={track.id}
                    sx={{ display: "grid", gridTemplateColumns: `${TRACK_LABEL_WIDTH_PX}px 1fr`, minHeight: TRACK_HEIGHT_PX, alignItems: "center" }}
                >
                    <Typography variant="caption" noWrap>
                        {track.targetId}
                    </Typography>
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
            {(selectedFrame || selectedProgramClip) && (
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 0.5 }}>
                    {selectedFrame && selectedKey && (
                        <>
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
                                onClick={() => dispatcher.dispatch({ type: "timeline.remove-key", payload: selectedKey }, stores)}
                            >
                                删除关键帧
                            </Button>
                        </>
                    )}
                    {selectedProgramClip && (
                        <Button
                            size="small"
                            color="error"
                            onClick={() => {
                                dispatcher.dispatch({ type: "program.remove-clip", payload: { id: selectedProgramClip.id } }, stores);
                                setSelectedProgramClipId(null);
                            }}
                        >
                            删除 Program 片段
                        </Button>
                    )}
                </Stack>
            )}
        </Paper>
    );
});
