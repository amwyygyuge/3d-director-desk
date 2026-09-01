import AddAPhotoIcon from "@mui/icons-material/AddAPhoto";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { Box3, Vector3 } from "three";

import { MOTION_MOVE, MOTION_MOVE_LABEL } from "@/authoring/MotionPresetCompiler";
import type { MotionMove } from "@/authoring/MotionPresetCompiler";
import { CAMERA_MOTION_EASING } from "@/camera/CameraMotionEasing";
import { SHOT_SIZE } from "@/camera/CameraShot";
import type { ShotSize } from "@/camera/CameraShot";
import { ShotSizePresets } from "@/camera/ShotSizePresets";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";

const shotSizePresets = new ShotSizePresets();
const SAVE_SHOT_STATUS_ID = "director-desk-save-shot-status";
const MOTION_PRESET_STATUS_ID = "director-desk-motion-preset-status";
const PANEL_SECTION_GAP = 1;
const STATUS_TEXT_MARGIN_TOP = 0.5;
const DEFAULT_MOTION_DURATION_SECONDS = 2;
const MOTION_PRESET_GRID_COLUMNS = "repeat(2, minmax(0, 1fr))";
const BOX_SIZE_TO_RADIUS_DIVISOR = 2;
const DEFAULT_SHOT_AZIMUTH_RADIANS = Math.PI / 4;
const SHOT_SIZE_LABELS: Record<ShotSize, string> = {
    [SHOT_SIZE.EXTREME_LONG]: "大远景",
    [SHOT_SIZE.LONG]: "远景",
    [SHOT_SIZE.MEDIUM_LONG]: "中远景",
    [SHOT_SIZE.MEDIUM]: "中景",
    [SHOT_SIZE.MEDIUM_CLOSE]: "中近景",
    [SHOT_SIZE.CLOSE_UP]: "特写",
    [SHOT_SIZE.EXTREME_CLOSE_UP]: "大特写",
};
const MOTION_MOVES = Object.values(MOTION_MOVE) as readonly MotionMove[];



function motionPresetStatus(cameraId: string | null, remainingSeconds: number): string | null {
    if (cameraId === null) return "选择机位后可创建运镜预设";
    if (remainingSeconds <= 0) return "播放头已到达时间线末尾，无法容纳运镜片段";
    return null;
}

const SaveCurrentViewControl = observer(function SaveCurrentViewControl() {
    const stores = useDirectorDeskStores();
    const { camera, dispatcher } = stores;
    const available = camera.lastDirectorPose !== null;

    const saveCurrentView = () => {
        const pose = camera.lastDirectorPose;
        if (pose === null) return;
        const result = dispatcher.dispatch(
            {
                type: "camera.set-shot",
                payload: {
                    id: camera.nextShotName(),
                    shot: { position: pose.position, target: pose.target, fov: pose.fov },
                },
            },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    return (
        <>
            <Button
                size="small"
                variant="outlined"
                startIcon={<AddAPhotoIcon />}
                onClick={saveCurrentView}
                disabled={!available}
                aria-describedby={available ? undefined : SAVE_SHOT_STATUS_ID}
                fullWidth
            >
                当前视角存为机位
            </Button>
            {!available && (
                <Typography
                    id={SAVE_SHOT_STATUS_ID}
                    role="status"
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: STATUS_TEXT_MARGIN_TOP }}
                >
                    暂无可保存的自由视角
                </Typography>
            )}
        </>
    );
});
interface ShotSizeControlProps {
    readonly onShotSizeChange: (size: ShotSize) => void;
}

interface MotionPresetButtonsProps {
    readonly shotSizeRef: MutableRefObject<ShotSize>;
}

const ShotSizeControl = observer(function ShotSizeControl({ onShotSizeChange }: ShotSizeControlProps) {
    const stores = useDirectorDeskStores();
    const { camera, dispatcher, scene, selection } = stores;
    const [shotSize, setShotSize] = useState<ShotSize>(SHOT_SIZE.MEDIUM);
    const primaryRuntime = selection.primaryId ? scene.manager.getRuntime(selection.primaryId) : undefined;

    const applyShotSize = (size: ShotSize) => {
        setShotSize(size);
        onShotSizeChange(size);
        const primaryId = selection.primaryId;
        const runtime = primaryId ? scene.manager.getRuntime(primaryId) : undefined;
        if (!runtime) return;
        const box = new Box3().setFromObject(runtime);
        const center = new Vector3();
        const sphere = new Vector3();
        box.getCenter(center);
        box.getSize(sphere);
        const radius = sphere.length() / BOX_SIZE_TO_RADIUS_DIVISOR;
        const eye = camera.lastDirectorPose;
        const azimuth = eye
            ? Math.atan2(eye.position[2] - center.z, eye.position[0] - center.x)
            : DEFAULT_SHOT_AZIMUTH_RADIANS;
        const shot = shotSizePresets.resolve(size, [center.x, center.y, center.z], radius, azimuth);
        const result = dispatcher.dispatch(
            { type: "camera.set-shot", payload: { id: camera.nextShotName(), shot: shot.toJSON() } },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    return (
        <>
            <Typography variant="caption" color="text.secondary">
                景别(作用于选中对象)
            </Typography>
            <Select
                size="small"
                fullWidth
                value={shotSize}
                onChange={(event) => applyShotSize(event.target.value as ShotSize)}
                disabled={!primaryRuntime}
                aria-label="景别"
            >
                {Object.entries(SHOT_SIZE_LABELS).map(([size, label]) => (
                    <MenuItem key={size} value={size}>
                        {label}
                    </MenuItem>
                ))}
            </Select>
        </>
    );
});

const MotionPresetButtons = observer(function MotionPresetButtons({ shotSizeRef }: MotionPresetButtonsProps) {
    const stores = useDirectorDeskStores();
    const { camera, dispatcher, motionAuthoring, playheadDisplay, scene, selection, timeline } = stores;
    const cameraId = selection.selectedIds.find((id) => camera.director.getShot(id) !== undefined) ?? null;
    const subjectId = selection.selectedIds.find((id) => scene.manager.getEntity(id) !== undefined) ?? null;
    const playhead = Math.min(playheadDisplay.value, timeline.document.duration);
    const remainingSeconds = timeline.document.duration - playhead;
    const durationSeconds = Math.min(DEFAULT_MOTION_DURATION_SECONDS, remainingSeconds);
    const presetStatus = motionPresetStatus(cameraId, remainingSeconds);

    const authorMotion = (move: MotionMove) => {
        if (cameraId === null || presetStatus !== null) return;
        const result = dispatcher.dispatch(
            {
                type: "motion.author",
                payload: {
                    cameraId,
                    startTimeSeconds: playhead,
                    durationSeconds,
                    move,
                    ...(subjectId === null ? {} : { subjectId }),
                    shotSize: shotSizeRef.current,
                    easing: CAMERA_MOTION_EASING.SMOOTH,
                },
            },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    return (
        <>
            <Typography variant="subtitle2">运镜预设</Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: MOTION_PRESET_GRID_COLUMNS, gap: STATUS_TEXT_MARGIN_TOP }}>
                {MOTION_MOVES.map((move) => (
                    <Button
                        key={move}
                        size="small"
                        variant="outlined"
                        disabled={presetStatus !== null}
                        aria-describedby={presetStatus === null ? undefined : MOTION_PRESET_STATUS_ID}
                        onClick={() => authorMotion(move)}
                    >
                        {MOTION_MOVE_LABEL[move]}
                    </Button>
                ))}
            </Box>
            {presetStatus !== null && (
                <Typography
                    id={MOTION_PRESET_STATUS_ID}
                    role="status"
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: STATUS_TEXT_MARGIN_TOP }}
                >
                    {presetStatus}
                </Typography>
            )}
            <Button
                size="small"
                fullWidth
                sx={{ mt: PANEL_SECTION_GAP }}
                aria-pressed={motionAuthoring.pathVisible}
                onClick={() => motionAuthoring.setPathVisible(!motionAuthoring.pathVisible)}
            >
                {motionAuthoring.pathVisible ? "隐藏运镜路径" : "显示运镜路径"}
            </Button>
        </>
    );
});

const ShotSizeAndMotionPresets = observer(function ShotSizeAndMotionPresets() {
    const shotSizeRef = useRef<ShotSize>(SHOT_SIZE.MEDIUM);

    return (
        <>
            <ShotSizeControl onShotSizeChange={(size) => (shotSizeRef.current = size)} />
            <Divider sx={{ my: PANEL_SECTION_GAP }} />
            <MotionPresetButtons shotSizeRef={shotSizeRef} />
        </>
    );
});

/** 左栏 CAMERA 只承担机位存盘、景别预设与语义运镜预设。 */
export const ShotPanel = observer(function ShotPanel() {
    return (
        <Box sx={{ p: 1.5 }}>
            <SaveCurrentViewControl />
            <Divider sx={{ my: PANEL_SECTION_GAP }} />
            <ShotSizeAndMotionPresets />
        </Box>
    );
});
