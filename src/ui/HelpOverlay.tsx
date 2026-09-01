import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { Fragment } from "react";

import { formatShortcutHint, SHORTCUT_SPECS } from "../shortcuts/builtinShortcuts";
import type { ShortcutScope } from "../shortcuts/ShortcutRegistry";
import { useDirectorDeskStores } from "./DirectorDeskContext";

const DIALOG_TITLE = "快捷键";
const FIRST_GROUP_INDEX = 0;
const SHORTCUT_SCOPE_LABELS: Record<ShortcutScope, string> = {
    global: "全局",
    rail: "左栏面板展开时",
    gizmo: "选中对象后",
    "shot-selected": "选中机位后",
    shot: "掌镜中",
    presentation: "全屏预览中",
};
const SHORTCUT_SCOPE_ORDER = Object.keys(SHORTCUT_SCOPE_LABELS) as ShortcutScope[];
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

/** 快捷键速查:提示与注册行为都从 SHORTCUT_SPECS 读取，禁止另维护一份按键表。 */
export const HelpOverlay = observer(function HelpOverlay() {
    const { ui } = useDirectorDeskStores();

    return (
        <Dialog open={ui.helpOpen} onClose={() => ui.toggleHelp()} maxWidth="xs" fullWidth>
            <DialogTitle>{DIALOG_TITLE}</DialogTitle>
            <DialogContent className="space-y-4">
                {SHORTCUT_SCOPE_ORDER.map((scope, index) => (
                    <Fragment key={scope}>
                        {index !== FIRST_GROUP_INDEX ? <Divider /> : null}
                        <Box className="space-y-2">
                            <Typography variant="subtitle2" color="text.secondary">
                                {SHORTCUT_SCOPE_LABELS[scope]}
                            </Typography>
                            {SHORTCUT_SPECS.filter((spec) => spec.scope === scope).map((spec) => (
                                <Box key={spec.id} className="flex items-center justify-between gap-4">
                                    <Typography variant="body2">{spec.label}</Typography>
                                    <Box component="kbd" sx={KBD_SX}>
                                        {formatShortcutHint(spec.id)}
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    </Fragment>
                ))}
            </DialogContent>
        </Dialog>
    );
});
