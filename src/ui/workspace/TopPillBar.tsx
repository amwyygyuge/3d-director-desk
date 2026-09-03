import CloseIcon from "@mui/icons-material/Close";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import KeyboardIcon from "@mui/icons-material/Keyboard";
import MenuIcon from "@mui/icons-material/Menu";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import PolylineIcon from "@mui/icons-material/Polyline";
import GestureIcon from "@mui/icons-material/Gesture";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RedoIcon from "@mui/icons-material/Redo";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import UndoIcon from "@mui/icons-material/Undo";
import VideocamIcon from "@mui/icons-material/Videocam";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ZoomOutMapIcon from "@mui/icons-material/ZoomOutMap";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Slider from "@mui/material/Slider";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useRef, useState } from "react";
import type { ChangeEvent, ReactNode, RefObject } from "react";

import { requestFrameCapture } from "@/command/captureCommands";
import { EnterPresentationCommand, ExitPresentationCommand } from "@/command/presentationCommands";
import { formatShortcutHint, SHORTCUT_ID } from "@/shortcuts/builtinShortcuts";
import { GIZMO_MODE } from "@/store/UiStore";
import type { GizmoMode } from "@/store/UiStore";
import { GRID_SIZE, RENDER_QUALITY, RENDER_QUALITY_PROFILES } from "@/store/WorkbenchLayoutStore";
import { VIDEO_EXPORT_SOURCE } from "@/capture/VideoExportSession";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { ToolbarExtension } from "@/ui/shell/DeskShellPresentation";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { importModelFile } from "@/ui/assets/importFiles";
import { CHROME } from "@/ui/shell/theme";

const COMMAND_TYPE = {
    CAPTURE_VIDEO: "capture.video",
    EXPORT_DOCUMENT: "desk.export-document",
    IMPORT_DOCUMENT: "desk.import-document",
    REMOVE_OBJECT: "object.remove",
} as const;

const TEXT = {
    CAPTURE_VIEWPORT: "录制当前视角（含网格与辅助物）",
    CLEAR_SCENE: "清空场景",
    DOCUMENT_FILE_INVALID: "工程文件不是合法 JSON",
    EXPORT_DOCUMENT: "导出工程",
    FULLSCREEN_PREVIEW: "全屏预览",
    GIZMO_TOOL: "变换工具",
    HELP: "快捷键速查",
    PATH_HELPERS: "编排轨迹",
    PATH_HELPERS_HINT: "运镜与走位轨迹的显隐",
    WALK_DRAFT: "绘制走位",
    WALK_DRAFT_HINT: "选中对象后在地面拖出路线,松手成轨;Esc 退出",
    GRID_SIZE: "地板尺寸",
    RENDER_QUALITY: "渲染画质",
    SHOW_FRAME_RATE: "显示帧率",
    IMPORT_DOCUMENT: "导入工程…",
    IMPORT_MODEL: "导入模型文件…",
    MENU: "项目菜单",
    METER_UNIT: "m",
    PRESENTING: "预览中 · Esc 退出",
    REDO: "重做",
    UNDO: "撤销",
} as const;
const DOCUMENT_MIME_TYPE = "application/json";
const FILE_ACCEPT = { DOCUMENT: `${DOCUMENT_MIME_TYPE},.json`, MODEL: ".glb,.gltf,.fbx,.obj" } as const;
const DOWNLOAD = { DOCUMENT: "director-desk-scene.json" } as const;
const MENU_ID = "project-pill-menu";
const COMPACT_SIZE = "small" as const;
const GRID_SLIDER_MIN_WIDTH_PX = 180;
const FIRST_ITEM_INDEX = 0;
const EMPTY_OBJECT_COUNT = 0;
const JSON_INDENT_SPACES = 2;
const PILL_HEIGHT_PX = CHROME.pillHeightPx;
const PILL_PADDING_X = 0.75;
const PILL_GAP = 0.5;
const DIVIDER_MARGIN_X = 0.25;
const MENU_SHORTCUT_MARGIN = "auto";
const PILL_SX = {
    alignItems: "center",
    display: "flex",
    gap: PILL_GAP,
    height: PILL_HEIGHT_PX,
    px: PILL_PADDING_X,
} as const;
/** 激活态工具:只靠主色与浅底区分,不引入第二种按钮形状 */
const ACTIVE_TOOL_SX = {
    color: "primary.main",
    bgcolor: "rgba(99,102,241,0.16)",
    "&:hover": { bgcolor: "rgba(99,102,241,0.24)", color: "primary.light" },
} as const;
const PROJECT_MENU_DIVIDER_SX = { mx: DIVIDER_MARGIN_X } as const;

/** 顶部壳层只编排命令入口与瞬时菜单状态,不持有领域状态或运行时资源。 */
export const TopPillBar = observer(function TopPillBar() {
    const { layout } = useDirectorDeskStores();
    if (!layout.chromeVisible) return null;

    return (
        <Box
            className="pointer-events-none absolute z-20 flex items-center justify-end"
            sx={{ left: CHROME.edgeGapPx, right: CHROME.edgeGapPx, top: CHROME.edgeGapPx }}
        >
            <OutputPill />
        </Box>
    );
});

const ProjectMenuControl = observer(function ProjectMenuControl() {
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const modelInputRef = useRef<HTMLInputElement>(null);
    const documentInputRef = useRef<HTMLInputElement>(null);

    return (
        <>
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
            <ProjectMenu
                documentInputRef={documentInputRef}
                menuAnchor={menuAnchor}
                modelInputRef={modelInputRef}
                onClose={() => setMenuAnchor(null)}
            />
            <HiddenImportInputs documentInputRef={documentInputRef} modelInputRef={modelInputRef} />
        </>
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
            <MenuItem onClick={() => closeMenuThen({ action: () => modelInputRef.current?.click(), onClose })}>
                {TEXT.IMPORT_MODEL}
            </MenuItem>
            <MenuItem onClick={() => closeMenuThen({ action: () => documentInputRef.current?.click(), onClose })}>
                {TEXT.IMPORT_DOCUMENT}
            </MenuItem>
            <MenuItem onClick={() => closeMenuThen({ action: () => exportDocument(stores), onClose })}>
                {TEXT.EXPORT_DOCUMENT}
            </MenuItem>
            <MenuItem
                disabled={objectCount === EMPTY_OBJECT_COUNT}
                onClick={() => closeMenuThen({ action: () => clearScene(stores), onClose })}
            >
                <DeleteSweepIcon fontSize={COMPACT_SIZE} sx={{ mr: PILL_GAP }} />
                {clearLabel}
            </MenuItem>
            <Divider />
            <MenuItem
                onClick={() =>
                    closeMenuThen({
                        action: () =>
                            stores.layout.setRenderQuality(
                                stores.layout.renderQuality === RENDER_QUALITY.HIGH
                                    ? RENDER_QUALITY.PERFORMANCE
                                    : RENDER_QUALITY.HIGH,
                            ),
                        onClose,
                    })
                }
            >
                {TEXT.RENDER_QUALITY}
                <Typography sx={{ ml: MENU_SHORTCUT_MARGIN }} variant="caption">
                    {RENDER_QUALITY_PROFILES[stores.layout.renderQuality].label}
                </Typography>
            </MenuItem>
            {/* 滑杆直接在菜单内交互:stopPropagation 防方向键被 MenuList 抢走 */}
            <Box
                onKeyDown={(event) => event.stopPropagation()}
                sx={{ px: 2, py: 0.5, minWidth: GRID_SLIDER_MIN_WIDTH_PX }}
            >
                <Typography color="text.secondary" variant="caption">
                    {`${TEXT.GRID_SIZE}（${stores.layout.gridSizeMeters}${TEXT.METER_UNIT}）`}
                </Typography>
                <Slider
                    aria-label={TEXT.GRID_SIZE}
                    max={GRID_SIZE.MAX_METERS}
                    min={GRID_SIZE.MIN_METERS}
                    onChange={(_, value) => {
                        if (typeof value === "number") stores.layout.setGridSizeMeters(value);
                    }}
                    size={COMPACT_SIZE}
                    value={stores.layout.gridSizeMeters}
                />
            </Box>
            <MenuItem onClick={() => stores.layout.toggleFrameRateVisible()}>
                {TEXT.SHOW_FRAME_RATE}
                <Switch
                    checked={stores.layout.frameRateVisible}
                    onChange={() => stores.layout.toggleFrameRateVisible()}
                    onClick={(event) => event.stopPropagation()}
                    size={COMPACT_SIZE}
                    slotProps={{ input: { "aria-label": TEXT.SHOW_FRAME_RATE } }}
                    sx={{ ml: MENU_SHORTCUT_MARGIN }}
                />
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

const HiddenImportInputs = observer(function HiddenImportInputs({
    documentInputRef,
    modelInputRef,
}: HiddenImportInputsProps) {
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

function importModelFromInput({
    event,
    stores,
}: {
    readonly event: ChangeEvent<HTMLInputElement>;
    readonly stores: DirectorDeskStores;
}): void {
    const file = event.target.files?.[FIRST_ITEM_INDEX];
    event.target.value = "";
    if (file) importModelFile(stores, file, (message) => stores.ui.setApplicationNotice(message));
}

async function importDocumentFromInput({
    event,
    stores,
}: {
    readonly event: ChangeEvent<HTMLInputElement>;
    readonly stores: DirectorDeskStores;
}): Promise<void> {
    const file = event.target.files?.[FIRST_ITEM_INDEX];
    event.target.value = "";
    if (!file) return;
    try {
        const document = JSON.parse(await file.text()) as unknown;
        reportCommandFailure(
            stores,
            stores.dispatcher.dispatch({ type: COMMAND_TYPE.IMPORT_DOCUMENT, payload: { document } }, stores),
        );
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
        reportCommandFailure(
            stores,
            stores.dispatcher.dispatch({ type: COMMAND_TYPE.REMOVE_OBJECT, payload: { id: entity.id } }, stores),
        );
    }
}

const GIZMO_MODE_META: Record<GizmoMode, { readonly icon: typeof OpenWithIcon; readonly label: string }> = {
    [GIZMO_MODE.TRANSLATE]: { icon: OpenWithIcon, label: "移动" },
    [GIZMO_MODE.ROTATE]: { icon: RotateRightIcon, label: "旋转" },
    [GIZMO_MODE.SCALE]: { icon: ZoomOutMapIcon, label: "缩放" },
};
const GIZMO_MODE_ORDER = [GIZMO_MODE.TRANSLATE, GIZMO_MODE.ROTATE, GIZMO_MODE.SCALE] as const;

/**
 * 变换工具三态。
 * 不用 ToggleButtonGroup:它自带描边圆角,套在药丸里就成了"胶囊套胶囊",
 * 与同排的 IconButton 两种样式并存。改用同款 IconButton,激活态只靠主色区分。
 */
const GizmoToggle = observer(function GizmoToggle() {
    const { ui } = useDirectorDeskStores();
    return (
        <Box aria-label={TEXT.GIZMO_TOOL} className="flex items-center" role="group" sx={{ gap: PILL_GAP }}>
            {GIZMO_MODE_ORDER.map((mode) => {
                const meta = GIZMO_MODE_META[mode];
                const GizmoIcon = meta.icon;
                const active = ui.gizmoMode === mode;
                return (
                    <Tooltip key={mode} title={meta.label}>
                        <IconButton
                            aria-label={meta.label}
                            aria-pressed={active}
                            onClick={() => ui.setGizmoMode(mode)}
                            size={COMPACT_SIZE}
                            sx={active ? ACTIVE_TOOL_SX : undefined}
                        >
                            <GizmoIcon fontSize={COMPACT_SIZE} />
                        </IconButton>
                    </Tooltip>
                );
            })}
        </Box>
    );
});

/**
 * 编排轨迹显隐:运镜与走位共用同一个开关(都是编排辅助物,不按领域各开一个)。
 * 放顶栏常驻,是因为它与"当前选中什么"无关——选着模型也要能关掉运镜轨迹,反之亦然。
 */
const PathHelperToggle = observer(function PathHelperToggle() {
    const { motionAuthoring } = useDirectorDeskStores();
    const active = motionAuthoring.pathVisible;
    return (
        <Tooltip title={`${TEXT.PATH_HELPERS} · ${TEXT.PATH_HELPERS_HINT}`}>
            <IconButton
                aria-label={TEXT.PATH_HELPERS}
                aria-pressed={active}
                onClick={() => motionAuthoring.setPathVisible(!active)}
                size={COMPACT_SIZE}
                sx={active ? ACTIVE_TOOL_SX : undefined}
            >
                <PolylineIcon fontSize={COMPACT_SIZE} />
            </IconButton>
        </Tooltip>
    );
});

/**
 * 走位草绘模式(钉住式)。
 * 不给弹簧快捷键:WASD+Space/Shift 归飞行导航持续占用,裸字母弹簧键会在飞行途中误触发。
 */
const WalkDraftToggle = observer(function WalkDraftToggle() {
    const { motionAuthoring } = useDirectorDeskStores();
    const active = motionAuthoring.draftActive;
    return (
        <Tooltip title={`${TEXT.WALK_DRAFT} · ${TEXT.WALK_DRAFT_HINT}`}>
            <IconButton
                aria-label={TEXT.WALK_DRAFT}
                aria-pressed={active}
                onClick={() => motionAuthoring.setDraftActive(!active)}
                size={COMPACT_SIZE}
                sx={active ? ACTIVE_TOOL_SX : undefined}
            >
                <GestureIcon fontSize={COMPACT_SIZE} />
            </IconButton>
        </Tooltip>
    );
});
const ShortcutHelpControl = observer(function ShortcutHelpControl() {
    const { ui } = useDirectorDeskStores();
    return (
        <Tooltip title={shortcutTitle({ label: TEXT.HELP, shortcutId: SHORTCUT_ID.HELP_TOGGLE })}>
            <IconButton aria-label={TEXT.HELP} onClick={() => ui.toggleHelp()} size={COMPACT_SIZE}>
                <KeyboardIcon fontSize={COMPACT_SIZE} />
            </IconButton>
        </Tooltip>
    );
});

/** 右侧工具栏:所有操作统一为带 Tooltip 的图标按钮;快捷键和项目菜单同级并固定在最右端。 */
const OutputPill = observer(function OutputPill() {
    return (
        <Paper variant="pill" className="pointer-events-auto" sx={PILL_SX}>
            <HistoryControls />
            <Divider flexItem orientation="vertical" sx={{ mx: DIVIDER_MARGIN_X }} />
            <GizmoToggle />
            <Divider flexItem orientation="vertical" sx={{ mx: DIVIDER_MARGIN_X }} />
            <PathHelperToggle />
            <WalkDraftToggle />
            <Divider flexItem orientation="vertical" sx={{ mx: DIVIDER_MARGIN_X }} />
            <CaptureControls />
            <ToolbarExtensionButtons />
            <PresentationControl />
            <TrailingExtensionButtons />
            <Divider flexItem orientation="vertical" sx={PROJECT_MENU_DIVIDER_SX} />
            <ShortcutHelpControl />
            <ProjectMenuControl />
        </Paper>
    );
});

const HistoryControls = observer(function HistoryControls() {
    const stores = useDirectorDeskStores();
    return (
        <>
            <Tooltip title={shortcutTitle({ label: TEXT.UNDO, shortcutId: SHORTCUT_ID.EDIT_UNDO })}>
                <span>
                    <IconButton
                        aria-label={TEXT.UNDO}
                        disabled={!stores.history.canUndo}
                        onClick={() => stores.history.undo(stores)}
                        size={COMPACT_SIZE}
                    >
                        <UndoIcon fontSize={COMPACT_SIZE} />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={shortcutTitle({ label: TEXT.REDO, shortcutId: SHORTCUT_ID.EDIT_REDO })}>
                <span>
                    <IconButton
                        aria-label={TEXT.REDO}
                        disabled={!stores.history.canRedo}
                        onClick={() => stores.history.redo(stores)}
                        size={COMPACT_SIZE}
                    >
                        <RedoIcon fontSize={COMPACT_SIZE} />
                    </IconButton>
                </span>
            </Tooltip>
        </>
    );
});

/** 右侧工具栏的统一图标按钮：可访问名与悬浮提示始终存在，禁用态包 span 供 Tooltip 挂事件。 */
const PillActionButton = observer(function PillActionButton({
    ariaLabel,
    color,
    disabled = false,
    icon,
    onClick,
    tooltip,
}: PillActionButtonProps) {
    return (
        <Tooltip title={tooltip}>
            <span>
                <IconButton
                    aria-label={ariaLabel}
                    color={color}
                    disabled={disabled}
                    onClick={onClick}
                    size={COMPACT_SIZE}
                >
                    {icon}
                </IconButton>
            </span>
        </Tooltip>
    );
});

interface PillActionButtonProps {
    readonly ariaLabel: string;
    readonly color?: "default" | "error";
    readonly disabled?: boolean;
    readonly icon: ReactNode;
    readonly onClick: () => void;
    readonly tooltip: string;
}

const CaptureControls = observer(function CaptureControls() {
    const stores = useDirectorDeskStores();
    const { presentation, timeline, videoExport } = stores;
    const image = presentation.captureImage;
    const video = presentation.captureVideo;
    const isRecording = videoExport.isRecording;
    const videoTooltip = presentation.captureVideoTooltip(timeline.document.playbackRange);

    return (
        <>
            <PillActionButton
                ariaLabel={image.ariaLabel}
                disabled={isRecording}
                icon={<PhotoCameraIcon fontSize={COMPACT_SIZE} />}
                onClick={() => requestFrameCapture({ context: stores, dispatcher: stores.dispatcher })}
                tooltip={image.tooltip}
            />
            <PillActionButton
                ariaLabel={video.ariaLabel}
                disabled={isRecording}
                icon={<VideocamIcon fontSize={COMPACT_SIZE} />}
                onClick={() => startVideoCapture({ source: VIDEO_EXPORT_SOURCE.PROGRAM, stores })}
                tooltip={videoTooltip}
            />
            <PillActionButton
                ariaLabel={TEXT.CAPTURE_VIEWPORT}
                disabled={isRecording}
                icon={<VisibilityIcon fontSize={COMPACT_SIZE} />}
                onClick={() => startVideoCapture({ source: VIDEO_EXPORT_SOURCE.VIEWPORT, stores })}
                tooltip={TEXT.CAPTURE_VIEWPORT}
            />
        </>
    );
});

/** 宿主扩展按钮的单一渲染实现(两槽位共用):空表不渲染、不占位;点击回调宿主全接管,组件不附加默认行为 */
function renderExtensionButtons(extensions: readonly ToolbarExtension[]): ReactNode {
    if (extensions.length === 0) return null;
    return (
        <>
            <Divider flexItem orientation="vertical" sx={{ mx: DIVIDER_MARGIN_X }} />
            {extensions.map((extension) => (
                <PillActionButton
                    ariaLabel={extension.ariaLabel}
                    disabled={extension.isDisabled()}
                    icon={extension.icon}
                    key={extension.key}
                    onClick={extension.onClick}
                    tooltip={extension.tooltip ?? ""}
                />
            ))}
        </>
    );
}

/** 动作区扩展位(截图/录制右侧) */
const ToolbarExtensionButtons = observer(function ToolbarExtensionButtons() {
    const { presentation } = useDirectorDeskStores();
    return renderExtensionButtons(presentation.toolbarExtensions);
});

/** 尾部扩展位(全屏预览右侧、项目菜单左侧;宿主窗口控制类动作)。 */
const TrailingExtensionButtons = observer(function TrailingExtensionButtons() {
    const { presentation } = useDirectorDeskStores();
    return renderExtensionButtons(presentation.trailingExtensions);
});

function startVideoCapture({
    source,
    stores,
}: {
    readonly source: (typeof VIDEO_EXPORT_SOURCE)[keyof typeof VIDEO_EXPORT_SOURCE];
    readonly stores: DirectorDeskStores;
}): void {
    reportCommandFailure(
        stores,
        stores.dispatcher.dispatch({ type: COMMAND_TYPE.CAPTURE_VIDEO, payload: { source } }, stores),
    );
}

const PresentationControl = observer(function PresentationControl() {
    const stores = useDirectorDeskStores();
    return (
        <Tooltip title={shortcutTitle({ label: TEXT.FULLSCREEN_PREVIEW, shortcutId: SHORTCUT_ID.PRESENTATION_ENTER })}>
            <IconButton
                aria-label={TEXT.FULLSCREEN_PREVIEW}
                onClick={() => enterPresentation(stores)}
                size={COMPACT_SIZE}
            >
                <PlayArrowIcon fontSize={COMPACT_SIZE} />
            </IconButton>
        </Tooltip>
    );
});

function enterPresentation(stores: DirectorDeskStores): void {
    reportCommandFailure(
        stores,
        stores.dispatcher.dispatch({ type: EnterPresentationCommand.TYPE, payload: {} }, stores),
    );
}

export const PresentationExitHint = observer(function PresentationExitHint() {
    const stores = useDirectorDeskStores();
    if (!stores.layout.isProgramTakeover || stores.layout.isShellHidden) return null;

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
    reportCommandFailure(
        stores,
        stores.dispatcher.dispatch({ type: ExitPresentationCommand.TYPE, payload: {} }, stores),
    );
}

function shortcutTitle({
    label,
    shortcutId,
}: {
    readonly label: string;
    readonly shortcutId: (typeof SHORTCUT_ID)[keyof typeof SHORTCUT_ID];
}): string {
    return `${label} (${formatShortcutHint(shortcutId)})`;
}
