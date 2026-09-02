import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import { DEFAULT_PRESET_DURATION_SECONDS, MOTION_MOVE, MOTION_MOVE_LABEL } from "@/authoring/MotionPresetCompiler";
import type { MotionMove } from "@/authoring/MotionPresetCompiler";
import { CAMERA_MOTION_EASING } from "@/camera/CameraMotionEasing";
import type { CameraShot, ShotSize } from "@/camera/CameraShot";
import { ShotSizePresets } from "@/camera/ShotSizePresets";
import { subjectBoundsFor } from "@/command/subjectBounds";
import type { SubjectBounds } from "@/command/subjectBounds";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { SHOT_SIZE_LABELS } from "@/ui/shots/shotSizeLabels";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";

const FIELD_GAP = 0.75;
const PRESET_GRID_COLUMNS = "repeat(2, minmax(0, 1fr))";
const MOTION_PRESET_STATUS_ID = "director-desk-motion-preset-status";
const NO_SUBJECT = "none";
const FOLLOW_SHOT_SIZE = "follow";
const DISTANCE_DECIMALS = 2;

const MOTION_MOVES = Object.values(MOTION_MOVE) as readonly MotionMove[];
const shotSizePresets = new ShotSizePresets();

/** 落幅景别是可选参数:选「保持机位」时预设只做位移,不按被摄体重新定距。 */
type LandingShotSize = ShotSize | typeof FOLLOW_SHOT_SIZE;

interface LandingPreview {
    readonly shot: CameraShot;
    readonly distance: number;
}

/** 落幅预演:同一套 ShotSizePresets 解出末帧机位,面板据此给出可校验的距离读数。 */
function landingPreviewFor(
    stores: DirectorDeskStores,
    cameraId: string,
    shotSize: ShotSize | null,
    subject: SubjectBounds | null,
): LandingPreview | null {
    const shot = stores.camera.director.getShot(cameraId);
    if (!shot || !shotSize || !subject) return null;
    const offsetX = shot.position[0] - subject.center[0];
    const offsetZ = shot.position[2] - subject.center[2];
    const landing = shotSizePresets.resolve(shotSize, subject.center, subject.radius, Math.atan2(offsetZ, offsetX));
    return {
        shot: landing,
        distance: Math.hypot(
            landing.position[0] - subject.center[0],
            landing.position[1] - subject.center[1],
            landing.position[2] - subject.center[2],
        ),
    };
}

/**
 * 机位面板里的运镜预设区。
 *
 * 预设天然与一台机位绑定(从它的当前姿态推导落幅),故住在机位的情境面板而非左栏全局面板。
 * 被摄目标与落幅景别都住在编排 Store:面板开合属壳层行为,不该把作者的编排选择清零。
 */
export const MotionPresetControls = observer(function MotionPresetControls({ cameraId }: { cameraId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motionAuthoring, playheadDisplay, scene, timeline } = stores;
    const playhead = Math.min(playheadDisplay.value, timeline.document.duration);
    const durationSeconds = Math.min(DEFAULT_PRESET_DURATION_SECONDS, timeline.document.duration - playhead);
    const subjects = scene.manager.list().filter((entity) => entity.kind === "model");
    const subjectId = motionAuthoring.subjectId;
    const hasSubject = subjectId !== null && scene.manager.getEntity(subjectId) !== undefined;
    const subject = hasSubject ? subjectBoundsFor(stores, subjectId) : null;
    const landingShotSize = motionAuthoring.landingShotSize;
    const landing = landingPreviewFor(stores, cameraId, landingShotSize, subject);
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
                    ...(hasSubject ? { subjectId } : {}),
                    ...(landing ? { shotSize: landingShotSize } : {}),
                    easing: CAMERA_MOTION_EASING.SMOOTH,
                },
            },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    /** 把落幅构图直接用作起幅:作者想「先摆到这个景别再运镜」时的显式出口,可撤销。 */
    const applyLandingToShot = (): void => {
        if (!landing) return;
        const result = dispatcher.dispatch(
            { type: "camera.set-shot", payload: { id: cameraId, shot: landing.shot.toJSON() } },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP }}>
            <Typography variant="subtitle2">运镜预设</Typography>
            <Select
                size="small"
                value={hasSubject ? subjectId : NO_SUBJECT}
                onChange={(event) =>
                    motionAuthoring.setSubject(event.target.value === NO_SUBJECT ? null : event.target.value)
                }
                aria-label="被摄目标"
            >
                <MenuItem value={NO_SUBJECT}>被摄目标：无(镜头自由运动)</MenuItem>
                {subjects.map((entity) => (
                    <MenuItem key={entity.id} value={entity.id}>
                        被摄目标：{entity.name}
                    </MenuItem>
                ))}
            </Select>
            <Select
                size="small"
                value={landingShotSize ?? FOLLOW_SHOT_SIZE}
                disabled={!hasSubject}
                onChange={(event) => {
                    const value = event.target.value as LandingShotSize;
                    motionAuthoring.setLandingShotSize(value === FOLLOW_SHOT_SIZE ? null : value);
                }}
                aria-label="落幅景别"
            >
                <MenuItem value={FOLLOW_SHOT_SIZE}>落幅景别：保持机位</MenuItem>
                {Object.entries(SHOT_SIZE_LABELS).map(([size, label]) => (
                    <MenuItem key={size} value={size}>
                        落幅景别：{label}
                    </MenuItem>
                ))}
            </Select>
            {!hasSubject && (
                <Typography variant="caption" color="text.secondary">
                    落幅景别按被摄体包围球定距,先选被摄目标才会生效。
                </Typography>
            )}
            {landing && (
                <>
                    <Typography variant="caption" color="text.secondary">
                        运镜将收尾在距被摄体 {landing.distance.toFixed(DISTANCE_DECIMALS)} 处;机位当前姿态即起幅。
                    </Typography>
                    <Button size="small" onClick={applyLandingToShot}>
                        把机位摆到该景别(作为起幅)
                    </Button>
                </>
            )}
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
