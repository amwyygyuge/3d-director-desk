import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import StopIcon from "@mui/icons-material/Stop";
import VideocamIcon from "@mui/icons-material/Videocam";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import RedoIcon from "@mui/icons-material/Redo";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import UndoIcon from "@mui/icons-material/Undo";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import ZoomOutMapIcon from "@mui/icons-material/ZoomOutMap";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useRef, useState } from "react";
import type { ComponentType } from "react";

import { createDefaultLightParams } from "../core/LightParams";
import type { LightType } from "../core/LightParams";
import { GIZMO_MODE } from "../store/UiStore";
import type { GizmoMode } from "../store/UiStore";
import { formatShortcutHint, SHORTCUT_ID } from "../shortcuts/builtinShortcuts";
import type { ShortcutId } from "../shortcuts/builtinShortcuts";
import { STAGE_DEFS, STAGE_ORDER } from "../workspace/stages";
import type { WorkspaceStage } from "../workspace/stages";
import { useDirectorDeskStores } from "./DirectorDeskContext";
import { LightModeToggle } from "./LightModeToggle";
import { importModelFile, placementFor } from "./importFiles";

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

/** 阶段切换页签:点击 + 数字键直切(SHORTCUT_SPECS),提示同源 */
const STAGE_SHORTCUT_ID: Record<WorkspaceStage, ShortcutId> = {
    set: SHORTCUT_ID.STAGE_SET,
    camera: SHORTCUT_ID.STAGE_CAMERA,
    output: SHORTCUT_ID.STAGE_OUTPUT,
};

const StageTabs = observer(function StageTabs() {
    const { ui } = useDirectorDeskStores();
    return (
        <Tabs
            value={ui.stage}
            onChange={(_, stage: WorkspaceStage) => ui.setStage(stage)}
            aria-label="工作区阶段"
            sx={{ minHeight: 0, "& .MuiTab-root": { minHeight: 0, py: 0.5 } }}
        >
            {STAGE_ORDER.map((stage) => {
                const def = STAGE_DEFS[stage];
                const StageIcon = def.icon;
                return (
                    <Tab
                        key={stage}
                        value={stage}
                        label={
                            <Tooltip title={`${def.label}(${formatShortcutHint(STAGE_SHORTCUT_ID[stage])})`}>
                                <Box className="flex items-center" sx={{ gap: 0.5 }}>
                                    <StageIcon fontSize="small" />
                                    {def.label}
                                </Box>
                            </Tooltip>
                        }
                    />
                );
            })}
        </Tabs>
    );
});

/** 布景:导入模型 */
const SectionPlace = observer(function SectionPlace() {
    const stores = useDirectorDeskStores();
    const { ui } = stores;
    const fileInputRef = useRef<HTMLInputElement>(null);

    return (
        <>
            <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => fileInputRef.current?.click()}>
                导入模型
            </Button>
            <input
                ref={fileInputRef}
                type="file"
                accept={MODEL_FILE_ACCEPT}
                hidden
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) importModelFile(stores, file, (message) => ui.setApplicationNotice(message));
                }}
            />
        </>
    );
});

/** 布景(含打灯):添加灯光菜单 + 灯光模式 */
const SectionLight = observer(function SectionLight() {
    const stores = useDirectorDeskStores();
    const { scene, dispatcher, ui } = stores;
    const [lightMenuAnchor, setLightMenuAnchor] = useState<HTMLElement | null>(null);

    const placeLight = (type: LightType) => {
        const [x, , z] = placementFor(scene.objectCount);
        const id = `light-${crypto.randomUUID()}`;
        const label = type === "directional" ? "平行光" : type === "point" ? "点光" : "聚光";
        const result = dispatcher.dispatch(
            {
                type: "object.place",
                payload: {
                    id,
                    kind: "light",
                    name: `${label} ${id.slice(-4)}`,
                    light: createDefaultLightParams(type),
                    transform: { position: [x, 3, z], rotation: [0, 0, 0], scale: [1, 1, 1] },
                },
            },
            stores,
        );
        setLightMenuAnchor(null);
        if (!result.ok) ui.setApplicationNotice(`添加灯光被拒绝:${result.issues?.join(";") ?? result.error}`);
    };

    return (
        <>
            <Button
                variant="outlined"
                startIcon={<LightbulbIcon />}
                aria-controls={lightMenuAnchor ? "light-creation-menu" : undefined}
                aria-haspopup="menu"
                onClick={(event) => setLightMenuAnchor(event.currentTarget)}
            >
                添加灯光
            </Button>
            <LightModeToggle />
            <Menu
                id="light-creation-menu"
                anchorEl={lightMenuAnchor}
                open={lightMenuAnchor !== null}
                onClose={() => setLightMenuAnchor(null)}
            >
                <MenuItem onClick={() => placeLight("directional")}>添加平行光</MenuItem>
                <MenuItem onClick={() => placeLight("point")}>添加点光</MenuItem>
                <MenuItem onClick={() => placeLight("spot")}>添加聚光</MenuItem>
            </Menu>
        </>
    );
});

/** 成片:截图 + 录制视频 + 工程文档导出/导入(写操作全走命令层) */
const SectionCapture = observer(function SectionCapture() {
    const stores = useDirectorDeskStores();
    const { ui, dispatcher } = stores;
    const documentInputRef = useRef<HTMLInputElement>(null);

    const exportDocument = () => {
        const result = dispatcher.query({ type: "desk.export-document", payload: {} }, stores);
        if (!result.ok) {
            ui.setApplicationNotice(`导出被拒:${result.error}`);
            return;
        }
        const blob = new Blob([JSON.stringify(result.value, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "director-desk-scene.json";
        anchor.click();
        URL.revokeObjectURL(url);
    };

    const importDocument = async (file: File) => {
        let document: unknown;
        try {
            document = JSON.parse(await file.text());
        } catch {
            ui.setApplicationNotice("工程文件不是合法 JSON");
            return;
        }
        const result = dispatcher.dispatch({ type: "desk.import-document", payload: { document } }, stores);
        if (!result.ok) ui.setApplicationNotice(`导入被拒:${result.issues?.join(";") ?? result.error}`);
    };

    const toggleRecording = () => {
        const type = ui.videoRecording ? "capture.video-cancel" : "capture.video";
        const result = dispatcher.dispatch({ type, payload: {} }, stores);
        if (!result.ok) ui.setApplicationNotice(`录制被拒:${result.issues?.join(";") ?? result.error}`);
    };

    return (
        <>
            <Button
                variant="outlined"
                startIcon={<PhotoCameraIcon />}
                onClick={() => {
                    const result = dispatcher.dispatch({ type: "capture.frame", payload: {} }, stores);
                    if (!result.ok) ui.setApplicationNotice(`截图被拒绝:${result.error}`);
                }}
            >
                截图
            </Button>
            <Tooltip title={`录制时间轴(0~${stores.timeline.document.duration}s)为 WebM`}>
                <Button
                    variant={ui.videoRecording ? "contained" : "outlined"}
                    color={ui.videoRecording ? "error" : "inherit"}
                    startIcon={ui.videoRecording ? <StopIcon /> : <VideocamIcon />}
                    onClick={toggleRecording}
                >
                    {ui.videoRecording ? "停止录制" : "录制视频"}
                </Button>
            </Tooltip>
            {ui.lastVideoUrl && (
                <Button
                    variant="text"
                    startIcon={<FileDownloadIcon />}
                    href={ui.lastVideoUrl}
                    download="director-desk-preview.webm"
                >
                    下载视频
                </Button>
            )}
            <Tooltip title="导出整桌工程为 JSON(可在他处导入接管)">
                <Button variant="outlined" startIcon={<FileDownloadIcon />} onClick={exportDocument}>
                    导出工程
                </Button>
            </Tooltip>
            <Tooltip title="导入工程 JSON(替换当前场景)">
                <Button
                    variant="outlined"
                    startIcon={<UploadFileIcon />}
                    onClick={() => documentInputRef.current?.click()}
                >
                    导入工程
                </Button>
            </Tooltip>
            <input
                ref={documentInputRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void importDocument(file);
                }}
            />
        </>
    );
});

/** 布景:清空场景 */
const SectionClear = observer(function SectionClear() {
    const stores = useDirectorDeskStores();
    const { scene, dispatcher } = stores;
    return (
        <Button
            variant="outlined"
            startIcon={<DeleteSweepIcon />}
            onClick={() => {
                for (const entity of scene.manager.list()) {
                    dispatcher.dispatch({ type: "object.remove", payload: { id: entity.id } }, stores);
                }
            }}
            disabled={scene.objectCount === 0}
        >
            清空({scene.objectCount})
        </Button>
    );
});

/** 全局:撤销/重做(全阶段常驻) */
const SectionHistory = observer(function SectionHistory() {
    const stores = useDirectorDeskStores();
    return (
        <>
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
        </>
    );
});

/** 全局:gizmo 模式三态(全阶段常驻) */
const SectionGizmo = observer(function SectionGizmo() {
    const { ui } = useDirectorDeskStores();
    return (
        <ToggleButtonGroup
            exclusive
            size="small"
            value={ui.gizmoMode}
            aria-label="变换工具"
            onChange={(_, mode: GizmoMode | null) => {
                if (mode) ui.setGizmoMode(mode);
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
    );
});

const SECTION_COMPONENTS = {
    place: SectionPlace,
    light: SectionLight,
    capture: SectionCapture,
    clear: SectionClear,
} satisfies Record<string, ComponentType>;

const STAGE_SECTIONS: Record<WorkspaceStage, readonly (keyof typeof SECTION_COMPONENTS)[]> = {
    set: ["place", "light", "clear"],
    camera: [],
    output: ["capture"],
};

/**
 * 顶部工具条:阶段 Tabs + 当前阶段工具组 + 全局组(历史/gizmo/播放态)。
 * 阶段只是聚焦透镜:不重置选中/视角/场景数据;一切写操作经 dispatcher 分发。
 */
export const Toolbar = observer(function Toolbar() {
    const stores = useDirectorDeskStores();
    const { ui } = stores;

    return (
        <>
            <Paper
                elevation={2}
                square
                role="toolbar"
                aria-label="导演工具"
                className="absolute left-3 right-3 top-3 z-[2]"
                sx={{ overflowX: "auto", px: 1, py: 0.5 }}
            >
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <StageTabs />
                    <Divider orientation="vertical" flexItem />
                    {STAGE_SECTIONS[ui.stage].map((key) => {
                        const Section = SECTION_COMPONENTS[key];
                        return <Section key={key} />;
                    })}
                    <Divider orientation="vertical" flexItem />
                    <SectionHistory />
                    <Divider orientation="vertical" flexItem />
                    <SectionGizmo />
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
            <Snackbar
                open={ui.applicationNotice !== null}
                autoHideDuration={3000}
                onClose={() => ui.clearApplicationNotice()}
                message={ui.applicationNotice}
                slotProps={{ content: { role: "alert", "aria-live": "assertive" } }}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            />
        </>
    );
});
