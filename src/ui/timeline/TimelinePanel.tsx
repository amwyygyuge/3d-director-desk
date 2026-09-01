import VideocamIcon from "@mui/icons-material/Videocam";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { observer } from "mobx-react-lite";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";

import type { TimelineEasing } from "../../timeline/TransformKeyframe";
import { TIMELINE_EASING } from "../../timeline/TransformKeyframe";
import { useDirectorDeskStores } from "../shell/DirectorDeskContext";
import { MONO_FONT_STACK } from "../shell/theme";
import { useScrubGesture } from "./useScrubGesture";

const RULER_HEIGHT_PX = 34;
const TRACK_LABEL_WIDTH_PX = 168;
const TRACK_HEIGHT_PX = 32;
const KEY_SIZE_PX = 12;
const KEYBOARD_TIME_STEP_SECONDS = 0.1;
const PROGRAM_DEFAULT_DURATION_SECONDS = 2;
const MIN_DURATION_SECONDS = 0.001;
const RULER_DIVISIONS = 10;
const TRACK_ACCENT_WIDTH_PX = 2;
const TRACK_BACKGROUND_ALPHA = 0.14;
const MOTION_TRACK_BACKGROUND_ALPHA = 0.12;
const MOTION_CLIP_BACKGROUND_ALPHA = 0.4;
const TRACK_HEADER_BACKGROUND = "rgba(0,0,0,0.3)";
const TRACK_GRID_BACKGROUND = "repeating-linear-gradient(90deg, transparent, transparent 19px, rgba(255,255,255,0.03) 20px)";
const TRACK_BORDER_COLOR = "divider";
const PROGRAM_TRACK_ACCENT = "primary.main";
const KEYFRAME_TRACK_ACCENT = "secondary.main";
const PLAYHEAD_Z_INDEX = 3;

type SelectedKey = { readonly trackId: string; readonly keyframeId: string };
type DragState = SelectedKey & { readonly time: number };
type TrackAccent = typeof PROGRAM_TRACK_ACCENT | typeof KEYFRAME_TRACK_ACCENT;

interface TimelineTrackRowProps {
    readonly accent: TrackAccent;
    readonly children: ReactNode;
    readonly label: string;
}

const TimelineTrackRow = observer(function TimelineTrackRow({ accent, children, label }: TimelineTrackRowProps) {
    return (
        <Box sx={{ display: "grid", gridTemplateColumns: `${TRACK_LABEL_WIDTH_PX}px minmax(0, 1fr)`, minHeight: TRACK_HEIGHT_PX }}>
            <Box sx={{ display: "flex", alignItems: "center", px: 1, bgcolor: TRACK_HEADER_BACKGROUND, borderRight: 1, borderLeft: TRACK_ACCENT_WIDTH_PX, borderColor: TRACK_BORDER_COLOR, borderLeftColor: accent }}>
                <Typography variant="caption" noWrap>
                    {label}
                </Typography>
            </Box>
            {children}
        </Box>
    );
});

function clampTime(time: number, duration: number): number {
    return Math.max(0, Math.min(duration, time));
}

function timePercent(time: number, duration: number): string {
    const safeDuration = Math.max(duration, MIN_DURATION_SECONDS);
    return `${(clampTime(time, safeDuration) / safeDuration) * 100}%`;
}

/**
 * 播放头竖线:唯一随 playhead 重渲的节点。
 * playhead 是帧级 observable(经 PlayheadDisplay 节流到 12Hz),
 * 若在 TimelinePanel 顶层直读,整张轨道网格会跟着重建——重渲染面必须收敛到这里。
 */
const RulerPlayhead = observer(function RulerPlayhead() {
    const { playheadDisplay, timeline } = useDirectorDeskStores();
    const duration = timeline.document.duration;
    return (
        <Box
            aria-label="播放头"
            sx={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: timePercent(playheadDisplay.value, duration),
                borderLeft: 2,
                borderColor: "error.main",
                zIndex: PLAYHEAD_Z_INDEX,
            }}
        />
    );
});

/**
 * 在当前 playhead 为选中机位切一段 Program 输出。
 * 可用性随 playhead 变化,故连同按钮一起隔离:面板主体不因此每 12Hz 重算一次。
 */
const ProgramCutInButton = observer(function ProgramCutInButton() {
    const stores = useDirectorDeskStores();
    const { camera, dispatcher, motion, playheadDisplay, selection, timeline, ui } = stores;
    const duration = timeline.document.duration;
    const playhead = Math.min(playheadDisplay.value, duration);
    const cameraId = selection.primaryId;
    const isShotSelected = cameraId !== null && camera.director.getShot(cameraId) !== undefined;
    const nextClipStart = motion.program.clips.find((clip) => clip.startTimeSeconds > playhead)?.startTimeSeconds;
    const clipDuration = Math.min(PROGRAM_DEFAULT_DURATION_SECONDS, (nextClipStart ?? duration) - playhead);
    const canCutIn = isShotSelected && motion.program.cameraAt(playhead) === null && clipDuration > 0;

    const cutIn = (): void => {
        if (!canCutIn || cameraId === null) return;
        const result = dispatcher.dispatch(
            {
                type: "program.set-clip",
                payload: {
                    clip: {
                        id: crypto.randomUUID(),
                        cameraId,
                        startTimeSeconds: playhead,
                        durationSeconds: clipDuration,
                    },
                },
            },
            stores,
        );
        if (!result.ok) ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
    };

    return (
        <Button startIcon={<VideocamIcon />} disabled={!canCutIn} onClick={cutIn}>
            切入选中机位
        </Button>
    );
});

/** Bottom timeline: Program output, camera motions, and object keys share the same playhead without sharing state. */
export const TimelinePanel = observer(function TimelinePanel() {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion, timeline, ui } = stores;
    const [selectedKey, setSelectedKey] = useState<SelectedKey | null>(null);
    const [selectedProgramClipId, setSelectedProgramClipId] = useState<string | null>(null);
    const [dragState, setDragState] = useState<DragState | null>(null);
    const rulerRef = useRef<HTMLDivElement>(null);
    const document = timeline.document;
    const duration = document.duration;
    const rulerDecimalPlaces = duration % RULER_DIVISIONS === 0 ? 0 : 1;
    const selectedTrack = selectedKey ? document.track(selectedKey.trackId) : undefined;
    const selectedFrame = selectedKey ? selectedTrack?.keyframe(selectedKey.keyframeId) : undefined;
    const selectedProgramClip = selectedProgramClipId ? motion.program.clip(selectedProgramClipId) : undefined;
    const dispatchCommand = (command: { readonly type: string; readonly payload: unknown }): void => {
        const result = dispatcher.dispatch(command, stores);
        if (!result.ok) ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
    };

    const timeAtPointer = (event: PointerEvent<HTMLDivElement>): number => {
        const ruler = rulerRef.current;
        if (!ruler) return 0;
        const bounds = ruler.getBoundingClientRect();
        return clampTime(((event.clientX - bounds.left) / bounds.width) * duration, duration);
    };

    const scrub = useScrubGesture({
        trackRef: rulerRef,
        onScrub: (ratio) => dispatchCommand({ type: "transport.seek", payload: { time: ratio * duration } }),
    });

    const setEasing = (easing: TimelineEasing): void => {
        if (!selectedKey) return;
        dispatchCommand({ type: "timeline.set-key-easing", payload: { ...selectedKey, easing } });
    };

    const completeDrag = (event: PointerEvent<HTMLDivElement>): void => {
        if (!dragState) return;
        const time = timeAtPointer(event);
        rulerRef.current?.releasePointerCapture(event.pointerId);
        setDragState(null);
        if (time === dragState.time) return;
        dispatchCommand({
            type: "timeline.move-key",
            payload: { trackId: dragState.trackId, keyframeId: dragState.keyframeId, time },
        });
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
        dispatchCommand({ type: "timeline.move-key", payload: { trackId, keyframeId, time: nextTime } });
    };

    return (
        <Box aria-label="时间轴" sx={{ height: "100%", display: "flex", flexDirection: "column", p: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 0.5, borderBottom: 1, borderColor: TRACK_BORDER_COLOR }}>
                <Typography variant="overline">TIMELINE</Typography>
                <ProgramCutInButton />
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "auto" }}>
                <Box sx={{ minWidth: "100%" }}>
                    <Box sx={{ display: "grid", gridTemplateColumns: `${TRACK_LABEL_WIDTH_PX}px minmax(0, 1fr)` }}>
                        <Box sx={{ height: RULER_HEIGHT_PX, bgcolor: TRACK_HEADER_BACKGROUND, borderRight: 1, borderColor: TRACK_BORDER_COLOR }} />
                        <Box
                            ref={rulerRef}
                            role="slider"
                            aria-label="时间轴定位"
                            aria-valuemin={0}
                            aria-valuemax={duration}
                            {...scrub}
                            onPointerMove={(event) => {
                                // 标尺同时是关键帧拖拽的指针捕获目标:拖帧优先,否则才是定位
                                if (dragState) {
                                    setDragState({ ...dragState, time: timeAtPointer(event) });
                                    return;
                                }
                                scrub.onPointerMove(event);
                            }}
                            onPointerUp={(event) => {
                                scrub.onPointerUp(event);
                                completeDrag(event);
                            }}
                            onPointerCancel={(event) => {
                                scrub.onPointerCancel(event);
                                setDragState(null);
                            }}
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
                            {Array.from({ length: RULER_DIVISIONS + 1 }, (_, index) => {
                                const time = (duration * index) / RULER_DIVISIONS;
                                return (
                                    <Typography
                                        key={time}
                                        variant="caption"
                                        sx={{
                                            position: "absolute",
                                            left: timePercent(time, duration),
                                            transform: "translateX(-50%)",
                                            color: "text.secondary",
                                            fontFamily: MONO_FONT_STACK,
                                        }}
                                    >
                                        {time.toFixed(rulerDecimalPlaces)}s
                                    </Typography>
                                );
                            })}
                            <RulerPlayhead />
                        </Box>
                    </Box>
                    <TimelineTrackRow accent={PROGRAM_TRACK_ACCENT} label="Program 输出">
                        <Box sx={{ position: "relative", height: TRACK_HEIGHT_PX, bgcolor: (theme) => alpha(theme.palette.secondary.main, TRACK_BACKGROUND_ALPHA) }}>
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
                                        width: `calc(${(clip.durationSeconds / Math.max(duration, MIN_DURATION_SECONDS)) * 100}% - 2px)`,
                                        px: 0.75,
                                        overflow: "hidden",
                                        bgcolor: "secondary.main",
                                        color: "common.white",
                                        cursor: "pointer",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        whiteSpace: "nowrap",
                                        fontFamily: MONO_FONT_STACK,
                                    }}
                                >
                                    {clip.cameraId} · {clip.startTimeSeconds.toFixed(rulerDecimalPlaces)}s
                                </Box>
                            ))}
                        </Box>
                    </TimelineTrackRow>
                    {motion.clips.map((clip) => (
                        <TimelineTrackRow key={clip.id} accent={PROGRAM_TRACK_ACCENT} label={`${clip.cameraId} · 运镜`}>
                            <Box sx={{ position: "relative", height: TRACK_HEIGHT_PX, bgcolor: (theme) => alpha(theme.palette.primary.main, MOTION_TRACK_BACKGROUND_ALPHA) }}>
                                <Box
                                    sx={{
                                        position: "absolute",
                                        top: 7,
                                        bottom: 7,
                                        left: timePercent(clip.startTimeSeconds, duration),
                                        width: `calc(${(clip.durationSeconds / Math.max(duration, MIN_DURATION_SECONDS)) * 100}% - 2px)`,
                                        border: 1,
                                        borderColor: "primary.main",
                                        bgcolor: (theme) => alpha(theme.palette.primary.main, MOTION_CLIP_BACKGROUND_ALPHA),
                                    }}
                                />
                            </Box>
                        </TimelineTrackRow>
                    ))}
                    {document.tracks.map((track) => (
                        <TimelineTrackRow key={track.id} accent={KEYFRAME_TRACK_ACCENT} label={track.targetId}>
                            <Box sx={{ position: "relative", height: TRACK_HEIGHT_PX, bgcolor: (theme) => alpha(theme.palette.secondary.main, TRACK_BACKGROUND_ALPHA) }}>
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
                                                left: `calc(${(transientTime / Math.max(duration, MIN_DURATION_SECONDS)) * 100}% - ${KEY_SIZE_PX / 2}px)`,
                                                width: KEY_SIZE_PX,
                                                height: KEY_SIZE_PX,
                                                transform: "rotate(45deg)",
                                                bgcolor: selectedKey?.keyframeId === keyframe.id ? "primary.main" : "secondary.main",
                                                cursor: "ew-resize",
                                            }}
                                        />
                                    );
                                })}
                            </Box>
                        </TimelineTrackRow>
                    ))}
                </Box>
            </Box>
            {(selectedFrame || selectedProgramClip) && (
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 0.5 }}>
                    {selectedFrame && selectedKey && (
                        <>
                            <Typography variant="caption">关键帧缓动</Typography>
                            {[TIMELINE_EASING.LINEAR, TIMELINE_EASING.SMOOTH].map((easing) => (
                                <Button key={easing} variant={selectedFrame.easing === easing ? "contained" : "outlined"} onClick={() => setEasing(easing)}>
                                    {easing}
                                </Button>
                            ))}
                            <Button size="small" color="error" onClick={() => dispatchCommand({ type: "timeline.remove-key", payload: selectedKey })}>
                                删除关键帧
                            </Button>
                        </>
                    )}
                    {selectedProgramClip && (
                        <Button
                            size="small"
                            color="error"
                            onClick={() => {
                                dispatchCommand({ type: "program.remove-clip", payload: { id: selectedProgramClip.id } });
                                setSelectedProgramClipId(null);
                            }}
                        >
                            删除 Program 片段
                        </Button>
                    )}
                </Stack>
            )}
        </Box>
    );
});
