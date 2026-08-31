import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/**
 * 左右 Dock 顶部让位悬浮工具栏:工具栏 top-3(12px)+ 实测高约 45px + 12px 间距 = 69px;
 * 最大高度再扣底部 12px 边距。工具栏高度变化需同步此处。
 */
const DOCK_TOP_OFFSET = "top-[69px]";
const DOCK_MAX_HEIGHT = "max-h-[calc(100%-81px)]";

/** 停靠方向 → 悬浮定位与图标的查表(纪律:禁 if 链) */
const DOCK_SIDE_META = {
    left: {
        panelClass: `left-3 ${DOCK_TOP_OFFSET} ${DOCK_MAX_HEIGHT} w-[280px]`,
        chipClass: `left-3 ${DOCK_TOP_OFFSET}`,
        expandIcon: <ChevronRightIcon fontSize="small" />,
        collapseIcon: <ChevronLeftIcon fontSize="small" />,
    },
    right: {
        panelClass: `right-3 ${DOCK_TOP_OFFSET} ${DOCK_MAX_HEIGHT} w-[280px]`,
        chipClass: `right-3 ${DOCK_TOP_OFFSET}`,
        expandIcon: <ChevronLeftIcon fontSize="small" />,
        collapseIcon: <ChevronRightIcon fontSize="small" />,
    },
    bottom: {
        panelClass: "left-3 right-3 bottom-3",
        chipClass: "left-3 bottom-3",
        expandIcon: <ExpandMoreIcon fontSize="small" />,
        collapseIcon: <ExpandMoreIcon fontSize="small" />,
    },
} as const;

export type DockSide = keyof typeof DOCK_SIDE_META;

interface DockProps {
    readonly side: DockSide;
    readonly title: string;
    readonly collapsed: boolean;
    readonly onToggle: () => void;
    readonly children: ReactNode;
}

/**
 * 悬浮停靠面板:绝对定位压在画布上,画布永远全屏——
 * 折叠/展开不再引起画布重排(画面零跳动)。
 * 折叠态是边缘小钮,展开态是浮动面板。
 */
export function Dock({ side, title, collapsed, onToggle, children }: DockProps) {
    const meta = DOCK_SIDE_META[side];

    if (collapsed) {
        return (
            <Paper elevation={3} className={`absolute z-[2] ${meta.chipClass}`}>
                <Tooltip title={`展开${title}`}>
                    <IconButton size="small" onClick={onToggle} aria-label={`展开${title}`}>
                        {meta.expandIcon}
                    </IconButton>
                </Tooltip>
            </Paper>
        );
    }

    return (
        <Paper elevation={3} className={`absolute z-[2] flex flex-col overflow-hidden ${meta.panelClass}`}>
            <div className="flex items-center justify-between border-b border-white/10 px-2 py-1">
                <Typography variant="caption" color="text.secondary">
                    {title}
                </Typography>
                <Tooltip title={`收起${title}`}>
                    <IconButton size="small" onClick={onToggle} aria-label={`收起${title}`}>
                        {meta.collapseIcon}
                    </IconButton>
                </Tooltip>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </Paper>
    );
}
