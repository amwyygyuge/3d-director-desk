import FileDownloadIcon from "@mui/icons-material/FileDownload";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import { VIDEO_EXPORT_SOURCE } from "@/capture/VideoExportSession";
import type { VideoExportSource } from "@/capture/VideoExportSession";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { CHROME } from "@/ui/shell/theme";

const CAPTURE_PREVIEW_WIDTH_PX = 160;
const CARD_GAP = 0.5;
const DOCK_GAP = 1;
const DOWNLOAD_FILENAME = "director-desk-preview.webm";
const SOURCE_LABEL: Record<VideoExportSource, string> = {
    [VIDEO_EXPORT_SOURCE.PROGRAM]: "成片",
    [VIDEO_EXPORT_SOURCE.VIEWPORT]: "当前视角",
};
const TEXT = {
    DOWNLOAD_VIDEO: "下载录制视频",
    OPEN_IMAGE: "最近截图(点击打开)",
    VIDEO_PREFIX: "最近视频",
} as const;
const VIDEO_DURATION_DECIMALS = 1;

/** 截图与视频产物共用同一停靠层，避免时间线让位规则在两类产物间漂移。 */
export const CaptureProductDock = observer(function CaptureProductDock() {
    const { layout, ui } = useDirectorDeskStores();
    const captureUrl = ui.lastCaptureUrl;
    const captureMeta = ui.lastCaptureMeta;
    const videoUrl = ui.lastVideoUrl;
    const videoMeta = ui.lastVideoMeta;
    if ((!captureUrl || !captureMeta) && (!videoUrl || !videoMeta)) return null;

    return (
        <Box
            sx={{
                bottom:
                    (layout.timelineExpanded ? CHROME.timelineExpandedPx : CHROME.timelineMiniPx) + CHROME.edgeGapPx,
                display: "grid",
                gap: DOCK_GAP,
                position: "absolute",
                right: CHROME.edgeGapPx,
                zIndex: 1,
            }}
        >
            {captureUrl && captureMeta ? (
                <ImageProductCard height={captureMeta.height} url={captureUrl} width={captureMeta.width} />
            ) : null}
            {videoUrl && videoMeta ? (
                <VideoProductCard
                    durationSeconds={videoMeta.durationSeconds}
                    height={videoMeta.height}
                    source={videoMeta.source}
                    url={videoUrl}
                    width={videoMeta.width}
                />
            ) : null}
        </Box>
    );
});

/** 无领域身份的展示叶子只接收产物值，避免停靠层为各类产物复制几何。 */
const ImageProductCard = observer(function ImageProductCard({
    height,
    url,
    width,
}: {
    readonly height: number;
    readonly url: string;
    readonly width: number;
}) {
    return (
        <Paper component="a" href={url} rel="noreferrer" target="_blank" variant="panel" sx={{ display: "block", p: CARD_GAP }}>
            <img
                alt="最近截图"
                height={height}
                src={url}
                style={{ borderRadius: CARD_GAP, display: "block", height: "auto", width: CAPTURE_PREVIEW_WIDTH_PX }}
                width={width}
            />
            <Typography color="text.secondary" sx={{ display: "block", textAlign: "center" }} variant="caption">
                {TEXT.OPEN_IMAGE}
            </Typography>
        </Paper>
    );
});

/** 无领域身份的展示叶子保留 video 原生控制，blob 产物可直接预览、播放与下载。 */
const VideoProductCard = observer(function VideoProductCard({
    durationSeconds,
    height,
    source,
    url,
    width,
}: {
    readonly durationSeconds: number;
    readonly height: number;
    readonly source: VideoExportSource;
    readonly url: string;
    readonly width: number;
}) {
    return (
        <Paper variant="panel" sx={{ p: CARD_GAP }}>
            <video
                controls
                height={height}
                muted
                playsInline
                src={url}
                style={{ borderRadius: CARD_GAP, display: "block", height: "auto", width: CAPTURE_PREVIEW_WIDTH_PX }}
                width={width}
            />
            <Box sx={{ alignItems: "center", display: "flex", gap: CARD_GAP, justifyContent: "space-between" }}>
                <Typography color="text.secondary" variant="caption">
                    {TEXT.VIDEO_PREFIX} · {SOURCE_LABEL[source]} · {durationSeconds.toFixed(VIDEO_DURATION_DECIMALS)}秒
                </Typography>
                <Tooltip title={TEXT.DOWNLOAD_VIDEO}>
                    <IconButton aria-label={TEXT.DOWNLOAD_VIDEO} download={DOWNLOAD_FILENAME} href={url} size="small">
                        <FileDownloadIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Box>
        </Paper>
    );
});
