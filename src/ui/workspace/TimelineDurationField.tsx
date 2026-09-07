import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import InputBase from "@mui/material/InputBase";
import Tooltip from "@mui/material/Tooltip";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { TimelineContentSpan } from "@/authoring/TimelineContentSpan";
import { ScaleTimelineCommand, SetTimelineDurationCommand } from "@/command/timelineCommands";
import type { CommandIssueOption } from "@/command/DirectorCommand";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { MONO_FONT_STACK } from "@/ui/shell/theme";

const INPUT_WIDTH_PX = 56;

const READOUT_SX = {
    cursor: "pointer",
    fontFamily: MONO_FONT_STACK,
    fontWeight: 400,
    color: "text.secondary",
    borderBottom: "1px dashed currentColor",
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
 * 工程时长的唯一编辑入口。缩短被内容阻断时，命令的结构化下一步直接变成可执行操作。
 */
export const TimelineDurationField = observer(function TimelineDurationField() {
    const stores = useDirectorDeskStores();
    const duration = stores.timeline.document.duration;
    const content = TimelineContentSpan.fromDocument(
        stores.timeline,
        stores.motion,
        stores.scene.manager,
        stores.animations,
    );
    const blocker = content.blockers[0];
    const [draft, setDraft] = useState<string | null>(null);
    const [rejection, setRejection] = useState<{
        readonly requestedDuration: number;
        readonly options: readonly CommandIssueOption[];
    } | null>(null);

    const commit = (raw: string): void => {
        setDraft(null);
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed === duration) return;
        const result = stores.dispatcher.dispatch(
            { type: SetTimelineDurationCommand.TYPE, payload: { duration: parsed } },
            stores,
        );
        if (result.ok) {
            setRejection(null);
            return;
        }
        const options = result.issueDetails?.flatMap((issue) => issue.options ?? []) ?? [];
        setRejection(options.length > 0 ? { requestedDuration: parsed, options } : null);
        reportCommandFailure(stores, result);
    };
    const dispatchOption = (type: string): void => {
        const payload =
            type === ScaleTimelineCommand.TYPE
                ? { factor: rejection ? rejection.requestedDuration / duration : 1 }
                : EMPTY_PAYLOAD;
        const result = stores.dispatcher.dispatch({ type, payload }, stores);
        if (result.ok) setRejection(null);
        reportCommandFailure(stores, result);
    };
    const tooltip = blocker
        ? `最短 ${formatDuration(content.endSeconds)}（受 ${blocker.label} 限制）`
        : `最短 ${formatDuration(content.endSeconds)}（当前没有时间轴内容）`;

    return (
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
            {draft === null ? (
                <Tooltip title={tooltip}>
                    <Box component="span" onClick={() => setDraft(String(duration))} sx={READOUT_SX}>
                        {formatDuration(duration)}
                    </Box>
                </Tooltip>
            ) : (
                <InputBase
                    autoFocus
                    inputProps={{ min: content.endSeconds, step: 1 }}
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
            )}
            {rejection?.options.map((option) => (
                <Button key={option.type} onClick={() => dispatchOption(option.type)} size="small" variant="text">
                    {option.label}
                </Button>
            ))}
        </Box>
    );
});

const EMPTY_PAYLOAD: Record<string, never> = {};

/** 与时间码同形的只读展示:mm:ss:ff 太长,时长用「12.3s」更直观且不推挤迷你轨。 */
function formatDuration(seconds: number): string {
    return `${seconds.toFixed(1)}s`;
}
