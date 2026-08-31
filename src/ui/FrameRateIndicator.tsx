import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import { useDirectorDeskStores } from "./DirectorDeskContext";

const FPS_INDICATOR_ELEVATION = 2;
const EMPTY_FPS_LABEL = "FPS —";

/** 右上角真实 render FPS：仅更新展示，不参与帧循环或画布失效。 */
export const FrameRateIndicator = observer(function FrameRateIndicator() {
    const { frameRate } = useDirectorDeskStores();
    const label = frameRate.fps === 0 ? EMPTY_FPS_LABEL : `FPS ${frameRate.fps}`;

    return (
        <Paper
            elevation={FPS_INDICATOR_ELEVATION}
            className="pointer-events-none absolute right-3 top-14 z-[2] px-2 py-1"
            aria-label="当前渲染帧率"
        >
            <Typography variant="caption" className="font-mono tabular-nums">
                {label}
            </Typography>
        </Paper>
    );
});
