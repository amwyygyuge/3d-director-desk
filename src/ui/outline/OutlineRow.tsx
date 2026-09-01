import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import type { MouseEvent, ReactNode } from "react";

const ROW_PADDING_Y = 0.25;
/** 让位右侧两个动作图标,文字不会钻到它们底下 */
const ROW_ACTIONS_PADDING_RIGHT = 9;
const ROW_SX = {
    py: ROW_PADDING_Y,
    pr: ROW_ACTIONS_PADDING_RIGHT,
    "&.Mui-selected": {
        bgcolor: "primary.main",
        color: "primary.contrastText",
        "& .MuiListItemIcon-root": { color: "inherit" },
    },
} as const;

export interface OutlineRowProps {
    readonly actions: ReactNode;
    readonly icon: ReactNode;
    readonly label: string;
    readonly onSelect: (event: MouseEvent<HTMLElement>) => void;
    readonly secondary?: string | undefined;
    readonly selected: boolean;
}

/**
 * 大纲行的通用外壳。
 *
 * 它没有领域身份(不知道自己画的是机位还是场景实体),按 props 边界纪律的**叶子例外**接收值;
 * 领域行(`ShotOutlineRow` / `EntityOutlineRow`)各自 `observer` 自取状态后再喂给它。
 */
export function OutlineRow({ actions, icon, label, onSelect, secondary, selected }: OutlineRowProps) {
    return (
        <ListItem disablePadding secondaryAction={actions}>
            <ListItemButton selected={selected} aria-label={`选择 ${label}`} onClick={onSelect} sx={ROW_SX}>
                <ListItemIcon className="min-w-8">{icon}</ListItemIcon>
                <ListItemText
                    primary={label}
                    {...(secondary === undefined ? {} : { secondary })}
                    slotProps={{ primary: { noWrap: true, title: label } }}
                    sx={{ minWidth: 0 }}
                />
            </ListItemButton>
        </ListItem>
    );
}
