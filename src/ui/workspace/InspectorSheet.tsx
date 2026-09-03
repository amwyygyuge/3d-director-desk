import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";

import type { CommandResult } from "@/command/DirectorCommand";
import { EASING, EASING_LABEL } from "@/motion/EasingCurve";
import { SHORTCUT_ID, formatShortcutHint } from "@/shortcuts/builtinShortcuts";
import { SHELL_MODE } from "@/store/WorkbenchLayoutStore";
import type { InspectorSectionContext, InspectorSelectionKind } from "@/ui/inspector/inspectorTabs";
import { inspectorTabs } from "@/ui/inspector/inspectorTabs";
import { TabbedSections } from "@/ui/patterns/TabbedSections";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { CHROME, reviewInspectorBottomOffsetPx, sidePanelBottomOffsetPx } from "@/ui/shell/theme";

const HEADER_BACKGROUND = "rgba(0,0,0,0.22)";
const HEADER_PADDING_X = 1.5;
const HEADER_PADDING_Y = 1;
const HEADER_BORDER_WIDTH = 1;
const TIMELINE_HINT_BACKGROUND = "rgba(99,102,241,0.10)";
const TIMELINE_HINT_BORDER = "1px solid rgba(99,102,241,0.22)";
const TIMELINE_HINT_BORDER_RADIUS = 1;
const TIMELINE_HINT_PADDING = 1;

const REVIEW_BAR_GAP = 0.5;
const REVIEW_BAR_PADDING = 0.5;
const REVIEW_BUTTON_SIZE = "small" as const;
const REVIEW_DELETE_COLOR = "error" as const;

interface InspectorSelection {
    readonly kind: InspectorSelectionKind;
    readonly name: string;
    readonly isSceneEntity: boolean;
}

const INSPECTOR_SELECTION_LABEL: Record<InspectorSelectionKind, string> = {
    model: "已选模型",
    light: "已选灯光",
    camera: "已选相机",
    "camera-shot": "已选机位",
    "motion-clip": "已选运镜片段",
    "motion-track": "已选走位轨迹",
};

function inspectorSelectionFor(
    stores: Pick<DirectorDeskStores, "camera" | "scene">,
    primaryId: string,
): InspectorSelection | null {
    const shot = stores.camera.director.getShot(primaryId);
    if (shot) return { kind: "camera-shot", name: primaryId, isSceneEntity: false };
    const entity = stores.scene.manager.getEntity(primaryId);
    return entity ? { kind: entity.kind, name: entity.name, isSceneEntity: true } : null;
}

/** 检查器目标:选中身份与解析结果的成对出口。 */
export interface InspectorTarget {
    readonly primaryId: string;
    readonly selection: InspectorSelection;
}

/**
 * 解析当前检查器目标;无选中、非编辑态或选中对象已不存在时为 null(检查器不渲染)。
 * 检查器本体与产物停靠层(CaptureProductDock)的让位判定共用同一真相源,禁各自推导。
 */
export function resolveInspectorTarget(stores: DirectorDeskStores): InspectorTarget | null {
    const { selection, timelineSelection } = stores;
    const motionClipId = selection.primaryId === null ? timelineSelection.current.motionClipId : null;
    const walkTrackId = selection.primaryId === null ? timelineSelection.current.walkTrackId : null;
    const primaryId = motionClipId ?? walkTrackId ?? selection.primaryId;
    if (!stores.layout.authoringVisible || primaryId === null) return null;
    if (motionClipId && stores.motion.clip(motionClipId)) {
        return { primaryId, selection: { kind: "motion-clip", name: motionClipId, isSceneEntity: false } };
    }
    if (walkTrackId && stores.timeline.document.track(walkTrackId)) {
        return { primaryId, selection: { kind: "motion-track", name: walkTrackId, isSceneEntity: false } };
    }
    const resolved = inspectorSelectionFor(stores, primaryId);
    return resolved === null ? null : { primaryId, selection: resolved };
}

/** review 只挂预览片段的三项高频操作，完整检查器及其分区不留在树中。 */
const ReviewInspectorBar = observer(function ReviewInspectorBar() {
    const stores = useDirectorDeskStores();
    const clipId = stores.motionAuthoring.previewClipId;
    const clip = clipId ? stores.motion.clip(clipId) : undefined;
    if (!clip) return null;
    const nextEasing = clip.easing === EASING.SMOOTH ? EASING.LINEAR : EASING.SMOOTH;

    const dispatch = (type: string, payload: Record<string, string>): void => {
        const result = stores.dispatcher.dispatch({ type, payload }, stores);
        if (!result.ok) stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
    };

    return (
        <Paper
            variant="panel"
            aria-label="镜头预览控制"
            className="pointer-events-auto absolute z-20 flex items-center"
            sx={{
                right: CHROME.edgeGapPx,
                bottom: reviewInspectorBottomOffsetPx(),
                width: CHROME.reviewInspectorWidthPx,
                height: CHROME.reviewInspectorHeightPx,
                gap: REVIEW_BAR_GAP,
                p: REVIEW_BAR_PADDING,
            }}
        >
            <Button
                size={REVIEW_BUTTON_SIZE}
                onClick={() => dispatch("motion.preview.exit", {})}
                sx={{ whiteSpace: "nowrap" }}
            >
                退出预览
            </Button>
            <Button
                size={REVIEW_BUTTON_SIZE}
                onClick={() => dispatch("motion.set-clip-easing", { id: clip.id, easing: nextEasing })}
                sx={{ whiteSpace: "nowrap" }}
            >
                缓动：{EASING_LABEL[clip.easing]}
            </Button>
            <Tooltip title="删除片段">
                <IconButton
                    aria-label="删除片段"
                    color={REVIEW_DELETE_COLOR}
                    onClick={() => dispatch("motion.remove-clip", { id: clip.id })}
                    size={REVIEW_BUTTON_SIZE}
                >
                    <DeleteOutlineIcon fontSize={REVIEW_BUTTON_SIZE} />
                </IconButton>
            </Tooltip>
        </Paper>
    );
});

/** 仅在存在选中对象时出现的情境检查器，关闭操作复用全局清选中语义。 */
export const InspectorSheet = observer(function InspectorSheet() {
    const stores = useDirectorDeskStores();
    const { layout, ui } = stores;
    const target = resolveInspectorTarget(stores);

    // 选中对象切换时退出骨骼点选:姿态选择是瞬时 UI 身份,不跨对象残留
    const primaryId = target?.primaryId ?? null;
    useEffect(() => {
        if (ui.posePickingObjectId !== null && ui.posePickingObjectId !== primaryId) {
            ui.setPosePicking(null, null);
        }
    }, [ui, primaryId]);

    if (!layout.chromeVisible) return null;
    if (layout.shellMode === SHELL_MODE.REVIEW) return <ReviewInspectorBar />;
    if (target === null) return null;
    const selected = target.selection;

    // 命令失败只走全局 ApplicationNotice 一条通道;右栏不再自带 Snackbar
    const report = (result: CommandResult) => {
        if (result.ok) return;
        ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
    };
    const context: InspectorSectionContext = { primaryId: target.primaryId, report, stores };
    // 时间轴选中与场景选中是两条独立通道;关掉右栏时清哪一条由当前展示的种类决定
    const clearInspector = (): void => {
        const isTimelineSelection = selected.kind === "motion-clip" || selected.kind === "motion-track";
        if (isTimelineSelection) {
            stores.timelineSelection.clear();
            return;
        }
        stores.selection.clear();
    };

    return (
        <Paper
            variant="panel"
            className="pointer-events-auto absolute z-20 flex flex-col"
            sx={{
                right: CHROME.edgeGapPx,
                top: CHROME.sidePanelTopPx,
                // 下缘骑在时间线控制台上方,随其开合联动;几何与左侧导航共用同一真相源
                bottom: sidePanelBottomOffsetPx(stores.layout.timelineExpanded),
                width: CHROME.sidePanelWidthPx,
                overflow: "hidden",
            }}
        >
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: HEADER_PADDING_X,
                    px: HEADER_PADDING_X,
                    py: HEADER_PADDING_Y,
                    bgcolor: HEADER_BACKGROUND,
                    borderBottom: HEADER_BORDER_WIDTH,
                    borderColor: "divider",
                }}
            >
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="overline" color="primary">
                        {INSPECTOR_SELECTION_LABEL[selected.kind]}
                    </Typography>
                    <Typography variant="subtitle2" noWrap title={selected.name}>
                        {selected.name}
                    </Typography>
                </Box>

                <Tooltip title={`清除选中 (${formatShortcutHint(SHORTCUT_ID.CLEAR_SELECTION)})`}>
                    <IconButton size="small" aria-label="关闭检查器" onClick={clearInspector}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Box>
            <Box className="min-h-0 flex-1 overflow-auto">
                <TabbedSections
                    tabs={inspectorTabs.tabsFor(selected.kind)}
                    activeTabId={ui.inspectorTabFor(selected.kind)}
                    onSelect={(tabId) => ui.setInspectorTab(selected.kind, tabId)}
                    context={context}
                />
            </Box>
            {selected.isSceneEntity && (
                <Paper
                    elevation={0}
                    sx={{
                        m: TIMELINE_HINT_PADDING,
                        p: TIMELINE_HINT_PADDING,
                        bgcolor: TIMELINE_HINT_BACKGROUND,
                        border: TIMELINE_HINT_BORDER,
                        borderRadius: TIMELINE_HINT_BORDER_RADIUS,
                    }}
                >
                    <Typography variant="caption" color="primary.light">
                        使用底部时间线，可为该对象记录关键帧轨迹
                    </Typography>
                </Paper>
            )}
        </Paper>
    );
});
