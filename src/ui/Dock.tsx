import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/** 停靠方向 → 折叠态尺寸与图标的查表(纪律:禁 if 链) */
const DOCK_SIDE_META = {
    left: {
        railClass: "w-8",
        expandIcon: <ChevronRightIcon fontSize="small" />,
        collapseIcon: <ChevronLeftIcon fontSize="small" />,
    },
    right: {
        railClass: "w-8",
        expandIcon: <ChevronLeftIcon fontSize="small" />,
        collapseIcon: <ChevronRightIcon fontSize="small" />,
    },
    bottom: {
        railClass: "h-8",
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
 * 停靠栏容器:面板与画布永不重叠的布局原子。
 * 折叠态渲染为细条(rail)只留展开按钮;展开态为正常面板,右上角(底部栏为右侧)收起按钮。
 * 布局纪律:Dock 在文档流内占格,禁 absolute 压画布。
 */
export function Dock({ side, title, collapsed, onToggle, children }: DockProps) {
    const meta = DOCK_SIDE_META[side];

    if (collapsed) {
        return (
            <Paper elevation={2} square className={`flex shrink-0 items-center justify-center ${meta.railClass}`}>
                <Tooltip title={`展开${title}`}>
                    <IconButton size="small" onClick={onToggle} aria-label={`展开${title}`}>
                        {meta.expandIcon}
                    </IconButton>
                </Tooltip>
            </Paper>
        );
    }

    const horizontal = side === "bottom";
    return (
        <Paper elevation={2} square className={`flex shrink-0 flex-col overflow-hidden ${horizontal ? "" : "h-full"}`}>
            <div
                className={`flex items-center justify-between px-2 py-1 ${horizontal ? "" : "border-b border-white/10"}`}
            >
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
