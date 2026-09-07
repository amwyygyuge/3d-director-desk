import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import type { ActionLoopMode } from "@/assets/ActionAsset";

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
export interface CategorizedPresetButtonItem extends PresetButtonItem {
    readonly loopMode: ActionLoopMode;
}

export interface CategorizedPresetButtonGridProps {
    readonly items: readonly CategorizedPresetButtonItem[];
    readonly onApply: (id: string) => void;
}

const ACTION_CATEGORY_ORDER: readonly ActionLoopMode[] = [ACTION_LOOP_MODE.LOOP, ACTION_LOOP_MODE.ONCE];
const ACTION_CATEGORY_LABEL: Record<ActionLoopMode, string> = {
    [ACTION_LOOP_MODE.LOOP]: "常驻动作",
    [ACTION_LOOP_MODE.ONCE]: "一次性动作",
};

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

/** 动作按持续语义分组呈现;按钮仅保留动作名，不再重复附加类型后缀。 */
export function CategorizedPresetButtonGrid({ items, onApply }: CategorizedPresetButtonGridProps) {
    return (
        <Box sx={{ display: "grid", gap: 1 }}>
            {ACTION_CATEGORY_ORDER.map((loopMode) => {
                const categoryItems = items.filter((item) => item.loopMode === loopMode);
                if (categoryItems.length === 0) return null;
                return (
                    <Box key={loopMode} sx={{ display: "grid", gap: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                            {ACTION_CATEGORY_LABEL[loopMode]}
                        </Typography>
                        <PresetButtonGrid items={categoryItems} onApply={onApply} />
                    </Box>
                );
            })}
        </Box>
    );
}
