import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { observer } from "mobx-react-lite";

import { CAMERA_MOTION_EASING } from "@/camera/CameraMotionEasing";
import { FOCUS_TARGET_KIND } from "@/camera/CameraFocusTrack";
import type { CameraKey } from "@/camera/CameraKey";
import type { CameraMotionClip } from "@/camera/CameraMotionClip";
import type { Vec3 } from "@/core/SceneObject";
import { MOTION_HANDLE_MODE } from "@/motion/MotionKey";
import { RemoveMotionKeyCommand } from "@/command/cameraMotionCommands";
import { MotionPresetControls } from "@/ui/inspector/MotionPresetControls";
import { formatShortcutHint, SHORTCUT_ID } from "@/shortcuts/builtinShortcuts";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";

const FIELD_GAP = 0.75;
const FIELD_GRID_COLUMNS = "repeat(3, minmax(0, 1fr))";
const KEY_ROW_GRID_COLUMNS = "1fr auto";
const NUMBER_STEP = 0.1;
const ORIGIN: Vec3 = [0, 0, 0];
const AXIS_X = 0;
const AXIS_Y = 1;
const AXIS_Z = 2;
const AXES = [
    { label: "X", index: AXIS_X },
    { label: "Y", index: AXIS_Y },
    { label: "Z", index: AXIS_Z },
] as const;
const POSE_GROUPS = [
    { label: "位置", property: "position" },
    { label: "注视", property: "target" },
] as const;
const HANDLE_GROUPS = [
    { label: "入手柄", kind: "in", property: "inHandle" },
    { label: "出手柄", kind: "out", property: "outHandle" },
] as const;

function replaceAxis(vector: Vec3, index: (typeof AXES)[number]["index"], value: number): Vec3 {
    switch (index) {
        case AXIS_X:
            return [value, vector[AXIS_Y], vector[AXIS_Z]];
        case AXIS_Y:
            return [vector[AXIS_X], value, vector[AXIS_Z]];
        default:
            return [vector[AXIS_X], vector[AXIS_Y], value];
    }
}

function focusDescription(clip: CameraMotionClip): string {
    const target = clip.focus?.target;
    if (!target) return "未绑定";
    if (target.kind === FOCUS_TARGET_KIND.SCENE_OBJECT) return `绑定 ${target.objectId}`;
    return "固定世界点";
}


const MotionClipProperties = observer(function MotionClipProperties({ clipId }: { clipId: string }) {
    const { motion } = useDirectorDeskStores();
    const clip = motion.clip(clipId);

    if (!clip) return null;

    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP, p: FIELD_GAP }}>
            <Typography variant="subtitle2">片段属性</Typography>
            <Typography variant="caption" color="text.secondary">
                所属机位：{clip.cameraId}
            </Typography>
            <ClipRangeEditor clipId={clip.id} />
            <Divider />
            <ClipFocusControls clipId={clip.id} />
            <ClipActionControls clipId={clip.id} />
        </Box>
    );
});

const ClipRangeEditor = observer(function ClipRangeEditor({ clipId }: { clipId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion, ui } = stores;
    const clip = motion.clip(clipId);

    if (!clip) return null;

    const commitRange = (startTimeSeconds: number, durationSeconds: number) => {
        const result = dispatcher.dispatch(
            { type: "motion.set-clip-range", payload: { id: clip.id, startTimeSeconds, durationSeconds } },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    return (
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: FIELD_GAP }}>
            <TextField
                key={`${clip.id}-start-${clip.startTimeSeconds}`}
                size="small"
                type="number"
                label="起始时间"
                defaultValue={clip.startTimeSeconds}
                slotProps={{ htmlInput: { step: NUMBER_STEP } }}
                onBlur={(event) => {
                    const startTimeSeconds = Number(event.currentTarget.value);
                    if (!Number.isFinite(startTimeSeconds)) {
                        ui.setApplicationNotice("起始时间必须是有限数值");
                        return;
                    }
                    commitRange(startTimeSeconds, clip.durationSeconds);
                }}
            />
            <TextField
                key={`${clip.id}-duration-${clip.durationSeconds}`}
                size="small"
                type="number"
                label="时长"
                defaultValue={clip.durationSeconds}
                slotProps={{ htmlInput: { min: NUMBER_STEP, step: NUMBER_STEP } }}
                onBlur={(event) => {
                    const durationSeconds = Number(event.currentTarget.value);
                    if (!Number.isFinite(durationSeconds)) {
                        ui.setApplicationNotice("时长必须是有限数值");
                        return;
                    }
                    commitRange(clip.startTimeSeconds, durationSeconds);
                }}
            />
        </Box>
    );
});

const ClipFocusControls = observer(function ClipFocusControls({ clipId }: { clipId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion, scene, selection } = stores;
    const clip = motion.clip(clipId);
    const selectedObject = selection.primaryId ? scene.manager.getEntity(selection.primaryId) : undefined;

    if (!clip) return null;

    const bindFocus = () => {
        if (!selectedObject) return;
        const result = dispatcher.dispatch(
            {
                type: "motion.set-focus",
                payload: {
                    id: clip.id,
                    target: { kind: FOCUS_TARGET_KIND.SCENE_OBJECT, objectId: selectedObject.id, worldOffset: ORIGIN },
                },
            },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    const clearFocus = () => {
        const result = dispatcher.dispatch({ type: "motion.set-focus", payload: { id: clip.id, target: null } }, stores);
        reportCommandFailure(stores, result);
    };

    return (
        <>
            <Typography variant="caption" color="text.secondary">
                跟拍目标：{focusDescription(clip)}
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: FIELD_GAP }}>
                <Button size="small" disabled={!selectedObject} onClick={bindFocus}>
                    绑定选中对象
                </Button>
                <Button size="small" disabled={clip.focus === null} onClick={clearFocus}>
                    解除跟拍
                </Button>
            </Box>
        </>
    );
});

const ClipActionControls = observer(function ClipActionControls({ clipId }: { clipId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion, motionAuthoring } = stores;
    const clip = motion.clip(clipId);

    if (!clip) return null;

    const togglePreview = () => {
        const previewing = motionAuthoring.previewClipId === clip.id;
        const result = dispatcher.dispatch(
            previewing ? { type: "motion.preview.exit", payload: {} } : { type: "motion.preview.enter", payload: { clipId: clip.id } },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    const removeClip = () => {
        const result = dispatcher.dispatch({ type: "motion.remove-clip", payload: { id: clip.id } }, stores);
        reportCommandFailure(stores, result);
    };

    return (
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: FIELD_GAP }}>
            <Button size="small" variant="outlined" aria-pressed={motionAuthoring.previewClipId === clip.id} onClick={togglePreview}>
                {motionAuthoring.previewClipId === clip.id ? "退出镜头预览" : "镜头视角预览"}
            </Button>
            <Button size="small" color="error" onClick={removeClip}>
                删除片段
            </Button>
        </Box>
    );
});

const MotionKeyList = observer(function MotionKeyList({ clipId }: { clipId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion, motionAuthoring } = stores;
    const clip = motion.clip(clipId);

    if (!clip) return null;

    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP, p: FIELD_GAP }}>
            <Typography variant="subtitle2">关键帧 ({clip.keys.length})</Typography>
            {clip.keys.map((key) => {
                const selected = motionAuthoring.selectedKeyId === key.id;
                const timeSeconds = clip.timeAt(key.progress);
                return (
                    <Box key={key.id} sx={{ display: "grid", gridTemplateColumns: KEY_ROW_GRID_COLUMNS, gap: FIELD_GAP }}>
                        <Button
                            size="small"
                            variant={selected ? "contained" : "text"}
                            sx={{ justifyContent: "flex-start" }}
                            onClick={() => motionAuthoring.selectKey(clip.id, key.id)}
                        >
                            {timeSeconds.toFixed(2)}s
                        </Button>
                        <Box sx={{ display: "flex", gap: FIELD_GAP }}>
                            <Button
                                size="small"
                                onClick={() => {
                                    const result = dispatcher.dispatch({ type: "transport.seek", payload: { time: timeSeconds } }, stores);
                                    reportCommandFailure(stores, result);
                                }}
                            >
                                定位
                            </Button>
                            <Tooltip title={`删除关键帧 (${formatShortcutHint(SHORTCUT_ID.MOTION_KEY_DELETE)})`}>
                                <IconButton
                                    size="small"
                                    aria-label={`删除 ${timeSeconds.toFixed(2)} 秒的关键帧`}
                                    onClick={() => {
                                        const result = dispatcher.dispatch(
                                            { type: RemoveMotionKeyCommand.TYPE, payload: { clipId: clip.id, keyId: key.id } },
                                            stores,
                                        );
                                        reportCommandFailure(stores, result);
                                    }}
                                >
                                    <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    </Box>
                );
            })}
            <SelectedMotionKeyInspector clipId={clip.id} />
        </Box>
    );
});

const SelectedMotionKeyInspector = observer(function SelectedMotionKeyInspector({ clipId }: { clipId: string }) {
    const stores = useDirectorDeskStores();
    const { motion, motionAuthoring } = stores;
    const clip = motion.clip(clipId);
    const keyId = motionAuthoring.selectedKeyId;
    const key = clip && keyId ? clip.key(keyId) : undefined;

    if (!clip || !key) return null;

    return (
        <>
            <Divider />
            <KeyPoseFields clipId={clip.id} keyId={key.id} />
            <KeyEasingControl clipId={clip.id} keyId={key.id} />
            {key.handleMode === MOTION_HANDLE_MODE.MANUAL && <ManualHandleFields clipId={clip.id} keyId={key.id} />}
        </>
    );
});

const KeyPoseFields = observer(function KeyPoseFields({ clipId, keyId }: { clipId: string; keyId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion, ui } = stores;
    const clip = motion.clip(clipId);
    const key = clip?.key(keyId);

    if (!clip || !key) return null;

    const commitPose = (next: CameraKey) => {
        const result = dispatcher.dispatch({ type: "motion.set-key", payload: { clipId: clip.id, key: next.toJSON() } }, stores);
        reportCommandFailure(stores, result);
    };

    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP }}>
            <Typography variant="subtitle2">关键帧姿态</Typography>
            {clip.isFocusOverriding && (
                <Typography variant="caption" color="text.secondary">
                    注视由跟拍目标接管
                </Typography>
            )}
            {POSE_GROUPS.map((group) => (
                <Box key={group.property} sx={{ display: "grid", gap: FIELD_GAP }}>
                    <Typography variant="caption" color="text.secondary">
                        {group.label}
                    </Typography>
                    <Box sx={{ display: "grid", gridTemplateColumns: FIELD_GRID_COLUMNS, gap: FIELD_GAP }}>
                        {AXES.map((axis) => {
                            const vector = key[group.property];
                            const disabled = group.property === "target" && clip.isFocusOverriding;
                            return (
                                <TextField
                                    key={`${key.id}-${group.property}-${axis.index}-${vector[axis.index]}`}
                                    size="small"
                                    type="number"
                                    label={axis.label}
                                    defaultValue={vector[axis.index]}
                                    disabled={disabled}
                                    slotProps={{ htmlInput: { step: NUMBER_STEP } }}
                                    onBlur={(event) => {
                                        const value = Number(event.currentTarget.value);
                                        if (!Number.isFinite(value)) {
                                            ui.setApplicationNotice(`${group.label}${axis.label}必须是有限数值`);
                                            return;
                                        }
                                        const position =
                                            group.property === "position" ? replaceAxis(key.position, axis.index, value) : key.position;
                                        const target = group.property === "target" ? replaceAxis(key.target, axis.index, value) : key.target;
                                        commitPose(key.withPose({ position, target, fov: key.fov }));
                                    }}
                                />
                            );
                        })}
                    </Box>
                </Box>
            ))}
            <TextField
                key={`${key.id}-fov-${key.fov}`}
                size="small"
                type="number"
                label="视角 (FOV)"
                defaultValue={key.fov ?? ""}
                placeholder="跟随机位"
                slotProps={{ htmlInput: { step: NUMBER_STEP } }}
                onBlur={(event) => {
                    const rawValue = event.currentTarget.value;
                    const fov = rawValue.length === 0 ? null : Number(rawValue);
                    if (fov !== null && !Number.isFinite(fov)) {
                        ui.setApplicationNotice("视角必须是有限数值，或留空以跟随机位");
                        return;
                    }
                    commitPose(key.withPose({ position: key.position, target: key.target, fov }));
                }}
            />
        </Box>
    );
});

const KeyEasingControl = observer(function KeyEasingControl({ clipId, keyId }: { clipId: string; keyId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion } = stores;
    const clip = motion.clip(clipId);
    const key = clip?.key(keyId);

    if (!clip || !key) return null;

    const setEasing = (easing: (typeof CAMERA_MOTION_EASING)[keyof typeof CAMERA_MOTION_EASING]) => {
        const result = dispatcher.dispatch({ type: "motion.set-key-easing", payload: { clipId: clip.id, keyId: key.id, easing } }, stores);
        reportCommandFailure(stores, result);
    };

    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP }}>
            <Typography variant="caption" color="text.secondary">
                出段缓动
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: FIELD_GAP }}>
                <Button
                    size="small"
                    variant={key.easingOut === CAMERA_MOTION_EASING.LINEAR ? "contained" : "outlined"}
                    onClick={() => setEasing(CAMERA_MOTION_EASING.LINEAR)}
                >
                    线性
                </Button>
                <Button
                    size="small"
                    variant={key.easingOut === CAMERA_MOTION_EASING.SMOOTH ? "contained" : "outlined"}
                    onClick={() => setEasing(CAMERA_MOTION_EASING.SMOOTH)}
                >
                    平滑
                </Button>
            </Box>
        </Box>
    );
});

const ManualHandleFields = observer(function ManualHandleFields({ clipId, keyId }: { clipId: string; keyId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion, ui } = stores;
    const clip = motion.clip(clipId);
    const key = clip?.key(keyId);

    if (!clip || !key) return null;

    const resetHandles = () => {
        const result = dispatcher.dispatch({ type: "motion.reset-key-handles", payload: { clipId: clip.id, keyId: key.id } }, stores);
        reportCommandFailure(stores, result);
    };

    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP }}>
            <Divider />
            <Typography variant="subtitle2">高级手柄</Typography>
            {HANDLE_GROUPS.map((group) => (
                <Box key={group.kind} sx={{ display: "grid", gap: FIELD_GAP }}>
                    <Typography variant="caption" color="text.secondary">
                        {group.label}
                    </Typography>
                    <Box sx={{ display: "grid", gridTemplateColumns: FIELD_GRID_COLUMNS, gap: FIELD_GAP }}>
                        {AXES.map((axis) => {
                            const vector = key[group.property];
                            return (
                                <TextField
                                    key={`${key.id}-${group.kind}-${axis.index}-${vector[axis.index]}`}
                                    size="small"
                                    type="number"
                                    label={axis.label}
                                    defaultValue={vector[axis.index]}
                                    slotProps={{ htmlInput: { step: NUMBER_STEP } }}
                                    onBlur={(event) => {
                                        const value = Number(event.currentTarget.value);
                                        if (!Number.isFinite(value)) {
                                            ui.setApplicationNotice(`${group.label}${axis.label}必须是有限数值`);
                                            return;
                                        }
                                        const result = dispatcher.dispatch(
                                            {
                                                type: "motion.set-key-handle",
                                                payload: {
                                                    clipId: clip.id,
                                                    keyId: key.id,
                                                    kind: group.kind,
                                                    value: replaceAxis(vector, axis.index, value),
                                                },
                                            },
                                            stores,
                                        );
                                        reportCommandFailure(stores, result);
                                    }}
                                />
                            );
                        })}
                    </Box>
                </Box>
            ))}
            <Button size="small" onClick={resetHandles}>
                恢复自动手柄
            </Button>
        </Box>
    );
});

/**
 * 机位面板里的运镜区:一台机位的全部片段与选中片段的编辑。
 *
 * 运镜不是独立的选中对象——它属于某台机位,故与机位属性同住一个右栏面板,
 * 作者点机位标记就能顺势编排它的运镜,不必先在时间轴上找到片段。
 */
export const CameraMotionSection = observer(function CameraMotionSection({ cameraId }: { cameraId: string }) {
    const { motion, motionAuthoring } = useDirectorDeskStores();
    const clips = motion.clipsForCamera(cameraId);
    const selectedClip = motionAuthoring.selectedClipId ? motion.clip(motionAuthoring.selectedClipId) : undefined;
    const activeClip = selectedClip?.cameraId === cameraId ? selectedClip : undefined;

    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP, p: FIELD_GAP }}>
            <MotionPresetControls cameraId={cameraId} />
            <Divider />
            <Typography variant="subtitle2">运镜片段 ({clips.length})</Typography>
            {clips.length === 0 && (
                <Typography variant="caption" color="text.secondary">
                    该机位暂无运镜;用上方运镜预设或在时间线上创建。
                </Typography>
            )}
            {clips.map((clip) => (
                <Button
                    key={clip.id}
                    size="small"
                    variant={activeClip?.id === clip.id ? "contained" : "text"}
                    sx={{ justifyContent: "flex-start" }}
                    onClick={() => motionAuthoring.selectClip(clip.id)}
                >
                    {clip.startTimeSeconds.toFixed(2)}s — {clip.endTimeSeconds.toFixed(2)}s · {clip.keys.length} 关键帧
                </Button>
            ))}
            {activeClip && (
                <>
                    <Divider />
                    <MotionClipProperties clipId={activeClip.id} />
                    <Divider />
                    <MotionKeyList clipId={activeClip.id} />
                </>
            )}
        </Box>
    );
});
