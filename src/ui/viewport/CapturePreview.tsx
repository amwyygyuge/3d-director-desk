import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

/** 最近截图预览角标:点击新窗口打开 blob;证明 capture-produced 产物可用 */
export const CapturePreview = observer(function CapturePreview() {
    const { ui } = useDirectorDeskStores();
    if (!ui.lastCaptureUrl) return null;

    return (
        <Paper
            elevation={3}
            component="a"
            href={ui.lastCaptureUrl}
            target="_blank"
            rel="noreferrer"
            sx={{
                position: "absolute",
                right: 12,
                bottom: 12,
                p: 0.5,
                zIndex: 1,
                display: "block",
                textDecoration: "none",
            }}
        >
            <img src={ui.lastCaptureUrl} alt="最近截图" style={{ display: "block", width: 160, borderRadius: 4 }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center" }}>
                最近截图(点击打开)
            </Typography>
        </Paper>
    );
});
