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
import { useState } from "react";

import { PlayheadDisplay } from "./PlayheadDisplay";
import { useDirectorDeskStores } from "./DirectorDeskContext";

const PANEL_HEIGHT_PX = 188;
const TRACK_LABEL_WIDTH_PX = 168;
const TRACK_HEIGHT_PX = 32;
const MIN_DURATION_SECONDS = 0.001;
const PROGRAM_DEFAULT_DURATION_SECONDS = 2;
const RULER_DIVISIONS = 10;
const PROGRAM_TRACK_BACKGROUND = "rgba(0, 188, 212, .14)";
const PROGRAM_CLIP_COLOR = "#00bcd4";
const MOTION_CLIP_COLOR = "#9c7ae8";
const MOTION_TRACK_BACKGROUND = "rgba(156, 122, 232, .12)";

function clampTime(time: number, duration: number): number {
    return Math.max(0, Math.min(duration, time));
}

function timePercent(time: number, duration: number): string {
    return `${(clampTime(time, duration) / duration) * 100}%`;
}

/** Camera-only sequence surface: Program cuts and camera motion clips, never scene-object keyframes. */
export const TimelinePanel = observer(function TimelinePanel() {
    const stores = useDirectorDeskStores();
    const { camera, clock, dispatcher, motion, selection, timeline } = stores;
    const [playheadDisplay] = useState(() => new PlayheadDisplay(clock));
    const [selectedProgramClipId, setSelectedProgramClipId] = useState<string | null>(null);
    const duration = timeline.duration;
    const playhead = Math.min(playheadDisplay.value, duration);
    const selectedProgramClip = selectedProgramClipId ? motion.program.clip(selectedProgramClipId) : undefined;
    const selectedCameraId = selection.primaryId;
    const selectedCamera = selectedCameraId ? camera.director.getShot(selectedCameraId) : undefined;
    const nextProgramClip = motion.program.clips.find((clip) => clip.startTimeSeconds > playhead);
    const availableProgramDuration = (nextProgramClip?.startTimeSeconds ?? duration) - playhead;
    const programDuration = Math.min(PROGRAM_DEFAULT_DURATION_SECONDS, availableProgramDuration);
    const canCreateProgramClip =
        selectedCameraId !== null && selectedCamera !== undefined && motion.program.cameraAt(playhead) === null && programDuration > 0;
    const rulerDecimalPlaces = duration % RULER_DIVISIONS === 0 ? 0 : 1;

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
        <Paper elevation={4} aria-label="镜头时间轴" sx={{ minHeight: PANEL_HEIGHT_PX, p: 1, bgcolor: "#15191a" }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <IconButton
                    size="small"
                    aria-label={clock.isPlaying ? "暂停镜头时间轴" : "播放镜头时间轴"}
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
                    aria-label="停止镜头时间轴"
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
                    aria-label="镜头播放头"
                    onChange={(_, value) =>
                        dispatcher.dispatch({ type: "transport.seek", payload: { time: value as number } }, stores)
                    }
                />
                <Button size="small" startIcon={<VideocamIcon />} disabled={!canCreateProgramClip} onClick={createProgramClip}>
                    加入 Program
                </Button>
            </Stack>
            <Divider sx={{ my: 0.5 }} />
            <Box sx={{ position: "relative", minHeight: 22, ml: `${TRACK_LABEL_WIDTH_PX}px`, borderBottom: 1, borderColor: "divider" }}>
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
                            aria-label={`${clip.cameraId} Program 片段`}
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
            {selectedProgramClip && (
                <Button
                    size="small"
                    color="error"
                    sx={{ mt: 0.5 }}
                    onClick={() => {
                        dispatcher.dispatch({ type: "program.remove-clip", payload: { id: selectedProgramClip.id } }, stores);
                        setSelectedProgramClipId(null);
                    }}
                >
                    删除 Program 片段
                </Button>
            )}
        </Paper>
    );
});
