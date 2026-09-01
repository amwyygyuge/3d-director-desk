import Box from "@mui/material/Box";
import List from "@mui/material/List";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

const EMPTY_COUNT = 0;

export interface OutlineSectionProps {
    readonly children: ReactNode;
    readonly count: number;
    readonly emptyHint: string;
    readonly title: string;
}

/** 大纲分组外壳:标题带计数,空态给出下一步动作提示而不是一句"无数据"。 */
export function OutlineSection({ children, count, emptyHint, title }: OutlineSectionProps) {
    return (
        <Box>
            <Typography variant="overline">{`${title} (${count})`}</Typography>
            {count === EMPTY_COUNT ? (
                <Typography variant="caption" color="text.secondary" component="p">
                    {emptyHint}
                </Typography>
            ) : (
                <List dense disablePadding aria-label={title}>
                    {children}
                </List>
            )}
        </Box>
    );
}
