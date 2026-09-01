import VideocamIcon from "@mui/icons-material/Videocam";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { type WheelEvent, useRef, useState } from "react";

import { TIMELINE_ROW_KIND } from "@/authoring/TimelineLayout";
import type { TimelineViewport } from "@/authoring/TimelineViewport";
import type { TimelineEasing } from "@/timeline/TransformKeyframe";
import { TIMELINE_EASING } from "@/timeline/TransformKeyframe";
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
const TRACK_GRID_BACKGROUND = "repeating-linear-gradient(90deg, transparent, transparent 19px, rgba(255,255,255,0.03) 20px)";
const TRACK_BORDER_COLOR = "divider";

type TransformKeySelection = { readonly trackId: string; readonly keyframeId: string };
type WheelMode = "pan" | "zoom";

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
    return RULER_TICK_STEPS_SECONDS.find((step) => step >= targetStep) ?? viewport.visibleSeconds / RULER_MAX_TICK_COUNT;
}

function rulerDecimalPlaces(stepSeconds: number): number {
    return RULER_DECIMAL_PRECISION.find((precision) => stepSeconds <= precision.maximumStep)?.places ?? TIME_START_SECONDS;
}

function rulerTicks(viewport: TimelineViewport): readonly number[] {
    const step = rulerTickStep(viewport);
    const first = Math.ceil(viewport.startSeconds / step) * step;
    const count = Math.floor((viewport.endSeconds - first) / step) + TIME_END_RATIO;
    return Array.from({ length: Math.max(count, TIME_END_RATIO) }, (_, index) => first + index * step);
}

function wheelMode(event: WheelEvent<HTMLDivElement>): WheelMode {
    return event.shiftKey ? "pan" : "zoom";
}

function reportFailure(stores: DirectorDeskStores, result: { readonly ok: boolean; readonly error?: string; readonly issues?: readonly string[] }): void {
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
    const programRow = stores.timelineLayout.project(viewportFor(stores)).find((row) => row.kind === TIMELINE_ROW_KIND.PROGRAM);
    const nextClipStart = programRow?.bars.find((bar) => bar.startSeconds > playhead)?.startSeconds;
    const clipDuration = Math.min(PROGRAM_DEFAULT_DURATION_SECONDS, (nextClipStart ?? duration) - playhead);
    const canCutIn = isShotSelected && !programRow?.bars.some((bar) => playhead >= bar.startSeconds && playhead <= bar.startSeconds + bar.durationSeconds) && clipDuration > TIME_START_SECONDS;
    const cutIn = (): void => {
        if (!canCutIn || cameraId === null) return;
        const result = stores.dispatcher.dispatch(
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
        reportFailure(stores, result);
    };
    return <Button startIcon={<VideocamIcon />} disabled={!canCutIn} onClick={cutIn}>切入选中机位</Button>;
});

/** 运镜、Program 与 transform 轨共享 TimelineLayout 投影与可缩放可平移窗口。 */
export const TimelinePanel = observer(function TimelinePanel() {
    const stores = useDirectorDeskStores();
    const [selectedTransformKey, setSelectedTransformKey] = useState<TransformKeySelection | null>(null);
    const [selectedProgramClipId, setSelectedProgramClipId] = useState<string | null>(null);
    const rulerRef = useRef<HTMLDivElement>(null);
    const duration = stores.timeline.document.duration;
    const viewport = viewportFor(stores);
    const rows = stores.timelineLayout.project(viewport);
    const selectedTrack = selectedTransformKey ? stores.timeline.document.track(selectedTransformKey.trackId) : undefined;
    const selectedFrame = selectedTransformKey ? selectedTrack?.keyframe(selectedTransformKey.keyframeId) : undefined;
    const selectedProgramClip = selectedProgramClipId ? stores.motion.program.clip(selectedProgramClipId) : undefined;
    const dispatchCommand = (command: { readonly type: string; readonly payload: unknown }): void => {
        const result = stores.dispatcher.dispatch(command, stores);
        reportFailure(stores, result);
    };
    const scrub = useScrubGesture({
        trackRef: rulerRef,
        onScrub: (ratio) => dispatchCommand({ type: "transport.seek", payload: { time: viewport.timeAt(ratio) } }),
    });
    const setEasing = (easing: TimelineEasing): void => {
        if (!selectedTransformKey) return;
        dispatchCommand({ type: "timeline.set-key-easing", payload: { ...selectedTransformKey, easing } });
    };
    const applyWheel = (event: WheelEvent<HTMLDivElement>): void => {
        const ruler = rulerRef.current;
        if (!ruler) return;
        event.preventDefault();
        const bounds = ruler.getBoundingClientRect();
        const anchorRatio = bounds.width > TIME_START_SECONDS ? Math.min(Math.max((event.clientX - bounds.left) / bounds.width, TIME_START_SECONDS), TIME_END_RATIO) : TIME_START_SECONDS;
        const mode = wheelMode(event);
        const nextViewport: Record<WheelMode, TimelineViewport> = {
            pan: viewport.pannedBy(event.deltaY * viewport.secondsPerPixel(bounds.width), duration),
            zoom: viewport.zoomedAt(event.deltaY > TIME_START_SECONDS ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR, anchorRatio, duration),
        };
        stores.motionAuthoring.setTimelineViewport(nextViewport[mode]);
    };
    return (
        <Box aria-label="时间轴" sx={{ height: "100%", display: "flex", flexDirection: "column", p: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 0.5, borderBottom: 1, borderColor: TRACK_BORDER_COLOR }}>
                <Typography variant="overline">TIMELINE</Typography>
                <ProgramCutInButton />
            </Box>
            <Box onWheel={applyWheel} sx={{ flex: 1, minHeight: TIME_START_SECONDS, overflowY: "auto", overflowX: "auto" }}>
                <Box sx={{ minWidth: "100%" }}>
                    <Box sx={{ display: "grid", gridTemplateColumns: `${TRACK_LABEL_WIDTH_PX}px minmax(0, 1fr)` }}>
                        <Box sx={{ height: RULER_HEIGHT_PX, bgcolor: TRACK_HEADER_BACKGROUND, borderRight: 1, borderColor: TRACK_BORDER_COLOR }} />
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
                                        transform: "translateX(-50%)",
                                        color: "text.secondary",
                                        fontFamily: MONO_FONT_STACK,
                                    }}
                                >
                                    {timeSeconds.toFixed(rulerDecimalPlaces(rulerTickStep(viewport)))}s
                                </Typography>
                            ))}
                            <RulerPlayhead />
                        </Box>
                    </Box>
                    {rows.map((row) => (
                        <TimelineProjectedRow
                            key={row.id}
                            rowId={row.id}
                            onSelectTransformKey={setSelectedTransformKey}
                            onSelectProgramClip={setSelectedProgramClipId}
                        />
                    ))}
                </Box>
            </Box>
            {(selectedFrame || selectedProgramClip) && (
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 0.5 }}>
                    {selectedFrame && selectedTransformKey && (
                        <>
                            <Typography variant="caption">关键帧缓动</Typography>
                            {[TIMELINE_EASING.LINEAR, TIMELINE_EASING.SMOOTH].map((easing) => (
                                <Button key={easing} variant={selectedFrame.easing === easing ? "contained" : "outlined"} onClick={() => setEasing(easing)}>
                                    {easing}
                                </Button>
                            ))}
                            <Button size="small" color="error" onClick={() => dispatchCommand({ type: "timeline.remove-key", payload: selectedTransformKey })}>
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
