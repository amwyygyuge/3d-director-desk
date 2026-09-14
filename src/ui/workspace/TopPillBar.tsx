import CloseIcon from "@mui/icons-material/Close";
import ContrastIcon from "@mui/icons-material/Contrast";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import KeyboardIcon from "@mui/icons-material/Keyboard";
import LayersIcon from "@mui/icons-material/Layers";
import MenuIcon from "@mui/icons-material/Menu";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import PolylineIcon from "@mui/icons-material/Polyline";
import GestureIcon from "@mui/icons-material/Gesture";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RedoIcon from "@mui/icons-material/Redo";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import RouteIcon from "@mui/icons-material/Route";
import UndoIcon from "@mui/icons-material/Undo";
import VideocamIcon from "@mui/icons-material/Videocam";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ZoomOutMapIcon from "@mui/icons-material/ZoomOutMap";
import WbSunnyIcon from "@mui/icons-material/WbSunny";
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
import { FLOOR_COLOR_PALETTE } from "@/studio/FloorColorPalette";
import { EXPOSURE, GRID_SIZE, RENDER_QUALITY } from "@/studio/StudioEnvironment";
import { VIDEO_EXPORT_SOURCE } from "@/capture/VideoExportSession";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { ToolbarExtension } from "@/ui/shell/DeskShellPresentation";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { ColorField } from "@/ui/controls/ColorField";
import { importModelFile } from "@/ui/assets/importFiles";
import { CHROME } from "@/ui/shell/theme";

const COMMAND_TYPE = {
    CAPTURE_VIDEO: "capture.video",
    CLEAR_SCENE: "scene.clear",
    EXPORT_DOCUMENT: "desk.export-document",
    IMPORT_DOCUMENT: "desk.import-document",
    SET_ENVIRONMENT_LIGHTING: "studio.set-environment-lighting",
    SET_EXPOSURE: "studio.set-exposure",
    SET_FLOOR_COLOR: "studio.set-floor-color",
    SET_FRAME_RATE_VISIBLE: "studio.set-frame-rate-visible",
    SET_GRID_SIZE: "studio.set-grid-size",
    SET_RENDER_QUALITY: "studio.set-render-quality",
    SET_SHADOWS: "studio.set-shadows",
    SET_FLOOR_SURFACE: "studio.set-floor-surface",
    SET_SWEEP_PATH: "view.set-sweep-path",
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
    FOLLOW_SWEEP_PATH: "跟拍扫掠路径",
    FOLLOW_SWEEP_PATH_HINT: "显示相机在世界里实际走的线（排查用）；作者平时看的是主体身上的相对轨迹",
    WALK_DRAFT: "绘制走位",
    WALK_DRAFT_HINT: "选中对象后在地面拖出路线,松手成轨;Esc 退出",
    GRID_SIZE: "地板尺寸",
    RENDER_QUALITY: "渲染画质",
    SHOW_FRAME_RATE: "显示帧率",
    SHOW_SHADOWS: "投影",
    SHOW_SHADOWS_HINT: "主体在地面的接触投影；关闭即不产生深度图",
    ENVIRONMENT_LIGHTING: "环境光照",
    ENVIRONMENT_LIGHTING_HINT: "环境光包裹（IBL）：让金属度与粗糙度参与成像，暗部不再死黑",
    EXPOSURE: "曝光",
    FLOOR_COLOR: "地板颜色",
    IMPORT_DOCUMENT: "导入工程…",
    IMPORT_MODEL: "导入模型文件…",
    MENU: "项目菜单",
    FLOOR_SURFACE: "实心地面",
    FLOOR_SURFACE_HINT: "网格之外的实心地板，同时是投影的接收面",
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
/** 曝光滑杆步进与读数位数:0.05 够细腻又不至于让撤销栈里堆满肉眼无差的步。 */
const EXPOSURE_STEP = 0.05;
const EXPOSURE_LABEL_DIGITS = 2;
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
                onClick={() =>
                    closeMenuThen({
                        action: () =>
                            reportCommandFailure(
                                stores,
                                stores.dispatcher.dispatch({ type: COMMAND_TYPE.CLEAR_SCENE, payload: {} }, stores),
                            ),
                        onClose,
                    })
                }
            >
                <DeleteSweepIcon fontSize={COMPACT_SIZE} sx={{ mr: PILL_GAP }} />
                {clearLabel}
            </MenuItem>
            <Divider />
            <MenuItem
                onClick={() =>
                    closeMenuThen({
                        action: () => toggleRenderQuality(stores),
                        onClose,
                    })
                }
            >
                {TEXT.RENDER_QUALITY}
                <Typography sx={{ ml: MENU_SHORTCUT_MARGIN }} variant="caption">
                    {stores.studio.profile.label}
                </Typography>
            </MenuItem>
            {/* 滑杆直接在菜单内交互:stopPropagation 防方向键被 MenuList 抢走 */}
            <Box
                onKeyDown={(event) => event.stopPropagation()}
                sx={{ px: 2, py: 0.5, minWidth: GRID_SLIDER_MIN_WIDTH_PX }}
            >
                <Typography color="text.secondary" variant="caption">
                    {`${TEXT.GRID_SIZE}（${stores.studio.gridSizeMeters}${TEXT.METER_UNIT}）`}
                </Typography>
                <GridSizeSlider />
            </Box>
            <MenuItem onClick={() => toggleFrameRateVisible(stores)}>
                {TEXT.SHOW_FRAME_RATE}
                <Switch
                    checked={stores.studio.frameRateVisible}
                    onChange={() => toggleFrameRateVisible(stores)}
                    onClick={(event) => event.stopPropagation()}
                    size={COMPACT_SIZE}
                    slotProps={{ input: { "aria-label": TEXT.SHOW_FRAME_RATE } }}
                    sx={{ ml: MENU_SHORTCUT_MARGIN }}
                />
            </MenuItem>
            <Divider />
            <Box
                onKeyDown={(event) => event.stopPropagation()}
                sx={{ px: 2, py: 0.5, minWidth: GRID_SLIDER_MIN_WIDTH_PX }}
            >
                <Typography color="text.secondary" variant="caption">
                    {`${TEXT.EXPOSURE}（${stores.studio.exposure.toFixed(EXPOSURE_LABEL_DIGITS)}×）`}
                </Typography>
                <ExposureSlider />
            </Box>
        </Menu>
    );
});
function closeMenuThen({ action, onClose }: { readonly action: () => void; readonly onClose: () => void }): void {
    action();
    onClose();
}

/**
 * 地板尺寸滑杆:拖拽期只走本地草稿,松手才发一条命令。
 * 逐帧 dispatch 会把一次拖拽记成上百条撤销步,同时让整档演播室状态每帧写一次文档快照。
 */
const GridSizeSlider = observer(function GridSizeSlider() {
    const stores = useDirectorDeskStores();
    const committed = stores.studio.gridSizeMeters;
    const [draft, setDraft] = useState<number | null>(null);

    return (
        <Slider
            aria-label={TEXT.GRID_SIZE}
            max={GRID_SIZE.MAX_METERS}
            min={GRID_SIZE.MIN_METERS}
            onChange={(_, value) => {
                if (typeof value === "number") setDraft(value);
            }}
            onChangeCommitted={(_, value) => {
                setDraft(null);
                if (typeof value !== "number" || value === committed) return;
                reportCommandFailure(
                    stores,
                    stores.dispatcher.dispatch(
                        { type: COMMAND_TYPE.SET_GRID_SIZE, payload: { meters: value } },
                        stores,
                    ),
                );
            }}
            size={COMPACT_SIZE}
            value={draft ?? committed}
        />
    );
});

/**
 * 曝光滑杆:与地板尺寸滑杆同纪律——拖拽期只走本地草稿,松手才发一条命令。
 * 逐帧 dispatch 会把一次拖拽记成上百条撤销步。
 */
const ExposureSlider = observer(function ExposureSlider() {
    const stores = useDirectorDeskStores();
    const committed = stores.studio.exposure;
    const [draft, setDraft] = useState<number | null>(null);

    return (
        <Slider
            aria-label={TEXT.EXPOSURE}
            max={EXPOSURE.MAX}
            min={EXPOSURE.MIN}
            onChange={(_, value) => {
                if (typeof value === "number") setDraft(value);
            }}
            onChangeCommitted={(_, value) => {
                setDraft(null);
                if (typeof value !== "number" || value === committed) return;
                reportCommandFailure(
                    stores,
                    stores.dispatcher.dispatch(
                        { type: COMMAND_TYPE.SET_EXPOSURE, payload: { exposure: value } },
                        stores,
                    ),
                );
            }}
            size={COMPACT_SIZE}
            step={EXPOSURE_STEP}
            value={draft ?? committed}
        />
    );
});

/**
 * 地板颜色:应用内取色面板(`ColorField`,MUI 无颜色组件,自绘而不引第二套 UI 库,红线 7)。
 *
 * 原先用 `<input type="color">`,弹的是操作系统色板窗口——它的 Esc 由系统消费,页面收不到按键,
 * 「Esc 应用当前色并关闭」无从实现。`ColorField` 把 Esc 与点击面板外收敛到同一条关闭路径:
 * 先提交当前色再关面板,不存在丢弃出口。
 *
 * 提交仍是一次调节一条命令:拖拽期只走面板内部草稿,松手/关闭才 dispatch,不制造撤销碎片。
 * 此处不给 `onPreview`——地面颜色由 store 驱动着色,绕过命令层直写 three 违反红线 8。
 *
 * 实心地面关闭时禁用:颜色只作用在那张实心面上,关掉后画面只剩网格线,
 * 此时可调的取色块会让作者以为改了没生效。禁用把「先开地面」这个前置条件显性化。
 */
const FloorColorPicker = observer(function FloorColorPicker() {
    const stores = useDirectorDeskStores();

    return (
        <ColorField
            ariaLabel={TEXT.FLOOR_COLOR}
            disabled={!stores.studio.floorSurfaceEnabled}
            value={stores.studio.floorColor}
            swatches={FLOOR_COLOR_PALETTE}
            onCommit={(color) =>
                reportCommandFailure(
                    stores,
                    stores.dispatcher.dispatch({ type: COMMAND_TYPE.SET_FLOOR_COLOR, payload: { color } }, stores),
                )
            }
        />
    );
});

function toggleFloorSurface(stores: DirectorDeskStores): void {
    reportCommandFailure(
        stores,
        stores.dispatcher.dispatch(
            { type: COMMAND_TYPE.SET_FLOOR_SURFACE, payload: { enabled: !stores.studio.floorSurfaceEnabled } },
            stores,
        ),
    );
}

function toggleShadows(stores: DirectorDeskStores): void {
    reportCommandFailure(
        stores,
        stores.dispatcher.dispatch(
            { type: COMMAND_TYPE.SET_SHADOWS, payload: { enabled: !stores.studio.shadowsEnabled } },
            stores,
        ),
    );
}

function toggleEnvironmentLighting(stores: DirectorDeskStores): void {
    reportCommandFailure(
        stores,
        stores.dispatcher.dispatch(
            {
                type: COMMAND_TYPE.SET_ENVIRONMENT_LIGHTING,
                payload: { enabled: !stores.studio.environmentLightingEnabled },
            },
            stores,
        ),
    );
}

function toggleRenderQuality(stores: DirectorDeskStores): void {
    const quality =
        stores.studio.renderQuality === RENDER_QUALITY.HIGH ? RENDER_QUALITY.PERFORMANCE : RENDER_QUALITY.HIGH;
    reportCommandFailure(
        stores,
        stores.dispatcher.dispatch({ type: COMMAND_TYPE.SET_RENDER_QUALITY, payload: { quality } }, stores),
    );
}

function toggleFrameRateVisible(stores: DirectorDeskStores): void {
    reportCommandFailure(
        stores,
        stores.dispatcher.dispatch(
            { type: COMMAND_TYPE.SET_FRAME_RATE_VISIBLE, payload: { visible: !stores.studio.frameRateVisible } },
            stores,
        ),
    );
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

/** 跟拍世界扫掠只供排查:独立于总路径开关,默认不显示。 */
const FollowSweepPathToggle = observer(function FollowSweepPathToggle() {
    const stores = useDirectorDeskStores();
    const active = stores.motionAuthoring.sweepPathVisible;
    return (
        <Tooltip title={TEXT.FOLLOW_SWEEP_PATH_HINT}>
            <IconButton
                aria-label={TEXT.FOLLOW_SWEEP_PATH}
                aria-pressed={active}
                onClick={() =>
                    reportCommandFailure(
                        stores,
                        stores.dispatcher.dispatch(
                            { type: COMMAND_TYPE.SET_SWEEP_PATH, payload: { visible: !active } },
                            stores,
                        ),
                    )
                }
                size={COMPACT_SIZE}
                sx={active ? ACTIVE_TOOL_SX : undefined}
            >
                <RouteIcon fontSize={COMPACT_SIZE} />
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

/**
 * 成像效果组(投影 / 环境光照 / 实心地面 / 地板颜色)。
 *
 * 从项目菜单提到顶栏常驻:它们是**用来反复对比画面的**——开一下看质感、关一下看反差,
 * 与地板尺寸、画质档那类「设一次就走」的配置不同,每次对比都要展开菜单是纯粹的往返成本。
 * 菜单里不再重复出现,同一控件只保留一个入口。
 *
 * 归一组:都在回答「这一帧长什么样」。与相邻的编排辅助物开关(轨迹/走位)隔一条分隔线,
 * 后者回答的是「作者看到哪些辅助线」,不进成片。
 * 地板颜色紧贴实心地面,且随它禁用——颜色只作用在那张面上。
 *
 * 命令经 dispatcher 而非直写 store:成像档位进撤销栈并随文档往返(同菜单原路径)。
 */
const ShadowsToggle = observer(function ShadowsToggle() {
    const stores = useDirectorDeskStores();
    const active = stores.studio.shadowsEnabled;
    return (
        <Tooltip title={`${TEXT.SHOW_SHADOWS} · ${TEXT.SHOW_SHADOWS_HINT}`}>
            <IconButton
                aria-label={TEXT.SHOW_SHADOWS}
                aria-pressed={active}
                onClick={() => toggleShadows(stores)}
                size={COMPACT_SIZE}
                sx={active ? ACTIVE_TOOL_SX : undefined}
            >
                <ContrastIcon fontSize={COMPACT_SIZE} />
            </IconButton>
        </Tooltip>
    );
});

const EnvironmentLightingToggle = observer(function EnvironmentLightingToggle() {
    const stores = useDirectorDeskStores();
    const active = stores.studio.environmentLightingEnabled;
    return (
        <Tooltip title={`${TEXT.ENVIRONMENT_LIGHTING} · ${TEXT.ENVIRONMENT_LIGHTING_HINT}`}>
            <IconButton
                aria-label={TEXT.ENVIRONMENT_LIGHTING}
                aria-pressed={active}
                onClick={() => toggleEnvironmentLighting(stores)}
                size={COMPACT_SIZE}
                sx={active ? ACTIVE_TOOL_SX : undefined}
            >
                <WbSunnyIcon fontSize={COMPACT_SIZE} />
            </IconButton>
        </Tooltip>
    );
});

const FloorSurfaceToggle = observer(function FloorSurfaceToggle() {
    const stores = useDirectorDeskStores();
    const active = stores.studio.floorSurfaceEnabled;
    return (
        <Tooltip title={`${TEXT.FLOOR_SURFACE} · ${TEXT.FLOOR_SURFACE_HINT}`}>
            <IconButton
                aria-label={TEXT.FLOOR_SURFACE}
                aria-pressed={active}
                onClick={() => toggleFloorSurface(stores)}
                size={COMPACT_SIZE}
                sx={active ? ACTIVE_TOOL_SX : undefined}
            >
                <LayersIcon fontSize={COMPACT_SIZE} />
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

/** 右侧工具栏:所有操作统一为带 Tooltip 的图标按钮;宿主最右扩展位固定在全部内置控件之后。 */
const OutputPill = observer(function OutputPill() {
    return (
        <Paper variant="pill" className="pointer-events-auto" sx={PILL_SX}>
            <HistoryControls />
            <Divider flexItem orientation="vertical" sx={{ mx: DIVIDER_MARGIN_X }} />
            <GizmoToggle />
            <Divider flexItem orientation="vertical" sx={{ mx: DIVIDER_MARGIN_X }} />
            <PathHelperToggle />
            <FollowSweepPathToggle />
            <WalkDraftToggle />
            <Divider flexItem orientation="vertical" sx={{ mx: DIVIDER_MARGIN_X }} />
            <ShadowsToggle />
            <EnvironmentLightingToggle />
            <FloorSurfaceToggle />
            <FloorColorPicker />
            <Divider flexItem orientation="vertical" sx={{ mx: DIVIDER_MARGIN_X }} />
            <CaptureControls />
            <ToolbarExtensionButtons />
            <PresentationControl />
            <TrailingExtensionButtons />
            <Divider flexItem orientation="vertical" sx={PROJECT_MENU_DIVIDER_SX} />
            <ShortcutHelpControl />
            <ProjectMenuControl />
            <RightmostExtensionButtons />
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

/** 宿主扩展按钮的单一渲染实现(三槽位共用):空表不渲染、不占位;点击回调宿主全接管,组件不附加默认行为 */
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

/** 尾部扩展位(全屏预览右侧、项目菜单左侧)。 */
const TrailingExtensionButtons = observer(function TrailingExtensionButtons() {
    const { presentation } = useDirectorDeskStores();
    return renderExtensionButtons(presentation.trailingExtensions);
});

/** 最右扩展位:唯一位于全部内置控件之后,最后一项固定为工具栏最右元素。 */
const RightmostExtensionButtons = observer(function RightmostExtensionButtons() {
    const { presentation } = useDirectorDeskStores();
    return renderExtensionButtons(presentation.rightmostExtensions);
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
