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

/**
 * 动作分区标签描述**资产的天然语义**,不再叫「常驻/一次性」。
 *
 * 「常驻动作」是时间轴还没有排期概念时的遗留:那时循环动作确实一直挂着。
 * 现在每段动作都有明确时段,循环与否只说明它能不能无缝接续——
 * 而「拉长段条时怎么铺满」由排期的填充策略决定(见 ActionFillPolicy)。
 */
const ACTION_CATEGORY_ORDER: readonly ActionLoopMode[] = [ACTION_LOOP_MODE.LOOP, ACTION_LOOP_MODE.ONCE];
const ACTION_CATEGORY_LABEL: Record<ActionLoopMode, string> = {
    [ACTION_LOOP_MODE.LOOP]: "可循环",
    [ACTION_LOOP_MODE.ONCE]: "单次",
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
