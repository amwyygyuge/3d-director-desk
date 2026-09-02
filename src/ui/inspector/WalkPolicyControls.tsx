import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { SetTimelineTrackPoliciesCommand } from "@/command/timelineCommands";
import { GROUNDING_MODE, LOCOMOTION_MODE, ORIENTATION_MODE } from "@/timeline/TrackPolicies";
import type { OrientationMode, TrackPoliciesInit } from "@/timeline/TrackPolicies";
import { TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { InspectorSectionProps } from "@/ui/inspector/Inspector";
import { INSPECTOR_FIELD_SX } from "@/ui/inspector/TransformFields";

const STRIDE_STEP = 0.1;
const STRIDE_MIN = 0.1;
const STRIDE_INPUT_WIDTH_PX = 96;
const ORIENTATION_LABEL: Record<OrientationMode, string> = {
    [ORIENTATION_MODE.PATH]: "沿路径",
    [ORIENTATION_MODE.KEYED]: "关键帧",
};
const ORIENTATION_ORDER = [ORIENTATION_MODE.PATH, ORIENTATION_MODE.KEYED] as const;

/**
 * 走位策略编辑区:朝向 / 贴地 / 步频。
 *
 * 三者都是整条轨的意图(不是单帧属性),故按轨编辑、按轨撤销;写入一律经
 * timeline.set-track-policies,组件不碰 store。
 */
export const WalkPolicySection = observer(function WalkPolicySection({ primaryId, report }: InspectorSectionProps) {
    const stores = useDirectorDeskStores();
    const track = stores.timeline.document.trackForTarget(primaryId, TIMELINE_TRACK_KIND.TRANSFORM);
    const [strideDraft, setStrideDraft] = useState<string | null>(null);
    if (!track) return null;
    const policies = track.policies;

    const commit = (patch: TrackPoliciesInit): void => {
        report(
            stores.dispatcher.dispatch(
                { type: SetTimelineTrackPoliciesCommand.TYPE, payload: { trackId: track.id, policies: patch } },
                stores,
            ),
        );
    };

    const commitStride = (raw: string): void => {
        setStrideDraft(null);
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < STRIDE_MIN) return;
        commit({ strideMeters: parsed });
    };

    return (
        <Box sx={INSPECTOR_FIELD_SX}>
            <Typography variant="overline">走位 / LOCOMOTION</Typography>
            <ToggleButtonGroup
                exclusive
                fullWidth
                onChange={(_, next: OrientationMode | null) => next && commit({ orientation: next })}
                size="small"
                value={policies.orientation}
            >
                {ORIENTATION_ORDER.map((mode) => (
                    <ToggleButton key={mode} value={mode}>
                        {ORIENTATION_LABEL[mode]}
                    </ToggleButton>
                ))}
            </ToggleButtonGroup>
            <FormControlLabel
                control={
                    <Switch
                        checked={policies.isGrounded}
                        onChange={(event) =>
                            commit({
                                grounding: event.target.checked ? GROUNDING_MODE.GROUND : GROUNDING_MODE.NONE,
                            })
                        }
                        size="small"
                    />
                }
                label="贴地"
            />
            <FormControlLabel
                control={
                    <Switch
                        checked={policies.isLocomotionSynced}
                        onChange={(event) =>
                            commit({
                                locomotion: event.target.checked ? LOCOMOTION_MODE.SYNC : LOCOMOTION_MODE.FREE,
                            })
                        }
                        size="small"
                    />
                }
                label="动作跟随步幅"
            />
            {policies.isLocomotionSynced && (
                <TextField
                    helperText="一个动作循环推进的距离"
                    label="步幅 (m)"
                    slotProps={{ htmlInput: { step: STRIDE_STEP, min: STRIDE_MIN } }}
                    onBlur={(event) => commitStride(event.target.value)}
                    onChange={(event) => setStrideDraft(event.target.value)}
                    size="small"
                    sx={{ width: STRIDE_INPUT_WIDTH_PX }}
                    type="number"
                    value={strideDraft ?? String(policies.strideMeters)}
                />
            )}
        </Box>
    );
});
