import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import { ProgramReviewQuery } from "@/command/reviewCommands";
import type { ProgramReviewReport } from "@/review/ProgramReviewService";
import { TimelineSelection } from "@/authoring/TimelineSelection";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

const PANEL_PADDING = 1.5;
const ITEM_GAP = 0.75;
const TIME_DECIMAL_PLACES = 2;
const EMPTY_REVIEW_MESSAGE = "巡检结果暂不可用";
const EMPTY_SHOT_MESSAGE = "播放范围内还没有 Program 镜头";
const CLEAN_REVIEW_MESSAGE = "播放范围内的 Program 已连续且来源完整";
const REVIEW_TITLE = "成片巡检";
const SHOT_LIST_TITLE = "镜头单";

function formatSeconds(timeSeconds: number): string {
    return `${timeSeconds.toFixed(TIME_DECIMAL_PLACES)}s`;
}

function reviewReportFor(stores: DirectorDeskStores): ProgramReviewReport | null {
    const result = stores.dispatcher.query({ type: ProgramReviewQuery.TYPE, payload: {} }, stores);
    return result.ok ? (result.value as ProgramReviewReport) : null;
}

function locateAt(stores: DirectorDeskStores, timeSeconds: number): void {
    reportCommandFailure(stores, stores.dispatcher.dispatch({ type: "transport.seek", payload: { time: timeSeconds } }, stores));
}

/** 左栏只读成片工作台：Program 聚合的镜头单和巡检结论来自同一查询，不复制时间轴规则。 */
export const ProgramReviewPanel = observer(function ProgramReviewPanel() {
    const stores = useDirectorDeskStores();
    const report = reviewReportFor(stores);
    if (!report) return <Typography sx={{ p: PANEL_PADDING }}>{EMPTY_REVIEW_MESSAGE}</Typography>;
    const hasIssues = report.issues.length > 0;
    return (
        <Stack spacing={ITEM_GAP} sx={{ p: PANEL_PADDING }}>
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
                <Typography variant="subtitle2">{REVIEW_TITLE}</Typography>
                <Chip
                    color={hasIssues ? "warning" : "success"}
                    label={hasIssues ? `${report.issues.length} 项待处理` : "通过"}
                    size="small"
                />
            </Stack>
            <Typography color="text.secondary" variant="caption">
                {formatSeconds(report.range.inSeconds)} – {formatSeconds(report.range.outSeconds)}
            </Typography>
            {hasIssues ? (
                <Stack divider={<Divider flexItem />} spacing={ITEM_GAP}>
                    {report.issues.map((issue) => (
                        <Stack direction="row" key={`${issue.kind}-${issue.startSeconds}`} spacing={ITEM_GAP} sx={{ alignItems: "center" }}>
                            <Typography sx={{ flex: 1 }} variant="body2">
                                {issue.message}
                            </Typography>
                            <Button onClick={() => locateAt(stores, issue.startSeconds)} size="small">
                                定位
                            </Button>
                        </Stack>
                    ))}
                </Stack>
            ) : (
                <Typography color="text.secondary" variant="body2">
                    {CLEAN_REVIEW_MESSAGE}
                </Typography>
            )}
            <Divider />
            <Typography variant="subtitle2">{SHOT_LIST_TITLE}</Typography>
            {report.shots.length === 0 ? (
                <Typography color="text.secondary" variant="body2">
                    {EMPTY_SHOT_MESSAGE}
                </Typography>
            ) : (
                <Stack divider={<Divider flexItem />} spacing={ITEM_GAP}>
                    {report.shots.map((shot) => (
                        <Box key={shot.id}>
                            <Stack
                                direction="row"
                                spacing={ITEM_GAP}
                                sx={{ alignItems: "center", justifyContent: "space-between" }}
                            >
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography noWrap variant="body2">
                                        {shot.sourceLabel}
                                    </Typography>
                                    <Typography color="text.secondary" variant="caption">
                                        {formatSeconds(shot.startSeconds)} – {formatSeconds(shot.endSeconds)}
                                    </Typography>
                                </Box>
                                <Button
                                    color={shot.isSourceAvailable ? "primary" : "warning"}
                                    onClick={() => {
                                        stores.timelineSelection.select(TimelineSelection.programClip(shot.id));
                                        locateAt(stores, shot.startSeconds);
                                    }}
                                    size="small"
                                >
                                    定位
                                </Button>
                            </Stack>
                        </Box>
                    ))}
                </Stack>
            )}
        </Stack>
    );
});
