import AddAPhotoIcon from "@mui/icons-material/AddAPhoto";
import DeleteIcon from "@mui/icons-material/Delete";
import VideocamIcon from "@mui/icons-material/Videocam";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Snackbar from "@mui/material/Snackbar";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { Box3, Vector3 } from "three";

import { SHOT_SIZE } from "../camera/CameraShot";
import type { ShotSize } from "../camera/CameraShot";
import { CAMERA_MOTION_EASING } from "../camera/CameraMotionClip";
import { FOCUS_TARGET_KIND } from "../camera/CameraFocusTrack";
import { ShotSizePresets } from "../camera/ShotSizePresets";
import type { CameraMotionClip } from "../camera/CameraMotionClip";
import type { CameraMotionPathJSON } from "../camera/CameraMotionPath";
import type { Vec3 } from "../core/SceneObject";
import { useDirectorDeskStores } from "./DirectorDeskContext";

const shotSizePresets = new ShotSizePresets();
const SAVE_SHOT_STATUS_ID = "director-desk-save-shot-status";
const OVERLAY_MAX_SIZE = "calc(100% - 24px)";
const ROW_ACTIONS_PADDING = 10;
const ROW_ACTIONS_GAP = 0.25;
const SNACKBAR_DURATION_MS = 4000;
const PANEL_SECTION_GAP = 1;
const STATUS_TEXT_MARGIN_TOP = 0.5;
const DEFAULT_MOTION_DURATION_SECONDS = 2;
const BEZIER_CONTROL_DIVISOR = 3;
const PATH_VECTOR_FIELDS = ["inHandle", "outHandle"] as const;
const PATH_VECTOR_AXIS_LABELS = ["X", "Y", "Z"] as const;

type PathVectorField = (typeof PATH_VECTOR_FIELDS)[number];

function withVectorCoordinate(vector: Vec3, axis: number, value: number): Vec3 {
    switch (axis) {
        case 0:
            return [value, vector[1], vector[2]];
        case 1:
            return [vector[0], value, vector[2]];
        default:
            return [vector[0], vector[1], value];
    }
}

function appendCurveAnchor(path: CameraMotionPathJSON, position: Vec3, id: string): CameraMotionPathJSON {
    const anchors = path.anchors;
    const previous = anchors[anchors.length - 1];
    if (!previous) return path;
    const outgoingHandle: Vec3 = [
        (position[0] - previous.position[0]) / BEZIER_CONTROL_DIVISOR,
        (position[1] - previous.position[1]) / BEZIER_CONTROL_DIVISOR,
        (position[2] - previous.position[2]) / BEZIER_CONTROL_DIVISOR,
    ];
    const incomingHandle: Vec3 = [-outgoingHandle[0], -outgoingHandle[1], -outgoingHandle[2]];
    const updatedAnchors = anchors.map((anchor) =>
        anchor.id === previous.id ? { ...anchor, outHandle: outgoingHandle } : anchor,
    );
    return { anchors: [...updatedAnchors, { id, position, inHandle: incomingHandle, outHandle: [0, 0, 0] }] };
}

function replaceAnchorVector(
    clip: CameraMotionClip,
    anchorId: string,
    field: PathVectorField,
    axis: number,
    value: number,
): CameraMotionPathJSON {
    return {
        anchors: clip.path.anchors.map((anchor) => {
            const json = anchor.toJSON();
            return anchor.id === anchorId ? { ...json, [field]: withVectorCoordinate(json[field], axis, value) } : json;
        }),
    };
}

const SHOT_SIZE_LABELS: Record<ShotSize, string> = {
    [SHOT_SIZE.EXTREME_LONG]: "大远景",
    [SHOT_SIZE.LONG]: "远景",
    [SHOT_SIZE.MEDIUM_LONG]: "中远景",
    [SHOT_SIZE.MEDIUM]: "中景",
    [SHOT_SIZE.MEDIUM_CLOSE]: "中近景",
    [SHOT_SIZE.CLOSE_UP]: "特写",
    [SHOT_SIZE.EXTREME_CLOSE_UP]: "大特写",
};

interface ShotSizeControlProps {
    onNotice: (message: string) => void;
}

interface SaveCurrentViewControlProps {
    available: boolean;
    onSave: () => void;
}

interface ShotPanelProps {
    readonly motionPreviewVisible: boolean;
    readonly onMotionPreviewVisibleChange: (visible: boolean) => void;
}

/** 机位面板(左下):机位 CRUD、当前视角存机位与景别预设。 */
const ShotList = observer(function ShotList() {
    const stores = useDirectorDeskStores();
    const { camera, dispatcher, selection } = stores;
    const shots = camera.director.listShots();

    const removeShot = (id: string) => {
        const result = dispatcher.dispatch({ type: "camera.remove-shot", payload: { id } }, stores);
        if (result.ok) selection.remove(id);
    };

    return (
        <>
            <Typography variant="subtitle2">机位({shots.length})</Typography>
            <List dense disablePadding aria-label="机位列表">
                {shots.map(([id]) => {
                    const active = camera.activeShotId === id;
                    return (
                        <ListItem
                            key={id}
                            disablePadding
                            secondaryAction={
                                <Box sx={{ display: "flex", gap: ROW_ACTIONS_GAP }}>
                                    <IconButton
                                        size="small"
                                        edge="end"
                                        color={active ? "primary" : "default"}
                                        aria-label={active ? `回导演视角 ${id}` : `掌镜 ${id}`}
                                        onClick={() =>
                                            dispatcher.dispatch(
                                                {
                                                    type: active ? "camera.deactivate" : "camera.activate",
                                                    payload: active ? {} : { id },
                                                },
                                                stores,
                                            )
                                        }
                                    >
                                        <VideocamIcon fontSize="small" />
                                    </IconButton>
                                    <IconButton
                                        size="small"
                                        edge="end"
                                        aria-label={`删除 ${id}`}
                                        onClick={() => removeShot(id)}
                                    >
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </Box>
                            }
                        >
                            <ListItemButton
                                selected={selection.isSelected(id)}
                                onClick={() => selection.select(id)}
                                sx={{ pr: ROW_ACTIONS_PADDING }}
                            >
                                <ListItemText primary={id} secondary={active ? "掌镜中" : undefined} />
                            </ListItemButton>
                        </ListItem>
                    );
                })}
            </List>
        </>
    );
});


const SaveCurrentViewControl = observer(function SaveCurrentViewControl({
    available,
    onSave,
}: SaveCurrentViewControlProps) {
    return (
        <>
            <Button
                size="small"
                variant="outlined"
                startIcon={<AddAPhotoIcon />}
                onClick={onSave}
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
                    暂无可保存的导演视角
                </Typography>
            )}
        </>
    );
});

interface MotionSectionProps {
    readonly previewVisible: boolean;
    readonly onPreviewVisibleChange: (visible: boolean) => void;
    readonly onNotice: (message: string) => void;
}

/** Motion authoring starts from a selected static camera and a settled free editor view. */
const MotionSection = observer(function MotionSection({
    previewVisible,
    onPreviewVisibleChange,
    onNotice,
}: MotionSectionProps) {
    const stores = useDirectorDeskStores();
    const { camera, clock, dispatcher, motion, scene, selection, timeline } = stores;
    const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
    const selectedCameraId = selection.primaryId;
    const selectedShot = selectedCameraId ? camera.director.getShot(selectedCameraId) : undefined;
    const directorPose = camera.lastDirectorPose;
    const selectedClip = selectedClipId ? motion.clip(selectedClipId) : undefined;
    const selectedSceneObject = selection.primaryId ? scene.manager.getEntity(selection.primaryId) : undefined;
    const focusTarget = selectedClip?.focus.target;
    const canBindFocusObject = selectedClip !== undefined && selectedSceneObject !== undefined;
    const canRestoreWorldFocus = selectedClip !== undefined && directorPose !== null;
    const remainingSeconds = timeline.document.duration - clock.time;
    const durationSeconds = Math.min(DEFAULT_MOTION_DURATION_SECONDS, remainingSeconds);
    const canCreateMotion =
        !clock.isPlaying && selectedCameraId !== null && selectedShot !== undefined && directorPose !== null && durationSeconds > 0;
    const canAppendAnchor = !clock.isPlaying && selectedClip !== undefined && directorPose !== null;

    const dispatch = (type: string, payload: unknown) => {
        const result = dispatcher.dispatch({ type, payload }, stores);
        if (!result.ok) onNotice(result.issues?.join(";") ?? result.error);
    };

    const createMotionClip = () => {
        if (!selectedCameraId || !selectedShot || !directorPose) return;
        const clipId = crypto.randomUUID();
        dispatch("motion.create-clip", {
            clip: {
                id: clipId,
                cameraId: selectedCameraId,
                startTimeSeconds: clock.time,
                durationSeconds,
                focus: { target: { kind: FOCUS_TARGET_KIND.WORLD_POINT, position: directorPose.target } },
                easing: CAMERA_MOTION_EASING.SMOOTH,
                path: {
                    anchors: [
                        { id: `${clipId}-start`, position: selectedShot.position },
                        { id: `${clipId}-end`, position: directorPose.position },
                    ],
                },
            },
        });
        setSelectedClipId(clipId);
    };

    const appendAnchor = () => {
        if (!selectedClip || !directorPose) return;
        dispatch("motion.set-clip-path", {
            id: selectedClip.id,
            path: appendCurveAnchor(selectedClip.path.toJSON(), directorPose.position, crypto.randomUUID()),
        });
    };

    const updateAnchorVector = (anchorId: string, field: PathVectorField, axis: number, rawValue: string) => {
        const value = rawValue.length === 0 ? Number.NaN : Number(rawValue);
        if (!selectedClip || !Number.isFinite(value)) return;
        dispatch("motion.set-clip-path", {
            id: selectedClip.id,
            path: replaceAnchorVector(selectedClip, anchorId, field, axis, value),
        });
    };

    return (
        <>
            <Typography variant="subtitle2">运镜片段({motion.clips.length})</Typography>
            <Button
                size="small"
                variant="outlined"
                startIcon={<VideocamIcon />}
                fullWidth
                disabled={!canCreateMotion}
                aria-describedby={canCreateMotion ? undefined : "director-desk-motion-create-status"}
                onClick={createMotionClip}
            >
                从机位到当前视角创建运镜
            </Button>
            {!canCreateMotion && (
                <Typography id="director-desk-motion-create-status" role="status" variant="caption" color="text.secondary">
                    选择机位，暂停播放后在自由视口确定终点
                </Typography>
            )}
            <Button
                size="small"
                fullWidth
                sx={{ mt: 0.5 }}
                aria-pressed={previewVisible}
                onClick={() => onPreviewVisibleChange(!previewVisible)}
            >
                {previewVisible ? "隐藏运镜路径" : "显示运镜路径"}
            </Button>
            {motion.clips.map((clip) => (
                <Box
                    key={clip.id}
                    sx={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 0.5, mt: 0.5, alignItems: "center" }}
                >
                    <Button
                        size="small"
                        variant={selectedClip?.id === clip.id ? "contained" : "text"}
                        sx={{ justifyContent: "flex-start", overflow: "hidden", whiteSpace: "nowrap" }}
                        onClick={() => setSelectedClipId(clip.id)}
                    >
                        {clip.cameraId} · {clip.startTimeSeconds.toFixed(2)}s — {clip.endTimeSeconds.toFixed(2)}s
                    </Button>
                    <Button
                        size="small"
                        color="error"
                        aria-label={`删除 ${clip.cameraId} 运镜片段`}
                        onClick={() => {
                            dispatch("motion.remove-clip", { id: clip.id });
                            if (selectedClip?.id === clip.id) setSelectedClipId(null);
                        }}
                    >
                        删除
                    </Button>
                </Box>
            ))}
            {selectedClip && focusTarget && (
                <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: "divider" }}>
                    <Typography variant="caption" color="text.secondary">
                        注视：
                        {focusTarget.kind === FOCUS_TARGET_KIND.SCENE_OBJECT
                            ? `绑定 ${focusTarget.objectId}`
                            : `世界点 ${focusTarget.position.map((value) => value.toFixed(1)).join(", ")}`}
                    </Typography>
                    <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.5, mt: 0.5 }}>
                        <Button
                            size="small"
                            disabled={!canBindFocusObject}
                            onClick={() => {
                                if (!selectedSceneObject) return;
                                dispatch("motion.set-focus", {
                                    id: selectedClip.id,
                                    target: {
                                        kind: FOCUS_TARGET_KIND.SCENE_OBJECT,
                                        objectId: selectedSceneObject.id,
                                        worldOffset: [0, 0, 0],
                                    },
                                });
                            }}
                        >
                            绑定选中对象
                        </Button>
                        <Button
                            size="small"
                            disabled={!canRestoreWorldFocus}
                            onClick={() => {
                                if (!directorPose) return;
                                dispatch("motion.set-focus", {
                                    id: selectedClip.id,
                                    target: { kind: FOCUS_TARGET_KIND.WORLD_POINT, position: directorPose.target },
                                });
                            }}
                        >
                            固定当前注视点
                        </Button>
                    </Box>
                </Box>
            )}
            {selectedClip && (
                <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: "divider" }}>
                    <Typography variant="caption" color="text.secondary">
                        路径锚点({selectedClip.path.anchors.length}) · 手柄为相对坐标
                    </Typography>
                    <Button size="small" fullWidth disabled={!canAppendAnchor} onClick={appendAnchor} sx={{ mt: 0.5 }}>
                        当前视角追加曲线路径点
                    </Button>
                    {selectedClip.path.anchors.map((anchor, anchorIndex) => (
                        <Box key={anchor.id} sx={{ mt: 0.75 }}>
                            <Typography variant="caption">
                                锚点 {anchorIndex + 1} · {anchor.position.map((value) => value.toFixed(1)).join(", ")}
                            </Typography>
                            {PATH_VECTOR_FIELDS.map((field) => (
                                <Box key={field} sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0.5, mt: 0.25 }}>
                                    {anchor[field].map((value, axis) => (
                                        <TextField
                                            key={`${field}-${axis}`}
                                            size="small"
                                            type="number"
                                            label={`${field === "inHandle" ? "入" : "出"}${PATH_VECTOR_AXIS_LABELS[axis] ?? ""}`}
                                            defaultValue={value}
                                            slotProps={{ htmlInput: { step: 0.1 } }}
                                            onBlur={(event) => updateAnchorVector(anchor.id, field, axis, event.currentTarget.value)}
                                        />
                                    ))}
                                </Box>
                            ))}
                        </Box>
                    ))}
                </Box>
            )}
        </>
    );
});

const ShotSizeControl = observer(function ShotSizeControl({ onNotice }: ShotSizeControlProps) {
    const stores = useDirectorDeskStores();
    const { camera, scene, selection, dispatcher } = stores;
    const [shotSize, setShotSize] = useState<ShotSize>(SHOT_SIZE.MEDIUM);
    const primaryRuntime = selection.primaryId ? scene.manager.getRuntime(selection.primaryId) : undefined;

    const applyShotSize = (size: ShotSize) => {
        setShotSize(size);
        const primaryId = selection.primaryId;
        const runtime = primaryId ? scene.manager.getRuntime(primaryId) : undefined;
        if (!runtime) return;
        const box = new Box3().setFromObject(runtime);
        const center = new Vector3();
        const sphere = new Vector3();
        box.getCenter(center);
        box.getSize(sphere);
        const radius = sphere.length() / 2;
        const eye = camera.lastDirectorPose;
        const azimuth = eye ? Math.atan2(eye.position[2] - center.z, eye.position[0] - center.x) : Math.PI / 4;
        const shot = shotSizePresets.resolve(size, [center.x, center.y, center.z], radius, azimuth);
        const id = camera.nextShotName();
        const result = dispatcher.dispatch({ type: "camera.set-shot", payload: { id, shot: shot.toJSON() } }, stores);
        onNotice(result.ok ? `已生成 ${id}` : (result.issues?.join(";") ?? result.error));
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

export const ShotPanel = observer(function ShotPanel({
    motionPreviewVisible,
    onMotionPreviewVisibleChange,
}: ShotPanelProps) {
    const stores = useDirectorDeskStores();
    const { camera, dispatcher } = stores;
    const [notice, setNotice] = useState<string | null>(null);
    const canSaveCurrentView = camera.lastDirectorPose !== null;

    const saveCurrentView = () => {
        const pose = camera.lastDirectorPose;
        if (!pose) {
            return;
        }
        dispatcher.dispatch(
            {
                type: "camera.set-shot",
                payload: {
                    id: camera.nextShotName(),
                    shot: { position: pose.position, target: pose.target, fov: pose.fov },
                },
            },
            stores,
        );
    };

    return (
        <Paper
            elevation={2}
            sx={{
                width: "100%",
                maxWidth: OVERLAY_MAX_SIZE,
                maxHeight: OVERLAY_MAX_SIZE,
                overflowY: "auto",
                p: 1.5,
                zIndex: 1,
            }}
        >
            <ShotList />
            <SaveCurrentViewControl available={canSaveCurrentView} onSave={saveCurrentView} />
            <Divider sx={{ my: PANEL_SECTION_GAP }} />
            <ShotSizeControl onNotice={setNotice} />
            <Divider sx={{ my: PANEL_SECTION_GAP }} />
            <MotionSection
                previewVisible={motionPreviewVisible}
                onPreviewVisibleChange={onMotionPreviewVisibleChange}
                onNotice={setNotice}
            />
            <Snackbar
                open={notice !== null}
                autoHideDuration={SNACKBAR_DURATION_MS}
                onClose={() => setNotice(null)}
                message={notice}
                anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
            />
        </Paper>
    );
});
