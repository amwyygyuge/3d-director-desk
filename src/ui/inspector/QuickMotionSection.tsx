import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import {
    DEFAULT_PRESET_DURATION_SECONDS,
    FOLLOW_MOVE_LABEL,
    isOrbitMove,
    isOrientationMove,
    MOTION_DURATION_OPTIONS_SECONDS,
    MOTION_MOVE,
    MOTION_MOVE_LABEL,
    MOTION_PROGRAM_RANGE_DECIMALS,
    motionProgramRangeFor,
    OrbitMotionParameters,
} from "@/authoring/MotionPresetCompiler";
import type { MotionMove } from "@/authoring/MotionPresetCompiler";
import { SHOT_SIZE } from "@/camera/CameraShot";
import type { ShotSize } from "@/camera/CameraShot";
import { FOLLOW_APPROACH } from "@/camera/CameraFollowTrack";
import type { FollowApproach } from "@/camera/CameraFollowTrack";
import { EASING } from "@/motion/EasingCurve";
import { QuickAuthorMotionCommand } from "@/command/cameraMotionCommands";
import type { InspectorSectionProps } from "@/ui/inspector/Inspector";
import { OrbitMotionParameterControls } from "@/ui/inspector/OrbitMotionParameterControls";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { SHOT_SIZE_LABELS } from "@/ui/shots/shotSizeLabels";

const MOTION_MOVES = Object.values(MOTION_MOVE) as readonly MotionMove[];
const SHOT_SIZES = Object.values(SHOT_SIZE) as readonly ShotSize[];
const PROGRAM_START_SECONDS = 0;
const PRESET_GRID_COLUMNS = "repeat(2, minmax(0, 1fr))";
const NO_FOLLOW = "none";
/** 站位档位:跟拍时相机站在主体的哪一侧;不发裸角度 */
const FOLLOW_APPROACH_LABELS: Record<FollowApproach, string> = {
    [FOLLOW_APPROACH.BACK]: "身后",
    [FOLLOW_APPROACH.FRONT]: "正前",
    [FOLLOW_APPROACH.LEFT]: "左侧",
    [FOLLOW_APPROACH.RIGHT]: "右侧",
};
const FOLLOW_APPROACHES = Object.values(FOLLOW_APPROACH) as readonly FollowApproach[];
/** 跟拍的缺省语汇:保持相对站位 = 第三人称固定跟随,这是跟拍最常见的用法 */
const DEFAULT_FOLLOW_MOVE = MOTION_MOVE.HOLD;
const DEFAULT_FREE_MOVE = MOTION_MOVE.ORBIT;

/**
 * 快速运镜分区(模型检查器):选中模型 → 景别 + 语汇 → 一步成片。
 * 编排收敛在 motion.quick-author 聚合命令(追加 Program 末尾/超时长自动扩轴);
 * 起幅机位仅是编译期构图快照,本组件只持草稿态(useState 白名单:输入草稿),不写任何领域状态。
 */
export const QuickMotionSection = observer(function QuickMotionSection({ primaryId }: InspectorSectionProps) {
    const stores = useDirectorDeskStores();
    const entity = stores.scene.manager.getEntity(primaryId);
    const [shotSize, setShotSize] = useState<ShotSize>(SHOT_SIZE.MEDIUM);
    const [approach, setApproach] = useState<FollowApproach | null>(FOLLOW_APPROACH.BACK);
    const [move, setMove] = useState<MotionMove>(DEFAULT_FOLLOW_MOVE);
    const [orbitParameters, setOrbitParameters] = useState(() => new OrbitMotionParameters());
    const [durationSeconds, setDurationSeconds] = useState<number>(DEFAULT_PRESET_DURATION_SECONDS);
    const orbitLike = isOrbitMove(move);
    if (!entity) return null;
    const programEndTimeSeconds = stores.motion.program.clips.reduce(
        (endTimeSeconds, clip) => Math.max(endTimeSeconds, clip.endTimeSeconds),
        PROGRAM_START_SECONDS,
    );
    const programRange = motionProgramRangeFor({
        startTimeSeconds: programEndTimeSeconds,
        durationSeconds,
    });

    /** 切换跟拍即切换缺省语汇:跟拍下最常用的是保持相对站位,自由运镜下是环绕 */
    const switchFollow = (next: FollowApproach | null): void => {
        setApproach(next);
        setMove(next ? DEFAULT_FOLLOW_MOVE : DEFAULT_FREE_MOVE);
    };

    const create = (): void => {
        const result = stores.dispatcher.dispatch(
            {
                type: QuickAuthorMotionCommand.TYPE,
                payload: {
                    subjectId: primaryId,
                    shotSize,
                    move,
                    durationSeconds,
                    ...(orbitLike ? { orbit: orbitParameters.toJSON() } : {}),
                    ...(approach ? { follow: { approach } } : {}),
                    easing: EASING.SMOOTH,
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
                为「{entity.name}」生成运镜片段并追加到成片(Program)末尾;不新建机位,起幅机位只是构图快照。
            </Typography>
            <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                value={approach ?? NO_FOLLOW}
                onChange={(_, next: string | null) =>
                    switchFollow(next === null || next === NO_FOLLOW ? null : (next as FollowApproach))
                }
                aria-label="跟拍站位"
            >
                <ToggleButton value={NO_FOLLOW}>不跟</ToggleButton>
                {FOLLOW_APPROACHES.map((candidate) => (
                    <ToggleButton key={candidate} value={candidate}>
                        {FOLLOW_APPROACH_LABELS[candidate]}
                    </ToggleButton>
                ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary">
                {approach
                    ? "镜头站在主体的这一侧跟着走;下面的语汇作用于相对主体的运动。"
                    : "机位固定在世界里,按当前相机方位取景。"}
                摇镜/俯仰只改注视方向,而本面板的注视始终锁在被摄对象上,故不可选。
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
                        disabled={isOrientationMove(candidate)}
                        onClick={() => setMove(candidate)}
                    >
                        {approach ? FOLLOW_MOVE_LABEL[candidate] : MOTION_MOVE_LABEL[candidate]}
                    </Button>
                ))}
            </Box>
            {orbitLike && <OrbitMotionParameterControls value={orbitParameters} onChange={setOrbitParameters} />}
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
