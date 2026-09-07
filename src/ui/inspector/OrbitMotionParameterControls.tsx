import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";

import {
    ORBIT_DEGREES_OPTIONS,
    ORBIT_DIRECTION,
    ORBIT_RADIUS_MAX_METERS,
    ORBIT_RADIUS_MIN_METERS,
} from "@/authoring/MotionPresetCompiler";
import type { OrbitDirection, OrbitMotionParameters } from "@/authoring/MotionPresetCompiler";
import { ScrubNumberField } from "@/ui/controls/ScrubNumberField";

const ORBIT_GRID_COLUMNS = "repeat(2, minmax(0, 1fr))";
const ORBIT_DIRECTION_LABEL: Record<OrbitDirection, string> = {
    [ORBIT_DIRECTION.CW]: "顺时针",
    [ORBIT_DIRECTION.CCW]: "逆时针",
};

export interface OrbitMotionParameterControlsProps {
    readonly value: OrbitMotionParameters;
    readonly onChange: (value: OrbitMotionParameters) => void;
}

/**
 * 环绕类语汇的通用参数叶子:快速运镜和机位预设共享同一份导演语义。
 * 半径是圆的水平半径(米);留空时沿用起幅机位到轴心的当前距离。
 */
export function OrbitMotionParameterControls({ onChange, value }: OrbitMotionParameterControlsProps) {
    return (
        <Box sx={{ display: "grid", gridTemplateColumns: ORBIT_GRID_COLUMNS, gap: 1 }}>
            <Select
                size="small"
                value={value.degrees}
                onChange={(event) => onChange(value.with({ degrees: Number(event.target.value) }))}
                aria-label="环绕转角"
            >
                {ORBIT_DEGREES_OPTIONS.map((option) => (
                    <MenuItem key={option} value={option}>
                        环绕 {option}°
                    </MenuItem>
                ))}
            </Select>
            <Select
                size="small"
                value={value.direction}
                onChange={(event) => onChange(value.with({ direction: event.target.value as OrbitDirection }))}
                aria-label="环绕方向"
            >
                {Object.entries(ORBIT_DIRECTION_LABEL).map(([candidate, label]) => (
                    <MenuItem key={candidate} value={candidate}>
                        {label}
                    </MenuItem>
                ))}
            </Select>
            <ScrubNumberField
                label="半径 m"
                ariaLabel="环绕半径(米)"
                value={value.radiusMeters}
                kind="distanceMeters"
                min={ORBIT_RADIUS_MIN_METERS}
                max={ORBIT_RADIUS_MAX_METERS}
                allowEmpty
                placeholder="当前"
                onCommit={(radiusMeters) => onChange(value.with({ radiusMeters }))}
                onClear={() => onChange(value.with({ radiusMeters: null }))}
            />
        </Box>
    );
}
