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
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import { Box3, Vector3 } from "three";

import { SHOT_SIZE } from "../camera/CameraShot";
import type { ShotSize } from "../camera/CameraShot";
import { ShotSizePresets } from "../camera/ShotSizePresets";
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

/** 机位面板(左下):机位 CRUD、当前视角存机位与景别预设。 */
const ShotList = observer(function ShotList() {
    const stores = useDirectorDeskStores();
    const { camera, dispatcher, selection } = stores;
    void camera.revision;
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
                                    <IconButton size="small" edge="end" aria-label={`删除 ${id}`} onClick={() => removeShot(id)}>
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
        onNotice(result.ok ? `已生成 ${id}` : result.issues?.join(";") ?? result.error);
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

export const ShotPanel = observer(function ShotPanel() {
    const stores = useDirectorDeskStores();
    const { camera, dispatcher } = stores;
    const [notice, setNotice] = useState<string | null>(null);
    const [savedDirectorPoseAvailable, setSavedDirectorPoseAvailable] = useState(
        () => camera.lastDirectorPose !== null,
    );
    const canSaveCurrentView = savedDirectorPoseAvailable || camera.lastDirectorPose !== null;

    useEffect(() => {
        const frameId = window.requestAnimationFrame(() => {
            setSavedDirectorPoseAvailable(camera.lastDirectorPose !== null);
        });
        return () => window.cancelAnimationFrame(frameId);
    }, [camera, camera.activeShotId, camera.revision]);

    const saveCurrentView = () => {
        const pose = camera.lastDirectorPose;
        if (!pose) {
            setSavedDirectorPoseAvailable(false);
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
