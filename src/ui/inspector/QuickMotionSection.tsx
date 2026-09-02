import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import {
    DEFAULT_PRESET_DURATION_SECONDS,
    MOTION_DURATION_OPTIONS_SECONDS,
    MOTION_MOVE,
    MOTION_MOVE_LABEL,
    MOTION_PROGRAM_RANGE_DECIMALS,
    motionProgramRangeFor,
    ORBIT_DIRECTION,
} from "@/authoring/MotionPresetCompiler";
import type { MotionMove, OrbitDirection } from "@/authoring/MotionPresetCompiler";
import { SHOT_SIZE } from "@/camera/CameraShot";
import type { ShotSize } from "@/camera/CameraShot";
import { CAMERA_MOTION_EASING } from "@/camera/CameraMotionEasing";
import { QuickAuthorMotionCommand } from "@/command/cameraMotionCommands";
import type { InspectorSectionProps } from "@/ui/inspector/Inspector";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { SHOT_SIZE_LABELS } from "@/ui/shots/shotSizeLabels";

const MOTION_MOVES = Object.values(MOTION_MOVE) as readonly MotionMove[];
const SHOT_SIZES = Object.values(SHOT_SIZE) as readonly ShotSize[];
/** 环绕转角档位:90 瞥一眼 / 180 半周 / 360 整圈 */
const ORBIT_DEGREES_OPTIONS = [90, 180, 360] as const;
const PROGRAM_START_SECONDS = 0;
const PRESET_GRID_COLUMNS = "repeat(2, minmax(0, 1fr))";

const ORBIT_DIRECTION_LABELS: Record<OrbitDirection, string> = {
    [ORBIT_DIRECTION.CW]: "顺时针",
    [ORBIT_DIRECTION.CCW]: "逆时针",
};

/** 环绕类语汇(转角/方向参数只对有方位语义的语汇显示) */
function isOrbitLike(move: MotionMove): boolean {
    return move === MOTION_MOVE.ORBIT || move === MOTION_MOVE.SPIRAL;
}

/**
 * 快速运镜分区(模型检查器):选中模型 → 景别 + 语汇 → 一步成片。
 * 编排收敛在 motion.quick-author 聚合命令(追加 Program 末尾/超时长自动扩轴);
 * 起幅机位仅是编译期构图快照,本组件只持草稿态(useState 白名单:输入草稿),不写任何领域状态。
 */
export const QuickMotionSection = observer(function QuickMotionSection({ primaryId }: InspectorSectionProps) {
    const stores = useDirectorDeskStores();
    const entity = stores.scene.manager.getEntity(primaryId);
    const [shotSize, setShotSize] = useState<ShotSize>(SHOT_SIZE.MEDIUM);
    const [move, setMove] = useState<MotionMove>(MOTION_MOVE.ORBIT);
    const [degrees, setDegrees] = useState<number>(ORBIT_DEGREES_OPTIONS[2]);
    const [direction, setDirection] = useState<OrbitDirection>(ORBIT_DIRECTION.CW);
    const [durationSeconds, setDurationSeconds] = useState<number>(DEFAULT_PRESET_DURATION_SECONDS);
    const orbitLike = isOrbitLike(move);
    if (!entity) return null;
    const programEndTimeSeconds = stores.motion.program.clips.reduce(
        (endTimeSeconds, clip) => Math.max(endTimeSeconds, clip.endTimeSeconds),
        PROGRAM_START_SECONDS,
    );
    const programRange = motionProgramRangeFor({
        startTimeSeconds: programEndTimeSeconds,
        durationSeconds,
    });

    const create = (): void => {
        const result = stores.dispatcher.dispatch(
            {
                type: QuickAuthorMotionCommand.TYPE,
                payload: {
                    subjectId: primaryId,
                    shotSize,
                    move,
                    durationSeconds,
                    ...(orbitLike ? { degrees, direction } : {}),
                    easing: CAMERA_MOTION_EASING.SMOOTH,
                },
            },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    return (
        <Box className="grid gap-3">
            <Typography variant="subtitle2">快速运镜</Typography>
            <Typography variant="caption" color="text.secondary">
                按当前相机方位为「{entity.name}」生成运镜片段并追加到成片（Program）末尾；不新建机位，起幅机位只是构图快照。
            </Typography>
            <Select
                size="small"
                value={shotSize}
                onChange={(event) => setShotSize(event.target.value as ShotSize)}
                aria-label="起幅景别"
            >
                {SHOT_SIZES.map((size) => (
                    <MenuItem key={size} value={size}>
                        起幅景别:{SHOT_SIZE_LABELS[size]}
                    </MenuItem>
                ))}
            </Select>
            <Box sx={{ display: "grid", gridTemplateColumns: PRESET_GRID_COLUMNS, gap: 1 }}>
                {MOTION_MOVES.map((candidate) => (
                    <Button
                        key={candidate}
                        size="small"
                        variant={candidate === move ? "contained" : "outlined"}
                        onClick={() => setMove(candidate)}
                    >
                        {MOTION_MOVE_LABEL[candidate]}
                    </Button>
                ))}
            </Box>
            {orbitLike && (
                <Box sx={{ display: "grid", gridTemplateColumns: PRESET_GRID_COLUMNS, gap: 1 }}>
                    <Select
                        size="small"
                        value={degrees}
                        onChange={(event) => setDegrees(Number(event.target.value))}
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
                        value={direction}
                        onChange={(event) => setDirection(event.target.value as OrbitDirection)}
                        aria-label="环绕方向"
                    >
                        {Object.entries(ORBIT_DIRECTION_LABELS).map(([value, label]) => (
                            <MenuItem key={value} value={value}>
                                {label}
                            </MenuItem>
                        ))}
                    </Select>
                </Box>
            )}
            <Select
                size="small"
                value={durationSeconds}
                onChange={(event) => setDurationSeconds(Number(event.target.value))}
                aria-label="时长"
            >
                {MOTION_DURATION_OPTIONS_SECONDS.map((option) => (
                    <MenuItem key={option} value={option}>
                        时长 {option} 秒
                    </MenuItem>
                ))}
            </Select>
            <Typography variant="caption" color="text.secondary">
                将追加到成片末尾，占用 {programRange.startTimeSeconds.toFixed(MOTION_PROGRAM_RANGE_DECIMALS)}s –{" "}
                {programRange.endTimeSeconds.toFixed(MOTION_PROGRAM_RANGE_DECIMALS)}s；超出时间轴时长会自动扩轴。
            </Typography>
            <Button size="small" variant="contained" onClick={create}>
                创建并切入成片
            </Button>
        </Box>
    );
});
