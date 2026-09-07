import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import { OUTPUT_FORMAT_ORDER, outputFormatFor } from "@/output/OutputFormat";
import type { OutputFormatId } from "@/output/OutputFormat";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

const FORMAT_GRID_COLUMNS = "repeat(2, minmax(0, 1fr))";
const FORMAT_TILE_MIN_HEIGHT_PX = 68;
const FORMAT_ICON_MAX_HEIGHT_PX = 22;
const FORMAT_ICON_MAX_WIDTH_PX = 42;
const FORMAT_TILE_GAP = 0.75;
const FORMAT_ICON_BORDER_RADIUS = 0.5;
const ADAPTIVE_ICON_ASPECT_RATIO = 16 / 9;
const OUTPUT_GRID_LABEL = "显示九宫格";

/** 项目输出画幅选择器：界面只发命令，当前值从 OutputSettings 聚合晚解引用。 */
export const OutputFormatSelector = observer(function OutputFormatSelector() {
    const stores = useDirectorDeskStores();
    const selectFormat = (formatId: OutputFormatId): void => {
        const result = stores.dispatcher.dispatch({ type: "output.set-format", payload: { formatId } }, stores);
        reportCommandFailure(stores, result);
    };

    return (
        <Box>
            <Typography color="text.secondary" variant="caption">
                选择画幅比例
            </Typography>
            <Box
                sx={{
                    display: "grid",
                    gap: FORMAT_TILE_GAP,
                    gridTemplateColumns: FORMAT_GRID_COLUMNS,
                    mt: FORMAT_TILE_GAP,
                }}
            >
                {OUTPUT_FORMAT_ORDER.map((formatId) => {
                    const format = outputFormatFor(formatId);
                    const isSelected = stores.output.formatId === formatId;
                    return (
                        <ButtonBase
                            key={formatId}
                            aria-pressed={isSelected}
                            onClick={() => selectFormat(formatId)}
                            sx={{
                                alignItems: "center",
                                border: 1,
                                borderColor: isSelected ? "primary.main" : "divider",
                                borderRadius: 1,
                                display: "grid",
                                gap: FORMAT_TILE_GAP,
                                justifyItems: "center",
                                minHeight: FORMAT_TILE_MIN_HEIGHT_PX,
                                px: FORMAT_TILE_GAP,
                                py: 1,
                                "&:hover": { borderColor: "primary.light" },
                            }}
                        >
                            <Box
                                aria-hidden
                                sx={{
                                    aspectRatio: format.aspectRatio ?? ADAPTIVE_ICON_ASPECT_RATIO,
                                    border: 1,
                                    borderColor: "text.secondary",
                                    borderRadius: FORMAT_ICON_BORDER_RADIUS,
                                    maxHeight: FORMAT_ICON_MAX_HEIGHT_PX,
                                    maxWidth: FORMAT_ICON_MAX_WIDTH_PX,
                                    width: "100%",
                                }}
                            />
                            <Typography variant="caption">{format.label}</Typography>
                        </ButtonBase>
                    );
                })}
            </Box>
            <FormControlLabel
                control={
                    <Switch
                        checked={stores.layout.outputGridVisible}
                        onChange={() => stores.layout.toggleOutputGridVisible()}
                        size="small"
                        slotProps={{ input: { "aria-label": OUTPUT_GRID_LABEL } }}
                    />
                }
                label={OUTPUT_GRID_LABEL}
                sx={{ mt: FORMAT_TILE_GAP }}
            />
        </Box>
    );
});
