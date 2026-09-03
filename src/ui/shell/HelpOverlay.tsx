import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import { formatShortcutHint, SHORTCUT_SPECS } from "@/shortcuts/builtinShortcuts";
import type { ShortcutScope } from "@/shortcuts/ShortcutRegistry";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

const DIALOG_TITLE = "快捷键";
const DIALOG_MAX_WIDTH_PX = 1440;
const DIALOG_VIEWPORT_GAP_PX = 32;
const SHORTCUT_SCENE_COLUMN_COUNT = 5;
const SHORTCUT_SCENE_GRID_GAP = 2;

interface ShortcutScene {
    readonly label: string;
    readonly scopes: readonly ShortcutScope[];
}

const SHORTCUT_SCENES = [
    { label: "通用", scopes: ["global"] },
    { label: "场景编辑", scopes: ["selected", "gizmo", "draft"] },
    { label: "机位与镜头", scopes: ["shot-selected", "shot", "lens"] },
    { label: "时间线", scopes: ["timeline", "timeline-selection"] },
    { label: "预览", scopes: ["presentation"] },
] as const satisfies readonly ShortcutScene[];
const KBD_SX = {
    minWidth: "4.5rem",
    px: 1,
    py: 0.25,
    border: 1,
    borderColor: "divider",
    borderRadius: 1,
    bgcolor: "action.hover",
    textAlign: "center",
    fontFamily: "monospace",
    fontSize: "0.75rem",
    lineHeight: 1.5,
} as const;
const HELP_DIALOG_SX = {
    "& .MuiDialog-paper": {
        maxWidth: DIALOG_MAX_WIDTH_PX,
        width: `calc(100vw - ${DIALOG_VIEWPORT_GAP_PX}px)`,
    },
} as const;
const SHORTCUT_SCENE_GRID_SX = {
    display: "grid",
    gap: SHORTCUT_SCENE_GRID_GAP,
    gridTemplateColumns: `repeat(${SHORTCUT_SCENE_COLUMN_COUNT}, minmax(0, 1fr))`,
} as const;

/** 快捷键速查:提示与注册行为都从 SHORTCUT_SPECS 读取，禁止另维护一份按键表。 */
export const HelpOverlay = observer(function HelpOverlay() {
    const { ui } = useDirectorDeskStores();

    return (
        <Dialog open={ui.helpOpen} onClose={() => ui.toggleHelp()} maxWidth={false} sx={HELP_DIALOG_SX} fullWidth>
            <DialogTitle>{DIALOG_TITLE}</DialogTitle>
            <DialogContent sx={SHORTCUT_SCENE_GRID_SX}>
                {SHORTCUT_SCENES.map((scene) => (
                    <Box key={scene.label} className="space-y-2">
                        <Typography variant="subtitle2" color="text.secondary">
                            {scene.label}
                        </Typography>
                        {scene.scopes
                            .flatMap((scope) => SHORTCUT_SPECS.filter((spec) => spec.scope === scope))
                            .map((spec) => (
                                <Box key={spec.id} className="flex items-center justify-between gap-4">
                                    <Typography variant="body2">{spec.label}</Typography>
                                    <Box component="kbd" sx={KBD_SX}>
                                        {formatShortcutHint(spec.id)}
                                    </Box>
                                </Box>
                            ))}
                    </Box>
                ))}
            </DialogContent>
        </Dialog>
    );
});
