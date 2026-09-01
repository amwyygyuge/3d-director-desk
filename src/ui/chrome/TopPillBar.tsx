import CloseIcon from "@mui/icons-material/Close";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import MenuIcon from "@mui/icons-material/Menu";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RedoIcon from "@mui/icons-material/Redo";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import StopIcon from "@mui/icons-material/Stop";
import UndoIcon from "@mui/icons-material/Undo";
import VideocamIcon from "@mui/icons-material/Videocam";
import ZoomOutMapIcon from "@mui/icons-material/ZoomOutMap";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useRef, useState } from "react";
import type { ChangeEvent, RefObject } from "react";

import { requestFrameCapture } from "../../command/captureCommands";
import type { CommandResult } from "../../command/DirectorCommand";
import { EnterPresentationCommand, ExitPresentationCommand } from "../../command/presentationCommands";
import { formatShortcutHint, SHORTCUT_ID } from "../../shortcuts/builtinShortcuts";
import { GIZMO_MODE } from "../../store/UiStore";
import type { GizmoMode } from "../../store/UiStore";
import { useDirectorDeskStores } from "../DirectorDeskContext";
import type { DirectorDeskStores } from "../DirectorDeskContext";
import { importModelFile } from "../importFiles";
import { CHROME } from "../theme";

const COMMAND_TYPE = {
    CAPTURE_VIDEO: "capture.video",
    CAPTURE_VIDEO_CANCEL: "capture.video-cancel",
    EXPORT_DOCUMENT: "desk.export-document",
    IMPORT_DOCUMENT: "desk.import-document",
    REMOVE_OBJECT: "object.remove",
} as const;

const TEXT = {
    CLEAR_SCENE: "清空场景",
    DOCUMENT_FILE_INVALID: "工程文件不是合法 JSON",
    DOWNLOAD_VIDEO: "下载录制视频",
    EXPORT_DOCUMENT: "导出工程",
    FULLSCREEN_PREVIEW: "全屏预览",
    GIZMO_TOOL: "变换工具",
    HELP: "快捷键速查",
    IMPORT_DOCUMENT: "导入工程…",
    IMPORT_MODEL: "导入模型文件…",
    MENU: "项目菜单",
    PLAYING: "播放中",
    PRESENTING: "预览中 · Esc 退出",
    PROJECT_NAME: "3D 导演台",
    RECORDING_TIMELINE_PREFIX: "录制时间轴(0~",
    RECORDING_TIMELINE_SUFFIX: "s)为 WebM",
    RECORD_VIDEO: "录制视频",
    REDO: "重做",
    SCREENSHOT: "截图",
    STOP_RECORDING: "停止录制",
    UNDO: "撤销",
} as const;
const DOCUMENT_MIME_TYPE = "application/json";
const FILE_ACCEPT = { DOCUMENT: `${DOCUMENT_MIME_TYPE},.json`, MODEL: ".glb,.gltf,.fbx,.obj" } as const;
const DOWNLOAD = { DOCUMENT: "director-desk-scene.json", VIDEO: "director-desk-preview.webm" } as const;
const MENU_ID = "project-pill-menu";
const BUTTON_VARIANT = { CONTAINED: "contained", TEXT: "text" } as const;
const ICON_BUTTON_COLOR = { DEFAULT: "default", ERROR: "error" } as const;
const COMPACT_SIZE = "small" as const;
const FIRST_ITEM_INDEX = 0;
const EMPTY_OBJECT_COUNT = 0;
const JSON_INDENT_SPACES = 2;
const PILL_HEIGHT_PX = 48;
const PILL_PADDING_X = 0.75;
const PILL_GAP = 0.5;
const DIVIDER_MARGIN_X = 0.25;
const PLAY_INDICATOR_COLOR = "success.main";
const MENU_SHORTCUT_MARGIN = "auto";
const PLAY_INDICATOR_SIZE_PX = 8;
const PREVIEW_BUTTON_BACKGROUND = "#fff";
const PREVIEW_BUTTON_COLOR = "#000";
const PREVIEW_BUTTON_HOVER_BACKGROUND = "#e5e5e5";
const PREVIEW_BUTTON_SHADOW = "0 0 15px rgba(255,255,255,0.2)";
const PILL_SX = { alignItems: "center", display: "flex", gap: PILL_GAP, height: PILL_HEIGHT_PX, px: PILL_PADDING_X } as const;
const PREVIEW_BUTTON_SX = {
    bgcolor: PREVIEW_BUTTON_BACKGROUND,
    borderRadius: PILL_HEIGHT_PX,
    boxShadow: PREVIEW_BUTTON_SHADOW,
    color: PREVIEW_BUTTON_COLOR,
    "&:hover": { bgcolor: PREVIEW_BUTTON_HOVER_BACKGROUND },
} as const;

/** 顶部壳层只编排命令入口与瞬时菜单状态,不持有领域状态或运行时资源。 */
export const TopPillBar = observer(function TopPillBar() {
    const { layout } = useDirectorDeskStores();
    if (!layout.authoringVisible) return null;

    return (
        <Box
            className="pointer-events-none absolute z-20 flex items-center justify-between"
            sx={{ left: CHROME.edgeGapPx, right: CHROME.edgeGapPx, top: CHROME.edgeGapPx }}
        >
            <ProjectPill />
            <ViewportPill />
            <OutputPill />
        </Box>
    );
});

const ProjectPill = observer(function ProjectPill() {
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const modelInputRef = useRef<HTMLInputElement>(null);
    const documentInputRef = useRef<HTMLInputElement>(null);

    return (
        <Paper variant="pill" className="pointer-events-auto" sx={PILL_SX}>
            <Tooltip title={TEXT.MENU}>
                <IconButton
                    aria-controls={menuAnchor ? MENU_ID : undefined}
                    aria-haspopup="menu"
                    aria-label={TEXT.MENU}
                    onClick={(event) => setMenuAnchor(event.currentTarget)}
                    size={COMPACT_SIZE}
                >
                    <MenuIcon fontSize={COMPACT_SIZE} />
                </IconButton>
            </Tooltip>
            <Divider flexItem orientation="vertical" sx={{ mx: DIVIDER_MARGIN_X }} />
            <Typography className="whitespace-nowrap" sx={{ fontWeight: 700 }} variant="body2">
                {TEXT.PROJECT_NAME}
            </Typography>
            <ProjectMenu
                documentInputRef={documentInputRef}
                menuAnchor={menuAnchor}
                modelInputRef={modelInputRef}
                onClose={() => setMenuAnchor(null)}
            />
            <HiddenImportInputs documentInputRef={documentInputRef} modelInputRef={modelInputRef} />
        </Paper>
    );
});

interface ProjectMenuProps {
    readonly documentInputRef: RefObject<HTMLInputElement>;
    readonly menuAnchor: HTMLElement | null;
    readonly modelInputRef: RefObject<HTMLInputElement>;
    readonly onClose: () => void;
}

/** props 只收 DOM ref 与菜单开合回调;场景计数等状态自取,避免父药丸跟着对象增删重渲。 */
const ProjectMenu = observer(function ProjectMenu({
    documentInputRef,
    menuAnchor,
    modelInputRef,
    onClose,
}: ProjectMenuProps) {
    const stores = useDirectorDeskStores();
    const objectCount = stores.scene.objectCount;
    const clearLabel = `${TEXT.CLEAR_SCENE}（${objectCount}）`;
    return (
        <Menu anchorEl={menuAnchor} id={MENU_ID} onClose={onClose} open={menuAnchor !== null}>
            <MenuItem onClick={() => closeMenuThen({ action: () => modelInputRef.current?.click(), onClose })}>{TEXT.IMPORT_MODEL}</MenuItem>
            <MenuItem onClick={() => closeMenuThen({ action: () => documentInputRef.current?.click(), onClose })}>{TEXT.IMPORT_DOCUMENT}</MenuItem>
            <MenuItem onClick={() => closeMenuThen({ action: () => exportDocument(stores), onClose })}>{TEXT.EXPORT_DOCUMENT}</MenuItem>
            <MenuItem disabled={objectCount === EMPTY_OBJECT_COUNT} onClick={() => closeMenuThen({ action: () => clearScene(stores), onClose })}>
                <DeleteSweepIcon fontSize={COMPACT_SIZE} sx={{ mr: PILL_GAP }} />
                {clearLabel}
            </MenuItem>
            <MenuItem onClick={() => closeMenuThen({ action: () => stores.ui.toggleHelp(), onClose })}>
                {TEXT.HELP}
                <Typography sx={{ ml: MENU_SHORTCUT_MARGIN }} variant="caption">
                    {formatShortcutHint(SHORTCUT_ID.HELP_TOGGLE)}
                </Typography>
            </MenuItem>
        </Menu>
    );
});
function closeMenuThen({ action, onClose }: { readonly action: () => void; readonly onClose: () => void }): void {
    action();
    onClose();
}


interface HiddenImportInputsProps {
    readonly documentInputRef: RefObject<HTMLInputElement>;
    readonly modelInputRef: RefObject<HTMLInputElement>;
}

const HiddenImportInputs = observer(function HiddenImportInputs({ documentInputRef, modelInputRef }: HiddenImportInputsProps) {
    const stores = useDirectorDeskStores();
    return (
        <>
            <input
                accept={FILE_ACCEPT.MODEL}
                hidden
                onChange={(event) => importModelFromInput({ event, stores })}
                ref={modelInputRef}
                type="file"
            />
            <input
                accept={FILE_ACCEPT.DOCUMENT}
                hidden
                onChange={(event) => void importDocumentFromInput({ event, stores })}
                ref={documentInputRef}
                type="file"
            />
        </>
    );
});

function importModelFromInput({ event, stores }: { readonly event: ChangeEvent<HTMLInputElement>; readonly stores: DirectorDeskStores }): void {
    const file = event.target.files?.[FIRST_ITEM_INDEX];
    event.target.value = "";
    if (file) importModelFile(stores, file, (message) => stores.ui.setApplicationNotice(message));
}

async function importDocumentFromInput({ event, stores }: { readonly event: ChangeEvent<HTMLInputElement>; readonly stores: DirectorDeskStores }): Promise<void> {
    const file = event.target.files?.[FIRST_ITEM_INDEX];
    event.target.value = "";
    if (!file) return;
    try {
        const document = JSON.parse(await file.text()) as unknown;
        reportCommandFailure(stores, stores.dispatcher.dispatch({ type: COMMAND_TYPE.IMPORT_DOCUMENT, payload: { document } }, stores));
    } catch {
        stores.ui.setApplicationNotice(TEXT.DOCUMENT_FILE_INVALID);
    }
}

function exportDocument(stores: DirectorDeskStores): void {
    const result = stores.dispatcher.query({ type: COMMAND_TYPE.EXPORT_DOCUMENT, payload: {} }, stores);
    if (!result.ok) {
        reportCommandFailure(stores, result);
        return;
    }
    const blob = new Blob([JSON.stringify(result.value, null, JSON_INDENT_SPACES)], { type: DOCUMENT_MIME_TYPE });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.download = DOWNLOAD.DOCUMENT;
    anchor.href = url;
    anchor.click();
    URL.revokeObjectURL(url);
}

function clearScene(stores: DirectorDeskStores): void {
    for (const entity of stores.scene.manager.list()) {
        reportCommandFailure(stores, stores.dispatcher.dispatch({ type: COMMAND_TYPE.REMOVE_OBJECT, payload: { id: entity.id } }, stores));
    }
}

/**
 * 视口高频控制区。
 * 不设「机位视图/自由视角」二态开关:进机位由选中机位后 Enter(或双击机位标记)完成,
 * 退出由 Esc 完成,两者都在 ViewportInteractionHints 里常驻提示——再放一组按钮只是重复入口。
 */
const ViewportPill = observer(function ViewportPill() {
    return (
        <Paper variant="pill" className="pointer-events-auto" sx={PILL_SX}>
            <GizmoToggle />
        </Paper>
    );
});

const GIZMO_MODE_META: Record<GizmoMode, { readonly icon: typeof OpenWithIcon; readonly label: string }> = {
    [GIZMO_MODE.TRANSLATE]: { icon: OpenWithIcon, label: "移动" },
    [GIZMO_MODE.ROTATE]: { icon: RotateRightIcon, label: "旋转" },
    [GIZMO_MODE.SCALE]: { icon: ZoomOutMapIcon, label: "缩放" },
};
const GIZMO_MODE_ORDER = [GIZMO_MODE.TRANSLATE, GIZMO_MODE.ROTATE, GIZMO_MODE.SCALE] as const;

const GizmoToggle = observer(function GizmoToggle() {
    const { ui } = useDirectorDeskStores();
    return (
        <ToggleButtonGroup exclusive aria-label={TEXT.GIZMO_TOOL} onChange={(_, mode: GizmoMode | null) => setGizmoMode({ mode, stores: ui })} size={COMPACT_SIZE} value={ui.gizmoMode}>
            {GIZMO_MODE_ORDER.map((mode) => {
                const meta = GIZMO_MODE_META[mode];
                const GizmoIcon = meta.icon;
                return (
                    <ToggleButton aria-label={meta.label} key={mode} value={mode}>
                        <Tooltip title={meta.label}>
                            <GizmoIcon fontSize={COMPACT_SIZE} />
                        </Tooltip>
                    </ToggleButton>
                );
            })}
        </ToggleButtonGroup>
    );
});

function setGizmoMode({ mode, stores }: { readonly mode: GizmoMode | null; readonly stores: DirectorDeskStores["ui"] }): void {
    if (mode) stores.setGizmoMode(mode);
}

const OutputPill = observer(function OutputPill() {
    return (
        <Paper variant="pill" className="pointer-events-auto" sx={PILL_SX}>
            <HistoryControls />
            <Divider flexItem orientation="vertical" sx={{ mx: DIVIDER_MARGIN_X }} />
            <CaptureControls />
            <PresentationControl />
        </Paper>
    );
});

const HistoryControls = observer(function HistoryControls() {
    const stores = useDirectorDeskStores();
    return (
        <>
            <Tooltip title={shortcutTitle({ label: TEXT.UNDO, shortcutId: SHORTCUT_ID.EDIT_UNDO })}>
                <span>
                    <IconButton aria-label={TEXT.UNDO} disabled={!stores.history.canUndo} onClick={() => stores.history.undo(stores)} size={COMPACT_SIZE}>
                        <UndoIcon fontSize={COMPACT_SIZE} />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={shortcutTitle({ label: TEXT.REDO, shortcutId: SHORTCUT_ID.EDIT_REDO })}>
                <span>
                    <IconButton aria-label={TEXT.REDO} disabled={!stores.history.canRedo} onClick={() => stores.history.redo(stores)} size={COMPACT_SIZE}>
                        <RedoIcon fontSize={COMPACT_SIZE} />
                    </IconButton>
                </span>
            </Tooltip>
        </>
    );
});

const CaptureControls = observer(function CaptureControls() {
    const stores = useDirectorDeskStores();
    const { timeline, ui } = stores;
    const recording = ui.videoRecording;
    const recordingTitle = `${TEXT.RECORDING_TIMELINE_PREFIX}${timeline.document.duration}${TEXT.RECORDING_TIMELINE_SUFFIX}`;
    const RecordingIcon = recording ? StopIcon : VideocamIcon;
    const recordingLabel = recording ? TEXT.STOP_RECORDING : TEXT.RECORD_VIDEO;
    return (
        <>
            <Tooltip title={TEXT.SCREENSHOT}>
                <IconButton aria-label={TEXT.SCREENSHOT} onClick={() => requestFrameCapture({ context: stores, dispatcher: stores.dispatcher })} size={COMPACT_SIZE}>
                    <PhotoCameraIcon fontSize={COMPACT_SIZE} />
                </IconButton>
            </Tooltip>
            <Tooltip title={recordingTitle}>
                <IconButton
                    aria-label={recordingLabel}
                    color={recording ? ICON_BUTTON_COLOR.ERROR : ICON_BUTTON_COLOR.DEFAULT}
                    onClick={() => toggleRecording(stores)}
                    size={COMPACT_SIZE}
                >
                    <RecordingIcon fontSize={COMPACT_SIZE} />
                </IconButton>
            </Tooltip>
            {ui.lastVideoUrl ? <VideoDownloadButton url={ui.lastVideoUrl} /> : null}
        </>
    );
});

const VideoDownloadButton = observer(function VideoDownloadButton({ url }: { readonly url: string }) {
    return (
        <Tooltip title={TEXT.DOWNLOAD_VIDEO}>
            <IconButton aria-label={TEXT.DOWNLOAD_VIDEO} download={DOWNLOAD.VIDEO} href={url} size={COMPACT_SIZE}>
                <FileDownloadIcon fontSize={COMPACT_SIZE} />
            </IconButton>
        </Tooltip>
    );
});

function toggleRecording(stores: DirectorDeskStores): void {
    const type = stores.ui.videoRecording ? COMMAND_TYPE.CAPTURE_VIDEO_CANCEL : COMMAND_TYPE.CAPTURE_VIDEO;
    reportCommandFailure(stores, stores.dispatcher.dispatch({ type, payload: {} }, stores));
}

const PresentationControl = observer(function PresentationControl() {
    const stores = useDirectorDeskStores();
    return (
        <Box className="flex items-center" sx={{ gap: PILL_GAP }}>
            {stores.clock.isPlaying ? <PlayingIndicator /> : null}
            <Tooltip title={shortcutTitle({ label: TEXT.FULLSCREEN_PREVIEW, shortcutId: SHORTCUT_ID.PRESENTATION_ENTER })}>
                <Button onClick={() => enterPresentation(stores)} startIcon={<PlayArrowIcon />} sx={PREVIEW_BUTTON_SX} variant={BUTTON_VARIANT.CONTAINED}>
                    {TEXT.FULLSCREEN_PREVIEW}
                </Button>
            </Tooltip>
        </Box>
    );
});

const PlayingIndicator = observer(function PlayingIndicator() {
    return (
        <Box className="flex items-center" sx={{ gap: PILL_GAP }}>
            <Box sx={{ bgcolor: PLAY_INDICATOR_COLOR, borderRadius: PILL_HEIGHT_PX, height: PLAY_INDICATOR_SIZE_PX, width: PLAY_INDICATOR_SIZE_PX }} />
            <Typography color={PLAY_INDICATOR_COLOR} variant="caption">
                {TEXT.PLAYING}
            </Typography>
        </Box>
    );
});

function enterPresentation(stores: DirectorDeskStores): void {
    reportCommandFailure(stores, stores.dispatcher.dispatch({ type: EnterPresentationCommand.TYPE, payload: {} }, stores));
}

/** 预览态仅保留退出入口,避免编辑壳层遮挡 Program 输出。 */
export const PresentationExitHint = observer(function PresentationExitHint() {
    const stores = useDirectorDeskStores();
    if (!stores.layout.presentationMode) return null;

    return (
        <Paper
            variant="pill"
            className="pointer-events-auto absolute z-30 flex items-center"
            sx={{ gap: PILL_GAP, px: PILL_PADDING_X, py: PILL_GAP, right: CHROME.edgeGapPx, top: CHROME.edgeGapPx }}
        >
            <Typography variant="caption">{TEXT.PRESENTING}</Typography>
            <Tooltip title={shortcutTitle({ label: TEXT.PRESENTING, shortcutId: SHORTCUT_ID.PRESENTATION_EXIT })}>
                <IconButton aria-label={TEXT.PRESENTING} onClick={() => exitPresentation(stores)} size={COMPACT_SIZE}>
                    <CloseIcon fontSize={COMPACT_SIZE} />
                </IconButton>
            </Tooltip>
        </Paper>
    );
});

function exitPresentation(stores: DirectorDeskStores): void {
    reportCommandFailure(stores, stores.dispatcher.dispatch({ type: ExitPresentationCommand.TYPE, payload: {} }, stores));
}

function reportCommandFailure(stores: DirectorDeskStores, result: CommandResult): void {
    if (!result.ok) stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
}

function shortcutTitle({ label, shortcutId }: { readonly label: string; readonly shortcutId: (typeof SHORTCUT_ID)[keyof typeof SHORTCUT_ID] }): string {
    return `${label} (${formatShortcutHint(shortcutId)})`;
}

