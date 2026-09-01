import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import type { SceneObjectKind } from "../../core/SceneObject";
import { formatShortcutHint, SHORTCUT_ID } from "../../shortcuts/builtinShortcuts";
import type { DirectorDeskStores } from "../DirectorDeskContext";
import { useDirectorDeskStores } from "../DirectorDeskContext";
import { Inspector } from "../Inspector";
import { CHROME } from "../theme";

const INSPECTOR_TOP_PX = 80;
const INSPECTOR_BOTTOM_PX = 88;
const HEADER_BACKGROUND = "rgba(0,0,0,0.22)";
const HEADER_PADDING_X = 1.5;
const HEADER_PADDING_Y = 1;
const HEADER_BORDER_WIDTH = 1;
const TIMELINE_HINT_BACKGROUND = "rgba(99,102,241,0.10)";
const TIMELINE_HINT_BORDER = "1px solid rgba(99,102,241,0.22)";
const TIMELINE_HINT_BORDER_RADIUS = 1;
const TIMELINE_HINT_PADDING = 1;

type InspectorSelectionKind = SceneObjectKind | "camera-shot";

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
    model: "MODEL SELECTED",
    light: "LIGHT SELECTED",
    camera: "CAMERA SELECTED",
    "camera-shot": "SHOT SELECTED",
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
    const { layout, selection } = stores;
    const primaryId = selection.primaryId;
    const selected = primaryId === null ? null : inspectorSelectionFor({ stores, primaryId });

    if (!layout.authoringVisible || selected === null) return null;

    return (
        <Paper
            variant="panel"
            className="pointer-events-auto absolute right-[16px] z-20 flex flex-col"
            sx={{
                top: INSPECTOR_TOP_PX,
                bottom: INSPECTOR_BOTTOM_PX,
                width: CHROME.inspectorWidthPx,
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
                    <IconButton size="small" aria-label="关闭检查器" onClick={() => selection.clear()}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Box>
            <Box className="min-h-0 flex-1 overflow-auto">
                <Inspector />
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
