import AddAPhotoIcon from "@mui/icons-material/AddAPhoto";
import DeleteIcon from "@mui/icons-material/Delete";
import VideocamIcon from "@mui/icons-material/Videocam";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react";
import { useState } from "react";
import { Box3, Vector3 } from "three";

import { SHOT_SIZE } from "../camera/CameraShot";
import type { ShotSize } from "../camera/CameraShot";
import { ShotSizePresets } from "../camera/ShotSizePresets";
import { FOV_MAX, FOV_MIN } from "../command/commands";
import { useDirectorDeskStores } from "./DirectorDeskContext";

const shotSizePresets = new ShotSizePresets();

const SHOT_SIZE_LABELS: Record<ShotSize, string> = {
    [SHOT_SIZE.EXTREME_LONG]: "大远景",
    [SHOT_SIZE.LONG]: "远景",
    [SHOT_SIZE.MEDIUM_LONG]: "中远景",
    [SHOT_SIZE.MEDIUM]: "中景",
    [SHOT_SIZE.MEDIUM_CLOSE]: "中近景",
    [SHOT_SIZE.CLOSE_UP]: "特写",
    [SHOT_SIZE.EXTREME_CLOSE_UP]: "大特写",
};

/** 机位 id:短 uuid,人可读且免计数器状态 */
const nextShotId = () => `shot-${crypto.randomUUID().slice(0, 8)}`;

/**
 * 机位面板(左下):机位 CRUD、当前视角存机位、景别预设、FOV 微调。
 * 一切写操作走命令层;景别计算在面板侧完成(需要 three 包围盒),落的是纯数据参数。
 */
export const ShotPanel = observer(function ShotPanel() {
    const stores = useDirectorDeskStores();
    const { camera, scene, selection, dispatcher } = stores;
    const [shotSize, setShotSize] = useState<ShotSize>(SHOT_SIZE.MEDIUM);

    void camera.revision;
    const shots = camera.director.listShots();
    const activeShot = camera.activeShotId ? camera.director.getShot(camera.activeShotId) : undefined;

    const saveCurrentView = () => {
        const pose = camera.lastDirectorPose;
        if (!pose) return;
        dispatcher.dispatch(
            {
                type: "camera.set-shot",
                payload: { id: nextShotId(), shot: { position: pose.position, target: pose.target, fov: pose.fov } },
            },
            stores,
        );
    };

    /** 以主选对象为被摄体,按景别生成机位并切入 */
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
        const id = nextShotId();
        dispatcher.dispatch({ type: "camera.set-shot", payload: { id, shot: shot.toJSON() } }, stores);
        dispatcher.dispatch({ type: "camera.activate", payload: { id } }, stores);
    };

    const setActiveFov = (fov: number) => {
        if (!camera.activeShotId || !activeShot) return;
        dispatcher.dispatch(
            {
                type: "camera.set-shot",
                payload: {
                    id: camera.activeShotId,
                    shot: { position: activeShot.position, target: activeShot.target, fov },
                },
            },
            stores,
        );
    };

    return (
        <Paper elevation={2} sx={{ position: "absolute", left: 12, bottom: 12, width: 240, p: 1.5, zIndex: 1 }}>
            <Typography variant="subtitle2">机位({shots.length})</Typography>
            <List dense disablePadding>
                {shots.map(([id]) => {
                    const active = camera.activeShotId === id;
                    return (
                        <ListItem
                            key={id}
                            disablePadding
                            secondaryAction={
                                <IconButton
                                    size="small"
                                    edge="end"
                                    aria-label={`删除 ${id}`}
                                    onClick={() =>
                                        dispatcher.dispatch({ type: "camera.remove-shot", payload: { id } }, stores)
                                    }
                                >
                                    <DeleteIcon fontSize="small" />
                                </IconButton>
                            }
                        >
                            <Button
                                size="small"
                                variant={active ? "contained" : "text"}
                                startIcon={<VideocamIcon />}
                                onClick={() =>
                                    dispatcher.dispatch(
                                        { type: active ? "camera.deactivate" : "camera.activate", payload: { id } },
                                        stores,
                                    )
                                }
                            >
                                {id}
                            </Button>
                        </ListItem>
                    );
                })}
            </List>
            <Button size="small" variant="outlined" startIcon={<AddAPhotoIcon />} onClick={saveCurrentView} fullWidth>
                当前视角存为机位
            </Button>
            <Divider sx={{ my: 1 }} />
            <Typography variant="caption" color="text.secondary">
                景别(作用于选中对象)
            </Typography>
            <Select
                size="small"
                fullWidth
                value={shotSize}
                onChange={(e) => applyShotSize(e.target.value as ShotSize)}
                disabled={!selection.primaryId}
            >
                {Object.entries(SHOT_SIZE_LABELS).map(([size, label]) => (
                    <MenuItem key={size} value={size}>
                        {label}
                    </MenuItem>
                ))}
            </Select>
            <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                    FOV {activeShot?.fov.toFixed(0) ?? "—"}°(激活机位可调)
                </Typography>
                <Slider
                    size="small"
                    min={FOV_MIN}
                    max={FOV_MAX}
                    value={activeShot?.fov ?? 45}
                    disabled={!activeShot}
                    onChange={(_, value) => setActiveFov(value as number)}
                />
            </Box>
        </Paper>
    );
});
