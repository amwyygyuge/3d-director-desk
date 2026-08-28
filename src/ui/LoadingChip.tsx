import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react";

import { useDirectorDeskStores } from "./DirectorDeskContext";

const EMPTY_LOADING_COUNT = 0;
const LOADING_CHIP_ELEVATION = 2;
const LOADING_ITEM_SPACING = 1;
const PROGRESS_PERCENT_SCALE = 100;


/** 底部加载反馈:由 UiStore 的资源标签和进度驱动。 */
export const LoadingChip = observer(function LoadingChip() {
    const { ui } = useDirectorDeskStores();
    if (ui.loading.size === EMPTY_LOADING_COUNT) return null;

    return (
        <Paper
            elevation={LOADING_CHIP_ELEVATION}
            className="absolute bottom-3 left-1/2 z-[1] w-72 -translate-x-1/2 px-3 py-2"
        >
            <Stack spacing={LOADING_ITEM_SPACING}>
                {Array.from(ui.loading, ([label, progress01]) => {
                    const percent = Math.round(progress01 * PROGRESS_PERCENT_SCALE);
                    return (
                        <Box key={label}>
                            <Box className="flex items-center justify-between gap-2">
                                <Typography variant="caption">{label}</Typography>
                                <Typography variant="caption">{percent}%</Typography>
                            </Box>
                            <LinearProgress variant="determinate" value={percent} />
                        </Box>
                    );
                })}
            </Stack>
        </Paper>
    );
});
