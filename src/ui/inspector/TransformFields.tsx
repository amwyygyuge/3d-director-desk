import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import type { Transform, Vec3 } from "@/core/SceneObject";
import { ScrubNumberField } from "@/ui/controls/ScrubNumberField";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const AXIS_X = 0;
const AXIS_Y = 1;
const AXIS_Z = 2;
const FIELD_GROUP_GAP = 0.75;
const INSPECTOR_FIELD_RADIUS = 1;
const INSPECTOR_FIELD_PADDING = 1.5;
/** 分区内统一纵向节奏(标题↔内容、内容↔内容);浮起标签上溢约 9px,12px 间距才不相切 */
const INSPECTOR_FIELD_GAP = 1.5;
const FIELD_COLUMN_GAP = 0.5;
const FIELD_GRID_TEMPLATE = "32px repeat(3, 1fr)";

/** 检查器所有字段组共享深色内嵌表面与纵向节奏;消费方不再给首内容手搓 mt。 */
export const INSPECTOR_FIELD_SX = {
    bgcolor: "rgba(0,0,0,0.22)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: INSPECTOR_FIELD_RADIUS,
    p: INSPECTOR_FIELD_PADDING,
    display: "flex",
    flexDirection: "column",
    gap: INSPECTOR_FIELD_GAP,
} as const;

type AxisIndex = typeof AXIS_X | typeof AXIS_Y | typeof AXIS_Z;
type TransformKey = keyof Transform;

interface TransformGroup {
    key: TransformKey;
    label: string;
}

const TRANSFORM_GROUPS: readonly TransformGroup[] = [
    { key: "position", label: "位置" },
    { key: "rotation", label: "旋转" },
    { key: "scale", label: "缩放" },
];

const AXES: readonly { label: string; index: AxisIndex }[] = [
    { label: "X", index: AXIS_X },
    { label: "Y", index: AXIS_Y },
    { label: "Z", index: AXIS_Z },
];

/** Object3D 的 position/rotation/scale 与实体 Transform 同构,预览按轴名直写运行时 */
const RUNTIME_AXIS = ["x", "y", "z"] as const;

/** 值语义档位:旋转按 DCC 习惯显示角度(提交/预览时换算弧度),位置缩放不同步长 */
const FIELD_KIND = { position: "position", rotation: "rotationDeg", scale: "scale" } as const;

function replaceAxis(vector: Vec3, axis: AxisIndex, value: number): Vec3 {
    switch (axis) {
        case AXIS_X:
            return [value, vector[AXIS_Y], vector[AXIS_Z]];
        case AXIS_Y:
            return [vector[AXIS_X], value, vector[AXIS_Z]];
        case AXIS_Z:
            return [vector[AXIS_X], vector[AXIS_Y], value];
    }
}

/** 数值变换编辑器:刮擦期只写 three 运行时预览,松手收敛为一条 object.move(与 gizmo 同模式)。 */
export const TransformFields = observer(function TransformFields({ objectId }: { objectId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, scene } = stores;
    const entity = scene.manager.getEntity(objectId);
    if (!entity) return null;

    const commitAxis = (key: TransformKey, axis: AxisIndex, displayedValue: number) => {
        const latestEntity = scene.manager.getEntity(objectId);
        if (!latestEntity) return;
        const storedValue = key === "rotation" ? displayedValue * DEG_TO_RAD : displayedValue;
        const currentTransform = latestEntity.transform;
        const transform: Transform = {
            position:
                key === "position"
                    ? replaceAxis(currentTransform.position, axis, storedValue)
                    : currentTransform.position,
            rotation:
                key === "rotation"
                    ? replaceAxis(currentTransform.rotation, axis, storedValue)
                    : currentTransform.rotation,
            scale: key === "scale" ? replaceAxis(currentTransform.scale, axis, storedValue) : currentTransform.scale,
        };
        const result = dispatcher.dispatch({ type: "object.move", payload: { id: objectId, transform } }, stores);
        reportCommandFailure(stores, result);
    };

    const previewAxis = (key: TransformKey, axis: AxisIndex, displayedValue: number) => {
        const runtime = scene.manager.getRuntime(objectId);
        if (!runtime) return;
        runtime[key][RUNTIME_AXIS[axis]] = key === "rotation" ? displayedValue * DEG_TO_RAD : displayedValue;
        stores.playback.requestRender();
    };

    return (
        <Box sx={{ display: "grid", gap: FIELD_GROUP_GAP }}>
            {TRANSFORM_GROUPS.map((group) => (
                <Box
                    key={group.key}
                    sx={{
                        display: "grid",
                        gridTemplateColumns: FIELD_GRID_TEMPLATE,
                        gap: FIELD_COLUMN_GAP,
                        alignItems: "center",
                    }}
                >
                    <Typography variant="overline" color="text.secondary">
                        {group.label}
                    </Typography>
                    {AXES.map((axis) => {
                        const value = entity.transform[group.key][axis.index];
                        const displayedValue = group.key === "rotation" ? value * RAD_TO_DEG : value;
                        const fieldLabel = `${group.label}${axis.label}`;
                        return (
                            <ScrubNumberField
                                key={axis.label}
                                label={axis.label}
                                ariaLabel={fieldLabel}
                                kind={FIELD_KIND[group.key]}
                                value={displayedValue}
                                onCommit={(nextValue) => commitAxis(group.key, axis.index, nextValue)}
                                onPreview={(nextValue) => previewAxis(group.key, axis.index, nextValue)}
                                onInvalid={() => stores.ui.setApplicationNotice(`${fieldLabel} 必须是有限数值`)}
                            />
                        );
                    })}
                </Box>
            ))}
        </Box>
    );
});
