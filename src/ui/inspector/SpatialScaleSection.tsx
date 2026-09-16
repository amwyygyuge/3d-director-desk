import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import { SceneDescribeQuery } from "@/command/commands";
import type { SceneEntityInspection } from "@/command/SceneInspectionService";
import { SCENE_SPATIAL_SCALE_KIND } from "@/core/SceneSemantics";
import type { SceneSpatialScaleKind } from "@/core/SceneSemantics";
import { ScrubNumberField } from "@/ui/controls/ScrubNumberField";
import type { InspectorSectionProps } from "@/ui/inspector/Inspector";
import { INSPECTOR_FIELD_SX } from "@/ui/inspector/TransformFields";
import { invalidInputNotice } from "@/ui/shell/commandFeedback";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

const SET_SPATIAL_SCALE_COMMAND = "object.set-spatial-scale";
const REFERENCE_MAX_DIMENSION_LABEL = "最大边实际米数";
/** 参考米数下限:0 与负数不是尺度;上限按行星级布景留足余量,拦住 1e30 这类误输入 */
const REFERENCE_METERS_MIN = 0.001;
const REFERENCE_METERS_MAX = 100000;
const CONTROL_GAP = 1.5;
const FIELD_WIDTH_PX = 132;

const SCALE_KIND_TEXT: Record<SceneSpatialScaleKind, string> = {
    [SCENE_SPATIAL_SCALE_KIND.ACTOR_METERS]: "人偶米制 · 按身高落尺",
    [SCENE_SPATIAL_SCALE_KIND.REFERENCE_METERS]: "已标定米制 · 按参考最大边落尺",
    [SCENE_SPATIAL_SCALE_KIND.RELATIVE]: "相对单位 · 未标定,距离不可解释为米",
};

/**
 * 量纲区可见性谓词:纯函数,在 observer 渲染期求值(与 hasActorProfile 同纪律)。
 * 人偶实体锁死 actor-meters(命令层会拒改),故只对无 actor 的模型开放标定入口。
 */
export function hasCalibratableScale(stores: Pick<DirectorDeskStores, "scene">, objectId: string): boolean {
    const entity = stores.scene.manager.getEntity(objectId);
    return entity?.kind === "model" && entity.actor === null;
}

/**
 * 实测最大边:走 `scene.describe` 只读查询(dispatcher.query),取该实体 `bounds.size` 的最大分量。
 * 包围盒是 three 运行时量,不进 MobX;查询按需测量,这里只在按钮点击时取一次。
 */
function measuredMaxDimensionFor(stores: DirectorDeskStores, objectId: string): number | null {
    const result = stores.dispatcher.query({ type: SceneDescribeQuery.TYPE, payload: {} }, stores);
    if (!result.ok) return null;
    const entities = result.value as readonly SceneEntityInspection[];
    const bounds = entities.find((entry) => entry.id === objectId)?.bounds;
    if (!bounds) return null;
    const maxDimension = Math.max(...bounds.size);
    return Number.isFinite(maxDimension) && maxDimension > 0 ? maxDimension : null;
}

/**
 * 量纲分区:把「场景单位」与「真实米」对齐的唯一 UI 入口。
 *
 * 数值只经 ScrubNumberField 的 min/max 与命令 validate 双闸(禁裸数值进命令,红线 9);
 * 实体状态一律经 objectId 自取。
 */
export const SpatialScaleSection = observer(function SpatialScaleSection({ primaryId, report }: InspectorSectionProps) {
    const stores = useDirectorDeskStores();
    const entity = stores.scene.manager.getEntity(primaryId);
    if (!entity || !hasCalibratableScale(stores, primaryId)) return null;

    const scale = entity.spatialScale;
    // 加载未完成 / 包围盒缺失时「恢复原始尺寸」无实测依据:置灰而不是回写一个编造的尺度
    const loadState = stores.ui.modelOutcomes.get(primaryId);
    const measurable = loadState === "loaded";

    const calibrate = (referenceMaxDimensionMeters: number): void => {
        report(
            stores.dispatcher.dispatch(
                {
                    type: SET_SPATIAL_SCALE_COMMAND,
                    payload: {
                        id: primaryId,
                        spatialScale: {
                            kind: SCENE_SPATIAL_SCALE_KIND.REFERENCE_METERS,
                            referenceMaxDimensionMeters,
                        },
                    },
                },
                stores,
            ),
        );
    };

    const restoreMeasured = (): void => {
        const measured = measuredMaxDimensionFor(stores, primaryId);
        if (measured === null) {
            stores.ui.setApplicationNotice("尚未测得包围盒,等模型加载完成后再试");
            return;
        }
        calibrate(measured);
    };

    return (
        <Box sx={INSPECTOR_FIELD_SX}>
            <Typography variant="overline">量纲</Typography>
            <Typography variant="caption" color="text.secondary">
                {SCALE_KIND_TEXT[scale.kind]}
            </Typography>
            <Stack direction="row" spacing={CONTROL_GAP} sx={{ alignItems: "center" }}>
                <Box sx={{ width: FIELD_WIDTH_PX }}>
                    <ScrubNumberField
                        label="m"
                        ariaLabel={REFERENCE_MAX_DIMENSION_LABEL}
                        kind="distanceMeters"
                        value={scale.referenceMaxDimensionMeters}
                        min={REFERENCE_METERS_MIN}
                        max={REFERENCE_METERS_MAX}
                        placeholder="未标定"
                        onCommit={calibrate}
                        onInvalid={invalidInputNotice(stores, REFERENCE_MAX_DIMENSION_LABEL, {
                            min: REFERENCE_METERS_MIN,
                            max: REFERENCE_METERS_MAX,
                        })}
                    />
                </Box>
                <Button size="small" disabled={!measurable} onClick={restoreMeasured}>
                    恢复原始尺寸
                </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
                {REFERENCE_MAX_DIMENSION_LABEL}:资产最长边在现实里有多长。「恢复原始尺寸」按当前实测包围盒标定。
            </Typography>
        </Box>
    );
});
