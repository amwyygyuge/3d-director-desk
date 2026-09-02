import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";

import type { CommandResult } from "@/command/DirectorCommand";
import { formatShortcutHint, SHORTCUT_ID } from "@/shortcuts/builtinShortcuts";
import type { InspectorSectionContext, InspectorSelectionKind } from "@/ui/inspector/inspectorTabs";
import { inspectorTabs } from "@/ui/inspector/inspectorTabs";
import { TabbedSections } from "@/ui/patterns/TabbedSections";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { CHROME, sidePanelBottomOffsetPx } from "@/ui/shell/theme";

const HEADER_BACKGROUND = "rgba(0,0,0,0.22)";
const HEADER_PADDING_X = 1.5;
const HEADER_PADDING_Y = 1;
const HEADER_BORDER_WIDTH = 1;
const TIMELINE_HINT_BACKGROUND = "rgba(99,102,241,0.10)";
const TIMELINE_HINT_BORDER = "1px solid rgba(99,102,241,0.22)";
const TIMELINE_HINT_BORDER_RADIUS = 1;
const TIMELINE_HINT_PADDING = 1;

interface InspectorSelection {
    readonly kind: InspectorSelectionKind;
    readonly name: string;
    readonly isSceneEntity: boolean;
}

interface InspectorSelectionLookup {
    readonly stores: Pick<DirectorDeskStores, "camera" | "scene">;
    readonly primaryId: string;
}

const INSPECTOR_SELECTION_LABEL: Record<InspectorSelectionKind, string> = {
    model: "已选模型",
    light: "已选灯光",
    camera: "已选相机",
    "camera-shot": "已选机位",
    "motion-clip": "已选运镜片段",
    "motion-track": "已选走位轨迹",
};

function inspectorSelectionFor({ stores, primaryId }: InspectorSelectionLookup): InspectorSelection | null {
    const shot = stores.camera.director.getShot(primaryId);
    if (shot) return { kind: "camera-shot", name: primaryId, isSceneEntity: false };
    const entity = stores.scene.manager.getEntity(primaryId);
    return entity ? { kind: entity.kind, name: entity.name, isSceneEntity: true } : null;
}

/** 仅在存在选中对象时出现的情境检查器，关闭操作复用全局清选中语义。 */
export const InspectorSheet = observer(function InspectorSheet() {
    const stores = useDirectorDeskStores();
    const { layout, selection, ui } = stores;
    const motionClipId = selection.primaryId === null ? stores.motionAuthoring.selectedClipId : null;
    const walkTrackId = selection.primaryId === null ? stores.motionAuthoring.selectedWalkTrackId : null;
    const primaryId = motionClipId ?? walkTrackId ?? selection.primaryId;

    // 选中对象切换时退出骨骼点选:姿态选择是瞬时 UI 身份,不跨对象残留
    useEffect(() => {
        if (ui.posePickingObjectId !== null && ui.posePickingObjectId !== primaryId) {
            ui.setPosePicking(null, null);
        }
    }, [ui, primaryId]);

    if (!layout.authoringVisible || primaryId === null) return null;
    const selected =
        motionClipId && stores.motion.clip(motionClipId)
            ? { kind: "motion-clip" as const, name: motionClipId, isSceneEntity: false }
            : walkTrackId && stores.timeline.document.track(walkTrackId)
              ? { kind: "motion-track" as const, name: walkTrackId, isSceneEntity: false }
              : inspectorSelectionFor({ stores, primaryId });
    if (selected === null) return null;

    // 命令失败只走全局 ApplicationNotice 一条通道;右栏不再自带 Snackbar
    const report = (result: CommandResult) => {
        if (result.ok) return;
        ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
    };
    const context: InspectorSectionContext = { primaryId, report, stores };
    const clearInspector = (): void => {
        switch (selected.kind) {
            case "motion-clip":
                stores.motionAuthoring.selectClip(null);
                return;
            case "motion-track":
                stores.motionAuthoring.selectWalkTrack(null);
                return;
            default:
                selection.clear();
        }
    };

    return (
        <Paper
            variant="panel"
            className="pointer-events-auto absolute z-20 flex flex-col"
            sx={{
                right: CHROME.edgeGapPx,
                top: CHROME.sidePanelTopPx,
                // 下缘骑在时间线控制台上方,随其开合联动;几何与左侧导航共用同一真相源
                bottom: sidePanelBottomOffsetPx(layout.timelineExpanded),
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
