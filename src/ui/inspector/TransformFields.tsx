import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { type KeyboardEvent, useState } from "react";
import type { CommandResult } from "../../command/DirectorCommand";
import type { Transform, Vec3 } from "../../core/SceneObject";
import type { DirectorDeskStores } from "../shell/DirectorDeskContext";
import { useDirectorDeskStores } from "../shell/DirectorDeskContext";
import { MONO_FONT_STACK } from "../shell/theme";

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const AXIS_X = 0;
const AXIS_Y = 1;
const AXIS_Z = 2;
const DISPLAY_DECIMAL_PLACES = 4;
const FIELD_GROUP_GAP = 0.75;
const INSPECTOR_FIELD_RADIUS = 1;
const INSPECTOR_FIELD_PADDING = 1;
const FIELD_COLUMN_GAP = 0.5;
const FIELD_GRID_TEMPLATE = "32px repeat(3, 1fr)";

/** 检查器所有字段组共享深色内嵌表面，避免各分区视觉漂移。 */
export const INSPECTOR_FIELD_SX = {
    bgcolor: "rgba(0,0,0,0.22)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: INSPECTOR_FIELD_RADIUS,
    p: INSPECTOR_FIELD_PADDING,
} as const;

type AxisIndex = typeof AXIS_X | typeof AXIS_Y | typeof AXIS_Z;
type TransformKey = keyof Transform;

interface TransformFieldProps {
    axisLabel: string;
    label: string;
    value: number;
    onCommit: (value: number) => void;
}

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

function formatValue(value: number): string {
    return String(Number(value.toFixed(DISPLAY_DECIMAL_PLACES)));
}

function finiteNumber(value: string): number | null {
    const parsed = Number(value);
    return value.trim() !== "" && Number.isFinite(parsed) ? parsed : null;
}

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

function reportCommandFailure({ stores, result }: { readonly stores: DirectorDeskStores; readonly result: CommandResult }): void {
    if (result.ok) return;
    stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
}

const TransformField = observer(function TransformField({ axisLabel, label, value, onCommit }: TransformFieldProps) {
    const [inputValue, setInputValue] = useState(() => formatValue(value));

    const commit = () => {
        const parsed = finiteNumber(inputValue);
        if (parsed === null) {
            setInputValue(formatValue(value));
            return;
        }
        onCommit(parsed);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            commit();
        }
    };

    return (
        <TextField
            aria-label={label}
            label={axisLabel}
            fullWidth
            size="small"
            type="number"
            value={inputValue}
            onBlur={commit}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={handleKeyDown}
            sx={{ "& .MuiInputBase-input": { fontFamily: MONO_FONT_STACK } }}
        />
    );
});

/** 数值变换编辑器：旋转按 DCC 习惯显示为角度，提交时统一转换为弧度。 */
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
        reportCommandFailure({ stores, result });
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
                        return (
                            <TransformField
                                key={`${axis.label}-${displayedValue}`}
                                axisLabel={axis.label}
                                label={`${group.label}${axis.label}`}
                                value={displayedValue}
                                onCommit={(nextValue) => commitAxis(group.key, axis.index, nextValue)}
                            />
                        );
                    })}
                </Box>
            ))}
        </Box>
    );
});
