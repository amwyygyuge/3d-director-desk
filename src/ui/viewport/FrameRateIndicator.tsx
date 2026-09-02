import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

const EMPTY_FPS_LABEL = "帧率 —";

/** 右上角真实渲染帧率:让位顶部输出药丸(48px 药丸 + 上下 16px 安全区),仅展示不参与帧循环。 */
export const FrameRateIndicator = observer(function FrameRateIndicator() {
    const stores = useDirectorDeskStores();
    if (!stores.layout.authoringVisible || !stores.layout.frameRateVisible) return null;
    const label = stores.frameRate.fps === 0 ? EMPTY_FPS_LABEL : `帧率 ${stores.frameRate.fps}`;
    return (
        <Paper
            variant="pill"
            className="pointer-events-none absolute right-4 top-[76px] z-[2] px-2 py-0.5"
            aria-label="当前渲染帧率"
        >
            <Typography variant="caption" className="font-mono tabular-nums">
                {label}
            </Typography>
        </Paper>
    );
});
