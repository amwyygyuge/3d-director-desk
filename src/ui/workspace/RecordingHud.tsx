import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import { VIDEO_EXPORT_SOURCE } from "@/capture/VideoExportSession";
import type { VideoExportSource } from "@/capture/VideoExportSession";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { CHROME, MONO_FONT_STACK } from "@/ui/shell/theme";

const COMMAND_TYPE = {
    CANCEL: "capture.video-cancel",
    STOP: "capture.video-stop",
} as const;
const SOURCE_LABEL: Record<VideoExportSource, string> = {
    [VIDEO_EXPORT_SOURCE.PROGRAM]: "成片",
    [VIDEO_EXPORT_SOURCE.VIEWPORT]: "当前视角",
};
const HUD_GAP = 1;
const HUD_PADDING_X = 1;
const HUD_PADDING_Y = 0.75;
const PROGRESS_WIDTH_PX = 160;
const REMAINING_DECIMALS = 1;
const SECONDS_SUFFIX = "秒";
const TEXT = {
    PROGRESS: "导出进度",
    REMAINING: "剩余 ",
} as const;

/** 导出期唯一控制面；进度叶子独立订阅低频播放头，外壳不被 12Hz 数字更新牵动。 */
export const RecordingHud = observer(function RecordingHud() {
    const stores = useDirectorDeskStores();
    const { presentation, videoExport } = stores;
    if (!videoExport.isRecording || videoExport.source === null) return null;

    return (
        <Paper
            variant="pill"
            className="pointer-events-auto absolute z-30 flex items-center"
            sx={{
                gap: HUD_GAP,
                left: CHROME.edgeGapPx,
                px: HUD_PADDING_X,
                py: HUD_PADDING_Y,
                top: CHROME.edgeGapPx,
            }}
        >
            <Chip label={SOURCE_LABEL[videoExport.source]} size="small" />
            <Box sx={{ width: PROGRESS_WIDTH_PX }}>
                <RecordingProgress />
            </Box>
            <RecordingRemaining />
            <Button
                color="inherit"
                onClick={() => dispatchRecordingCommand({ stores, type: COMMAND_TYPE.STOP })}
                size="small"
            >
                {presentation.captureVideo.stopLabel}
            </Button>
            <Button
                color="error"
                onClick={() => dispatchRecordingCommand({ stores, type: COMMAND_TYPE.CANCEL })}
                size="small"
            >
                {presentation.captureVideo.discardLabel}
            </Button>
        </Paper>
    );
});

/** LinearProgress 只追踪 PlayheadDisplay 派生的导出进度，壳层与按钮保持静态。 */
const RecordingProgress = observer(function RecordingProgress() {
    const { videoExport } = useDirectorDeskStores();
    return <LinearProgress aria-label={TEXT.PROGRESS} value={videoExport.progressRatio * 100} variant="determinate" />;
});

/** 剩余秒数同样只订阅低频显示值；等宽字避免数字变化挤动控制面。 */
const RecordingRemaining = observer(function RecordingRemaining() {
    const { videoExport } = useDirectorDeskStores();
    return (
        <Typography sx={{ fontFamily: MONO_FONT_STACK, minWidth: "4.5em" }} variant="caption">
            {TEXT.REMAINING}
            {videoExport.remainingSeconds.toFixed(REMAINING_DECIMALS)}
            {SECONDS_SUFFIX}
        </Typography>
    );
});

function dispatchRecordingCommand({
    stores,
    type,
}: {
    readonly stores: DirectorDeskStores;
    readonly type: (typeof COMMAND_TYPE)[keyof typeof COMMAND_TYPE];
}): void {
    reportCommandFailure(stores, stores.dispatcher.dispatch({ type, payload: {} }, stores));
}
