import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";

import { VIDEO_EXPORT_SOURCE } from "@/capture/VideoExportSession";
import type { VideoExportSource } from "@/capture/VideoExportSession";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { captureDockRightOffsetPx, sidePanelBottomOffset } from "@/ui/shell/theme";
import { resolveInspectorTarget } from "@/ui/workspace/InspectorSheet";

const CAPTURE_PREVIEW_WIDTH_PX = 160;
const CARD_GAP = 0.5;
const DOCK_GAP = 1;
const MEDIA_STYLE = {
    borderRadius: CARD_GAP,
    display: "block",
    height: "auto",
    width: CAPTURE_PREVIEW_WIDTH_PX,
} as const;
const SOURCE_LABEL: Record<VideoExportSource, string> = {
    [VIDEO_EXPORT_SOURCE.PROGRAM]: "成片",
    [VIDEO_EXPORT_SOURCE.VIEWPORT]: "当前视角",
};
const TEXT = {
    OPEN_IMAGE: "最近截图(点击打开)",
    OPEN_VIDEO: "最近视频(点击打开)",
} as const;
const VIDEO_DURATION_DECIMALS = 1;

/** 截图与视频产物共用同一停靠层，避免时间线/检查器让位规则在两类产物间漂移。 */
export const CaptureProductDock = observer(function CaptureProductDock() {
    const stores = useDirectorDeskStores();
    const { ui } = stores;
    const captureUrl = ui.lastCaptureUrl;
    const captureMeta = ui.lastCaptureMeta;
    const videoUrl = ui.lastVideoUrl;
    const videoMeta = ui.lastVideoMeta;
    // 检查器在场时让开整栏:停靠层 z 序低于检查器,不让位会被完全遮挡
    const inspectorVisible = resolveInspectorTarget(stores) !== null;
    if ((!captureUrl || !captureMeta) && (!videoUrl || !videoMeta)) return null;

    return (
        <Box
            sx={{
                bottom: sidePanelBottomOffset(),
                display: "grid",
                gap: DOCK_GAP,
                position: "absolute",
                right: captureDockRightOffsetPx(inspectorVisible),
                zIndex: 1,
            }}
        >
            {captureUrl && captureMeta ? (
                <ProductCard
                    caption={TEXT.OPEN_IMAGE}
                    media={
                        <img
                            alt={TEXT.OPEN_IMAGE}
                            height={captureMeta.height}
                            src={captureUrl}
                            style={MEDIA_STYLE}
                            width={captureMeta.width}
                        />
                    }
                    url={captureUrl}
                />
            ) : null}
            {videoUrl && videoMeta ? (
                <ProductCard
                    caption={`${TEXT.OPEN_VIDEO} · ${SOURCE_LABEL[videoMeta.source]} · ${videoMeta.durationSeconds.toFixed(VIDEO_DURATION_DECIMALS)}秒`}
                    media={
                        // 不带 controls:小窗只作首帧预览,点击整卡在新标签页查看(与截图同一交互)
                        <video height={videoMeta.height} src={videoUrl} style={MEDIA_STYLE} width={videoMeta.width} />
                    }
                    url={videoUrl}
                />
            ) : null}
        </Box>
    );
});

/** 产物卡片:整卡即外链,点击在新标签页查看;截图与视频共用壳层,仅媒体元素与说明文案不同。 */
const ProductCard = observer(function ProductCard({
    caption,
    media,
    url,
}: {
    readonly caption: string;
    readonly media: ReactNode;
    readonly url: string;
}) {
    return (
        <Paper
            component="a"
            href={url}
            rel="noreferrer"
            target="_blank"
            variant="panel"
            sx={{ display: "block", p: CARD_GAP }}
        >
            {media}
            <Typography color="text.secondary" sx={{ display: "block", textAlign: "center" }} variant="caption">
                {caption}
            </Typography>
        </Paper>
    );
});
