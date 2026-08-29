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
import { CAMERA_MOTION_EASING } from "../camera/CameraMotionPath";
import { ShotSizePresets } from "../camera/ShotSizePresets";
import { ContinuitySection } from "./ContinuitySection";
import { useDirectorDeskStores } from "./DirectorDeskContext";

const shotSizePresets = new ShotSizePresets();
const OVERLAY_INSET_PX = 12;
const SHOT_PANEL_WIDTH = 240;
const SAVE_SHOT_STATUS_ID = "director-desk-save-shot-status";
const OVERLAY_MAX_SIZE = "calc(100% - 24px)";
const ROW_ACTIONS_PADDING = 10;
const ROW_ACTIONS_GAP = 0.25;
const SNACKBAR_DURATION_MS = 4000;
const PANEL_SECTION_GAP = 1;
const STATUS_TEXT_MARGIN_TOP = 0.5;

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

/** 运镜编辑只发 dispatcher 命令；预览开关是本桌局部 UI 状态。 */
const MotionSection = observer(function MotionSection({
    previewVisible,
    onPreviewVisibleChange,
    onNotice,
}: MotionSectionProps) {
    const stores = useDirectorDeskStores();
    const { camera, clock, dispatcher, motion } = stores;
    const path = motion.path;
    const canAddCurrentView = !clock.isPlaying && camera.activeShotId === null && camera.lastDirectorPose !== null;

    const dispatch = (type: string, payload: unknown) => {
        const result = dispatcher.dispatch({ type, payload }, stores);
        if (!result.ok) onNotice(result.issues?.join(";") ?? result.error);
    };

    return (
        <>
            <Typography variant="subtitle2">运镜({path?.keys.length ?? 0})</Typography>
            <Button
                size="small"
                variant="outlined"
                startIcon={<VideocamIcon />}
                fullWidth
                disabled={!canAddCurrentView}
                aria-describedby={canAddCurrentView ? undefined : "director-desk-motion-add-status"}
                onClick={() => dispatch("motion.add-key", {
                    id: crypto.randomUUID(),
                    timeSeconds: clock.time,
                    easing: CAMERA_MOTION_EASING.SMOOTH,
                })}
            >
                当前视角加关键帧
            </Button>
            {!canAddCurrentView && (
                <Typography id="director-desk-motion-add-status" role="status" variant="caption" color="text.secondary">
                    需暂停、回到导演自由视角并等待视角稳定
                </Typography>
            )}
            <Button
                size="small"
                fullWidth
                sx={{ mt: 0.5 }}
                aria-pressed={previewVisible}
                onClick={() => onPreviewVisibleChange(!previewVisible)}
            >
                {previewVisible ? "隐藏运镜轨迹" : "显示运镜轨迹"}
            </Button>
            {path?.keys.map((key) => (
                <Box key={`${key.id}:${key.timeSeconds}`} sx={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 0.5, mt: 0.5, alignItems: "center" }}>
                    <TextField
                        size="small"
                        type="number"
                        label="时间(秒)"
                        defaultValue={key.timeSeconds}
                        aria-label={`运镜关键帧 ${key.id} 时间`}
                        slotProps={{ htmlInput: { min: 0, max: stores.timeline.document.duration, step: 0.1 } }}
                        onBlur={(event) => {
                            const rawTime = event.currentTarget.value;
                            const timeSeconds = rawTime.length === 0 ? Number.NaN : Number(rawTime);
                            if (Number.isFinite(timeSeconds) && timeSeconds !== key.timeSeconds) {
                                dispatch("motion.move-key", { id: key.id, timeSeconds });
                            }
                        }}
                    />
                    <Select
                        size="small"
                        value={key.easing}
                        aria-label={`运镜关键帧 ${key.id} 缓动`}
                        onChange={(event) => dispatch("motion.set-key-easing", { id: key.id, easing: event.target.value })}
                    >
                        <MenuItem value={CAMERA_MOTION_EASING.LINEAR}>linear</MenuItem>
                        <MenuItem value={CAMERA_MOTION_EASING.SMOOTH}>smooth</MenuItem>
                    </Select>
                    <Button
                        size="small"
                        color="error"
                        sx={{ gridColumn: "1 / -1" }}
                        aria-label={`删除运镜关键帧 ${key.id}，${key.timeSeconds.toFixed(2)} 秒`}
                        onClick={() => dispatch("motion.remove-key", { id: key.id })}
                    >
                        删除关键帧
                    </Button>
                </Box>
            ))}
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
                position: "absolute",
                left: OVERLAY_INSET_PX,
                bottom: OVERLAY_INSET_PX,
                width: SHOT_PANEL_WIDTH,
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
            <Divider sx={{ my: PANEL_SECTION_GAP }} />
            <ContinuitySection onNotice={setNotice} />
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
