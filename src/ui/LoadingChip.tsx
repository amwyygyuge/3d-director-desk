import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import { useDirectorDeskStores } from "./DirectorDeskContext";

const EMPTY_LOADING_COUNT = 0;
const LOADING_ITEM_SPACING = 1;
const PROGRESS_PERCENT_SCALE = 100;

/** 底部加载反馈:由 UiStore 的资源标签和进度驱动。 */
export const LoadingChip = observer(function LoadingChip() {
    const { ui } = useDirectorDeskStores();
    if (ui.loading.size === EMPTY_LOADING_COUNT) return null;

    return (
        <Paper
            variant="panel"
            className="absolute bottom-[88px] left-1/2 z-[1] max-h-[calc(100%-9rem)] w-72 max-w-[calc(100%-1.5rem)] -translate-x-1/2 overflow-y-auto px-3 py-2"
        >
            <Stack spacing={LOADING_ITEM_SPACING}>
                {Array.from(ui.loading, ([label, progress01]) => {
                    const percent = Math.round(progress01 * PROGRESS_PERCENT_SCALE);
                    return (
                        <Box key={label}>
                            <Box className="flex min-w-0 items-center justify-between gap-2">
                                <Typography variant="caption" className="min-w-0 break-words">
                                    {label}
                                </Typography>
                                <Typography variant="caption" className="shrink-0">
                                    {percent}%
                                </Typography>
                            </Box>
                            <LinearProgress
                                variant="determinate"
                                value={percent}
                                aria-label={`${label} 加载进度`}
                                aria-valuetext={`${percent}%`}
                            />
                        </Box>
                    );
                })}
            </Stack>
        </Paper>
    );
});
