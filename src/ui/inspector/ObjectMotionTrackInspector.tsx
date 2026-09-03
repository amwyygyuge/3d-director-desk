import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import { SetTimelineTrackCommand } from "@/command/timelineCommands";
import type { InspectorSectionProps } from "@/ui/inspector/Inspector";
import { WalkPolicySection } from "@/ui/inspector/WalkPolicyControls";
import { INSPECTOR_FIELD_SX } from "@/ui/inspector/TransformFields";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

/**
 * 走位轨检查器：轨道是 TimelineDoc 聚合内的编排实体；关键帧只是其成员。
 * 删除整轨必须发一次 timeline.set-track 空轨命令，撤销时可原子还原全部关键帧与策略。
 */
export const ObjectMotionTrackSection = observer(function ObjectMotionTrackSection({
    primaryId: trackId,
    report,
}: InspectorSectionProps) {
    const stores = useDirectorDeskStores();
    const track = stores.timeline.document.track(trackId);
    const entity = track ? stores.scene.manager.getEntity(track.targetId) : undefined;
    if (!track) return null;

    const removeTrack = (): void => {
        const result = stores.dispatcher.dispatch(
            {
                type: SetTimelineTrackCommand.TYPE,
                payload: { trackId: track.id, targetId: track.targetId, keyframes: [] },
            },
            stores,
        );
        report(result);
    };

    return (
        <>
            <Box sx={INSPECTOR_FIELD_SX}>
                <Typography variant="overline">走位轨迹</Typography>
                <Typography variant="body2">绑定对象：{entity?.name ?? track.targetId}</Typography>
                <Typography color="text.secondary" variant="caption">
                    {track.keyframes.length} 个关键帧
                </Typography>
            </Box>
            <WalkPolicySection trackId={track.id} report={report} />
            <Box sx={INSPECTOR_FIELD_SX}>
                <Typography color="text.secondary" variant="caption">
                    删除后对象恢复权威变换；撤销可原样恢复整条轨迹。
                </Typography>
                <Button color="error" fullWidth onClick={removeTrack} size="small" variant="outlined">
                    删除整条轨迹
                </Button>
            </Box>
        </>
    );
});
