import AddBoxIcon from "@mui/icons-material/AddBox";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import ZoomOutMapIcon from "@mui/icons-material/ZoomOutMap";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import { observer } from "mobx-react";
import { useRef, useState } from "react";

import { GIZMO_MODE } from "../store/UiStore";
import type { GizmoMode } from "../store/UiStore";
import { formatShortcutHint, SHORTCUT_ID } from "../shortcuts/builtinShortcuts";
import type { ShortcutId } from "../shortcuts/builtinShortcuts";
import { useDirectorDeskStores } from "./DirectorDeskContext";
import { importActionFile, importModelFile, placementFor } from "./importFiles";

/** 模式三态查表:图标 + 文案 + 快捷键 id(提示与生效键同源,见 SHORTCUT_SPECS) */
const GIZMO_MODE_META: Record<GizmoMode, { label: string; icon: typeof OpenWithIcon; shortcutId: ShortcutId }> = {
    [GIZMO_MODE.TRANSLATE]: { label: "移动", icon: OpenWithIcon, shortcutId: SHORTCUT_ID.GIZMO_TRANSLATE },
    [GIZMO_MODE.ROTATE]: { label: "旋转", icon: RotateRightIcon, shortcutId: SHORTCUT_ID.GIZMO_ROTATE },
    [GIZMO_MODE.SCALE]: { label: "缩放", icon: ZoomOutMapIcon, shortcutId: SHORTCUT_ID.GIZMO_SCALE },
};

const MODEL_FILE_ACCEPT = ".glb,.gltf,.fbx,.obj";
const ACTION_FILE_ACCEPT = ".glb,.gltf,.fbx";

/**
 * 顶部工具条:一切写操作经 dispatcher 分发(命令层样板)。
 * 本组件不直接触达 store 的任何写字段。
 */
export const Toolbar = observer(function Toolbar() {
    const stores = useDirectorDeskStores();
    const { scene, dispatcher } = stores;
    const fileInputRef = useRef<HTMLInputElement>(null);
    const actionInputRef = useRef<HTMLInputElement>(null);
    const [notice, setNotice] = useState<string | null>(null);

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
            <Paper elevation={2} sx={{ position: "absolute", top: 12, left: 12, px: 1, py: 0.5, zIndex: 1 }}>
                <Stack direction="row" spacing={1}>
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
                    <ToggleButtonGroup
                        exclusive
                        size="small"
                        value={stores.ui.gizmoMode}
                        onChange={(_, mode: GizmoMode | null) => {
                            if (mode) stores.ui.setGizmoMode(mode);
                        }}
                    >
                        {Object.entries(GIZMO_MODE_META).map(([mode, meta]) => (
                            <ToggleButton key={mode} value={mode} aria-label={meta.label}>
                                <Tooltip title={`${meta.label}(${formatShortcutHint(meta.shortcutId)})`}>
                                    <meta.icon fontSize="small" />
                                </Tooltip>
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
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
                open={notice !== null}
                autoHideDuration={3000}
                onClose={() => setNotice(null)}
                message={notice}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            />
        </>
    );
});
