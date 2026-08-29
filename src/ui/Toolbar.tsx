import AddBoxIcon from "@mui/icons-material/AddBox";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import ZoomOutMapIcon from "@mui/icons-material/ZoomOutMap";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import IconButton from "@mui/material/IconButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useRef, useState } from "react";

import { GIZMO_MODE } from "../store/UiStore";
import type { GizmoMode } from "../store/UiStore";
import { formatShortcutHint, SHORTCUT_ID } from "../shortcuts/builtinShortcuts";
import { useDirectorDeskStores } from "./DirectorDeskContext";
import { importActionFile, importModelFile, placementFor } from "./importFiles";

/** 模式三态查表:图标 + 文案(模式切换只走工具条;W/E/R 已让位给 WASD 飞行,见 navigation/FlyDrive) */
const GIZMO_MODE_META: Record<GizmoMode, { label: string; icon: typeof OpenWithIcon }> = {
    [GIZMO_MODE.TRANSLATE]: { label: "移动", icon: OpenWithIcon },
    [GIZMO_MODE.ROTATE]: { label: "旋转", icon: RotateRightIcon },
    [GIZMO_MODE.SCALE]: { label: "缩放", icon: ZoomOutMapIcon },
};

const MODEL_FILE_ACCEPT = ".glb,.gltf,.fbx,.obj";
const PLAY_INDICATOR_COLOR = "success.main";
const PLAY_INDICATOR_SIZE = 8;
const PLAY_INDICATOR_GAP = 0.5;

const ACTION_FILE_ACCEPT = ".glb,.gltf,.fbx";
const OVERLAY_INSET_PX = 12;
const TOOLBAR_MAX_WIDTH = "calc(100% - 24px)";

/**
 * 顶部工具条:场景与相机的持久化写入经 dispatcher 分发；UI 反馈仅写 UiStore。
 * 组件不直接修改场景或相机状态。
 */
export const Toolbar = observer(function Toolbar() {
    const stores = useDirectorDeskStores();
    const { scene, dispatcher, ui } = stores;
    const fileInputRef = useRef<HTMLInputElement>(null);
    const actionInputRef = useRef<HTMLInputElement>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const applicationNotice = ui.applicationNotice;
    const displayedNotice = applicationNotice ?? notice;

    const placePrimitive = () => {
        const result = dispatcher.dispatch(
            {
                type: "object.place",
                payload: {
                    id: `prim-${crypto.randomUUID()}`,
                    kind: "primitive",
                    transform: {
                        position: placementFor(scene.objectCount),
                        rotation: [0, 0, 0],
                        scale: [1, 1, 1],
                    },
                },
            },
            stores,
        );
        if (!result.ok) setNotice(`放置被拒绝:${result.error}`);
    };

    const clearAll = () => {
        for (const entity of scene.manager.list()) {
            dispatcher.dispatch({ type: "object.remove", payload: { id: entity.id } }, stores);
        }
    };

    return (
        <>
            <Paper
                elevation={2}
                role="toolbar"
                aria-label="导演工具"
                sx={{
                    position: "absolute",
                    top: OVERLAY_INSET_PX,
                    left: OVERLAY_INSET_PX,
                    maxWidth: TOOLBAR_MAX_WIDTH,
                    overflowX: "auto",
                    px: 1,
                    py: 0.5,
                    zIndex: 1,
                }}
            >
                <Stack direction="row" spacing={1} sx={{ width: "max-content" }}>
                    <Button variant="contained" startIcon={<AddBoxIcon />} onClick={placePrimitive}>
                        添加几何体
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<UploadFileIcon />}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        导入模型
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<UploadFileIcon />}
                        onClick={() => actionInputRef.current?.click()}
                    >
                        导入动作
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<PhotoCameraIcon />}
                        onClick={() => {
                            const result = dispatcher.dispatch({ type: "capture.frame", payload: {} }, stores);
                            if (!result.ok) setNotice(`截图被拒绝:${result.error}`);
                        }}
                    >
                        截图
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<DeleteSweepIcon />}
                        onClick={clearAll}
                        disabled={scene.objectCount === 0}
                    >
                        清空({scene.objectCount})
                    </Button>
                    <Divider orientation="vertical" flexItem />
                    <Tooltip title={`撤销(${formatShortcutHint(SHORTCUT_ID.EDIT_UNDO)})`}>
                        <span>
                            <IconButton
                                size="small"
                                disabled={!stores.history.canUndo}
                                onClick={() => stores.history.undo(stores)}
                                aria-label="撤销"
                            >
                                <UndoIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title={`重做(${formatShortcutHint(SHORTCUT_ID.EDIT_REDO)})`}>
                        <span>
                            <IconButton
                                size="small"
                                disabled={!stores.history.canRedo}
                                onClick={() => stores.history.redo(stores)}
                                aria-label="重做"
                            >
                                <RedoIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Divider orientation="vertical" flexItem />
                    <ToggleButtonGroup
                        exclusive
                        size="small"
                        value={stores.ui.gizmoMode}
                        aria-label="变换工具"
                        onChange={(_, mode: GizmoMode | null) => {
                            if (mode) stores.ui.setGizmoMode(mode);
                        }}
                    >
                        {Object.entries(GIZMO_MODE_META).map(([mode, meta]) => (
                            <ToggleButton key={mode} value={mode} aria-label={meta.label}>
                                <Tooltip title={meta.label}>
                                    <meta.icon fontSize="small" />
                                </Tooltip>
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                    {stores.clock.isPlaying && (
                        <>
                            <Divider orientation="vertical" flexItem />
                            <Box className="flex items-center" sx={{ gap: PLAY_INDICATOR_GAP }}>
                                <Box
                                    sx={{
                                        width: PLAY_INDICATOR_SIZE,
                                        height: PLAY_INDICATOR_SIZE,
                                        borderRadius: "50%",
                                        bgcolor: PLAY_INDICATOR_COLOR,
                                    }}
                                />
                                <Typography variant="caption" color={PLAY_INDICATOR_COLOR}>
                                    播放中
                                </Typography>
                            </Box>
                        </>
                    )}
                </Stack>
            </Paper>
            <input
                ref={fileInputRef}
                type="file"
                accept={MODEL_FILE_ACCEPT}
                hidden
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) importModelFile(stores, file, setNotice);
                }}
            />
            <input
                ref={actionInputRef}
                type="file"
                accept={ACTION_FILE_ACCEPT}
                hidden
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void importActionFile(stores, file, setNotice);
                }}
            />
            <Snackbar
                open={displayedNotice !== null}
                autoHideDuration={3000}
                onClose={() => (applicationNotice === null ? setNotice(null) : ui.clearApplicationNotice())}
                message={displayedNotice}
                slotProps={{ content: { role: "alert", "aria-live": "assertive" } }}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            />
        </>
    );
});
