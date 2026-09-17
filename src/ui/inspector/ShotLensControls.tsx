import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import { APERTURE_F_STOP, focalLengthFromFov, focalLengthRangeMm, FOCUS_DISTANCE_METERS } from "@/camera/CameraLens";
import { ScrubNumberField } from "@/ui/controls/ScrubNumberField";
import { INSPECTOR_FIELD_SX } from "@/ui/inspector/TransformFields";
import { invalidInputNotice } from "@/ui/shell/commandFeedback";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { ReportCommandResult } from "@/ui/inspector/Inspector";

const FIELD_LABEL_WIDTH_PX = 56;
const FIELD_COLUMN_GAP = 0.5;
const ROW_GAP = 1.5;
const PRESET_GRID_TEMPLATE_COLUMNS = "repeat(4, minmax(0, 1fr))";

/**
 * 焦距预设:摄影语言的常用档,不是均分刻度。
 *
 * 24 广角带环境、35 纪实、50 接近人眼、85 人像特写压缩背景——作者按叙事挑档,
 * 比拖一个连续滑杆更快到位。数值仍经 `camera.set-lens` 的围栏,预设只是入口。
 */
const FOCAL_LENGTH_PRESETS_MM: readonly { readonly mm: number; readonly caption: string }[] = [
    { mm: 24, caption: "广角,带环境" },
    { mm: 35, caption: "纪实" },
    { mm: 50, caption: "标准,近人眼" },
    { mm: 85, caption: "人像特写" },
];

/** 显示精度:焦距标称到 0.1mm 已远超作者可辨识度,更多位只是浮点噪声。 */
const FOCAL_LENGTH_DECIMALS = 1;

interface ShotLensSectionProps {
    readonly shotId: string;
    readonly report: ReportCommandResult;
}

/**
 * 机位镜头参数:焦距 / 光圈 / 对焦距离,全部落 `camera.set-lens`(与 AI 同一条命令路径)。
 *
 * 焦距不另存——它是 `fov` 的派生视图,这里由当前 fov 换算显示、写入时换算回 fov。
 * 换算画幅取 `OutputSettings.aspectRatioFor`,与命令层同一口径:界面标 50mm,
 * 命令就必须按同一画幅算,否则往返会漂。
 *
 * 光圈与对焦距离目前是**导演意图**:随文档往返、AI 可读回校验,但预览尚未兑现景深
 * (见 `CameraLens` 的类注释),故界面明说,免得作者把「调了没变化」当成 bug。
 */
export const ShotLensSection = observer(function ShotLensSection({ shotId, report }: ShotLensSectionProps) {
    const stores = useDirectorDeskStores();
    const { camera, capture, dispatcher, output } = stores;
    const shot = camera.director.getShot(shotId);
    if (!shot) return null;

    const aspect = output.aspectRatioFor(capture.size);
    const focalLengthMm = focalLengthFromFov(shot.fov, aspect);
    const focalRange = focalLengthRangeMm(aspect);
    const isAutoFocus = shot.lens.focusDistanceMeters === null;
    /**
     * 关掉自动对焦时的落点:机位到注视点的距离(自动对焦本就对在那个面上),
     * 夹进命令围栏——贴脸机位的真实距离可能小于下界,不夹会让「关掉自动」这一步被拒。
     */
    const subjectDistanceMeters = Math.min(
        FOCUS_DISTANCE_METERS.MAX,
        Math.max(
            FOCUS_DISTANCE_METERS.MIN,
            Math.hypot(
                shot.target[0] - shot.position[0],
                shot.target[1] - shot.position[1],
                shot.target[2] - shot.position[2],
            ),
        ),
    );

    const applyLens = (payload: {
        focalLengthMm?: number;
        apertureFStop?: number;
        focusDistanceMeters?: number | null;
    }): void => {
        report(dispatcher.dispatch({ type: "camera.set-lens", payload: { id: shotId, ...payload } }, stores));
    };

    return (
        <Box sx={INSPECTOR_FIELD_SX}>
            <Typography variant="overline">镜头</Typography>
            <Box
                sx={{
                    display: "grid",
                    gridTemplateColumns: `${FIELD_LABEL_WIDTH_PX}px 1fr`,
                    gap: FIELD_COLUMN_GAP,
                    rowGap: ROW_GAP,
                    alignItems: "center",
                }}
            >
                <Typography variant="caption" color="text.secondary">
                    焦距
                </Typography>
                <ScrubNumberField
                    label="mm"
                    ariaLabel="焦距"
                    kind="focalLengthMm"
                    min={focalRange.min}
                    max={focalRange.max}
                    value={Number(focalLengthMm.toFixed(FOCAL_LENGTH_DECIMALS))}
                    onCommit={(value) => applyLens({ focalLengthMm: value })}
                    onInvalid={invalidInputNotice(stores, "焦距", { min: focalRange.min, max: focalRange.max })}
                />
                <Typography variant="caption" color="text.secondary">
                    光圈
                </Typography>
                <ScrubNumberField
                    label="f/"
                    ariaLabel="光圈"
                    kind="apertureFStop"
                    min={APERTURE_F_STOP.MIN}
                    max={APERTURE_F_STOP.MAX}
                    value={shot.lens.apertureFStop}
                    onCommit={(value) => applyLens({ apertureFStop: value })}
                    onInvalid={invalidInputNotice(stores, "光圈", {
                        min: APERTURE_F_STOP.MIN,
                        max: APERTURE_F_STOP.MAX,
                    })}
                />
                <Typography variant="caption" color="text.secondary">
                    对焦
                </Typography>
                <Box sx={{ display: "flex", gap: FIELD_COLUMN_GAP, alignItems: "center" }}>
                    <Tooltip title="对焦面落在注视目标上(导演台常态)">
                        <ToggleButton
                            size="small"
                            value="auto"
                            selected={isAutoFocus}
                            aria-label="自动对焦到注视目标"
                            onChange={() =>
                                applyLens({
                                    // 关掉自动 = 把当前机位到注视点的距离定死,作者从这个值往下调才有参照
                                    focusDistanceMeters: isAutoFocus ? subjectDistanceMeters : null,
                                })
                            }
                            sx={{ flexShrink: 0, px: 1 }}
                        >
                            自动
                        </ToggleButton>
                    </Tooltip>
                    <ScrubNumberField
                        label="m"
                        ariaLabel="对焦距离"
                        kind="distanceMeters"
                        min={FOCUS_DISTANCE_METERS.MIN}
                        max={FOCUS_DISTANCE_METERS.MAX}
                        disabled={isAutoFocus}
                        placeholder="注视点"
                        value={shot.lens.focusDistanceMeters}
                        allowEmpty
                        onClear={() => applyLens({ focusDistanceMeters: null })}
                        onCommit={(value) => applyLens({ focusDistanceMeters: value })}
                        onInvalid={invalidInputNotice(stores, "对焦距离", {
                            min: FOCUS_DISTANCE_METERS.MIN,
                            max: FOCUS_DISTANCE_METERS.MAX,
                        })}
                    />
                </Box>
            </Box>
            <Box sx={{ display: "grid", gap: 0.5, gridTemplateColumns: PRESET_GRID_TEMPLATE_COLUMNS }}>
                {FOCAL_LENGTH_PRESETS_MM.map((preset) => (
                    <Tooltip key={preset.mm} title={preset.caption}>
                        <Button
                            size="small"
                            variant="outlined"
                            disabled={preset.mm < focalRange.min || preset.mm > focalRange.max}
                            onClick={() => applyLens({ focalLengthMm: preset.mm })}
                            sx={{ px: 0.5 }}
                        >
                            {preset.mm}mm
                        </Button>
                    </Tooltip>
                ))}
            </Box>
            <Typography variant="caption" color="text.secondary">
                光圈与对焦是成片意图:随工程往返、可被 AI 读回校验,但预览与截图尚未渲染景深虚化。
            </Typography>
        </Box>
    );
});
