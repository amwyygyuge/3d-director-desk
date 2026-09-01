import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { MOTION_MOVE, MOTION_MOVE_LABEL } from "@/authoring/MotionPresetCompiler";
import type { MotionMove } from "@/authoring/MotionPresetCompiler";
import { CAMERA_MOTION_EASING } from "@/camera/CameraMotionEasing";
import type { ShotSize } from "@/camera/CameraShot";
import { SHOT_SIZE_LABELS } from "@/ui/shots/shotSizeLabels";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";

const FIELD_GAP = 0.75;
const PRESET_GRID_COLUMNS = "repeat(2, minmax(0, 1fr))";
const DEFAULT_MOTION_DURATION_SECONDS = 2;
const MOTION_PRESET_STATUS_ID = "director-desk-motion-preset-status";
const FOLLOW_SHOT_SIZE = "follow";

const MOTION_MOVES = Object.values(MOTION_MOVE) as readonly MotionMove[];

/** 落幅景别是可选参数:选「保持机位」时预设只做位移,不按被摄体重新定距。 */
type LandingShotSize = ShotSize | typeof FOLLOW_SHOT_SIZE;

/**
 * 机位面板里的运镜预设区。
 *
 * 预设天然与一台机位绑定(从它的当前姿态推导落幅),故住在机位的情境面板而非左栏全局面板——
 * 左栏那份「选哪台机位」的隐式判断随之消失,cameraId 由面板上下文直接给出。
 */
export const MotionPresetControls = observer(function MotionPresetControls({ cameraId }: { cameraId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motionAuthoring, playheadDisplay, scene, selection, timeline } = stores;
    const [landingShotSize, setLandingShotSize] = useState<LandingShotSize>(FOLLOW_SHOT_SIZE);
    const playhead = Math.min(playheadDisplay.value, timeline.document.duration);
    const remainingSeconds = timeline.document.duration - playhead;
    const durationSeconds = Math.min(DEFAULT_MOTION_DURATION_SECONDS, remainingSeconds);
    const subjectId = selection.selectedIds.find((id) => scene.manager.getEntity(id) !== undefined) ?? null;
    const isAuthorable = durationSeconds > 0;

    const authorMotion = (move: MotionMove): void => {
        if (!isAuthorable) return;
        const result = dispatcher.dispatch(
            {
                type: "motion.author",
                payload: {
                    cameraId,
                    startTimeSeconds: playhead,
                    durationSeconds,
                    move,
                    ...(subjectId === null ? {} : { subjectId }),
                    ...(landingShotSize === FOLLOW_SHOT_SIZE ? {} : { shotSize: landingShotSize }),
                    easing: CAMERA_MOTION_EASING.SMOOTH,
                },
            },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP }}>
            <Typography variant="subtitle2">运镜预设</Typography>
            <Select
                size="small"
                value={landingShotSize}
                onChange={(event) => setLandingShotSize(event.target.value as LandingShotSize)}
                aria-label="落幅景别"
            >
                <MenuItem value={FOLLOW_SHOT_SIZE}>落幅景别：保持机位</MenuItem>
                {Object.entries(SHOT_SIZE_LABELS).map(([size, label]) => (
                    <MenuItem key={size} value={size}>
                        落幅景别：{label}
                    </MenuItem>
                ))}
            </Select>
            <Box sx={{ display: "grid", gridTemplateColumns: PRESET_GRID_COLUMNS, gap: FIELD_GAP }}>
                {MOTION_MOVES.map((move) => (
                    <Button
                        key={move}
                        size="small"
                        variant="outlined"
                        disabled={!isAuthorable}
                        aria-describedby={isAuthorable ? undefined : MOTION_PRESET_STATUS_ID}
                        onClick={() => authorMotion(move)}
                    >
                        {MOTION_MOVE_LABEL[move]}
                    </Button>
                ))}
            </Box>
            {!isAuthorable && (
                <Typography id={MOTION_PRESET_STATUS_ID} role="status" variant="caption" color="text.secondary">
                    playhead 已到时间轴末尾,先回退再创建运镜
                </Typography>
            )}
            <Button
                size="small"
                aria-pressed={motionAuthoring.pathVisible}
                onClick={() => motionAuthoring.setPathVisible(!motionAuthoring.pathVisible)}
            >
                {motionAuthoring.pathVisible ? "隐藏运镜路径" : "显示运镜路径"}
            </Button>
        </Box>
    );
});
