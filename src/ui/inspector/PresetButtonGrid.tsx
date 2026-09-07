import Box from "@mui/material/Box";
import Button from "@mui/material/Button";

const PRESET_GRID_TEMPLATE_COLUMNS = "repeat(2, minmax(0, 1fr))";
const PRESET_BUTTON_MIN_HEIGHT_PX = 40;

export interface PresetButtonItem {
    readonly id: string;
    readonly label: string;
}

export interface PresetButtonGridProps {
    readonly items: readonly PresetButtonItem[];
    readonly onApply: (id: string) => void;
}

/** 检查器里动作/姿势预设的统一按钮网格;不同数据源只负责映射 id 与标签。 */
export function PresetButtonGrid({ items, onApply }: PresetButtonGridProps) {
    return (
        <Box sx={{ display: "grid", gap: 0.5, gridTemplateColumns: PRESET_GRID_TEMPLATE_COLUMNS }}>
            {items.map((item) => (
                <Button
                    key={item.id}
                    size="small"
                    variant="outlined"
                    sx={{ minHeight: PRESET_BUTTON_MIN_HEIGHT_PX, px: 0.75, py: 0.5 }}
                    onClick={() => onApply(item.id)}
                >
                    {item.label}
                </Button>
            ))}
        </Box>
    );
}
