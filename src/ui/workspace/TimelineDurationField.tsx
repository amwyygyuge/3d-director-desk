import Box from "@mui/material/Box";
import InputBase from "@mui/material/InputBase";
import Tooltip from "@mui/material/Tooltip";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { SetTimelineDurationCommand } from "@/command/timelineCommands";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { MONO_FONT_STACK } from "@/ui/shell/theme";

const TOOLTIP = "工程时长(秒);缩短到最后一枚关键帧之前会被拒绝";
const INPUT_WIDTH_PX = 56;
const MIN_SECONDS = 1;

const READOUT_SX = {
    cursor: "pointer",
    fontFamily: MONO_FONT_STACK,
    fontWeight: 400,
    color: "text.secondary",
    "&:hover": { color: "text.primary" },
} as const;

const INPUT_SX = {
    width: INPUT_WIDTH_PX,
    fontFamily: MONO_FONT_STACK,
    fontWeight: 400,
    color: "text.primary",
    "& input": { p: 0, textAlign: "right" },
} as const;

/**
 * 工程时长的唯一编辑入口。
 *
 * 命令 timeline.set-duration 早就在,却一直没有调用方——时长因此是个界面上改不了的常量,
 * 走位一长就撞墙。这里补上入口:草绘只会把时间轴**撑长**,收短是作者对成片长度的决策。
 * 草稿是一次输入的瞬时态(useState 白名单),提交才经命令层。
 */
export const TimelineDurationField = observer(function TimelineDurationField() {
    const stores = useDirectorDeskStores();
    const duration = stores.timeline.document.duration;
    const [draft, setDraft] = useState<string | null>(null);

    const commit = (raw: string): void => {
        setDraft(null);
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < MIN_SECONDS || parsed === duration) return;
        reportCommandFailure(
            stores,
            stores.dispatcher.dispatch(
                { type: SetTimelineDurationCommand.TYPE, payload: { duration: parsed } },
                stores,
            ),
        );
    };

    if (draft === null) {
        return (
            <Tooltip title={TOOLTIP}>
                <Box component="span" onClick={() => setDraft(String(duration))} sx={READOUT_SX}>
                    {formatDuration(duration)}
                </Box>
            </Tooltip>
        );
    }
    return (
        <InputBase
            autoFocus
            inputProps={{ min: MIN_SECONDS, step: 1 }}
            onFocus={(event) => event.target.select()}
            onBlur={(event) => commit(event.target.value)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === "Enter") commit((event.target as HTMLInputElement).value);
                if (event.key === "Escape") setDraft(null);
            }}
            sx={INPUT_SX}
            type="number"
            value={draft}
        />
    );
});

/** 与时间码同形的只读展示:mm:ss:ff 太长,时长用「12.3s」更直观且不推挤迷你轨。 */
function formatDuration(seconds: number): string {
    return `${seconds.toFixed(1)}s`;
}
