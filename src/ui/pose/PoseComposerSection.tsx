import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { BODY_PART } from "@/actor/mixamoSkeleton";
import type { BodyPart } from "@/actor/mixamoSkeleton";
import { hasActorProfile } from "@/ui/actor/ActorImageSection";
import { ModelActionSection } from "@/ui/inspector/Inspector";
import type { InspectorSectionProps, ReportCommandResult } from "@/ui/inspector/Inspector";
import { INSPECTOR_FIELD_SX } from "@/ui/inspector/TransformFields";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

const COLUMN_GRID = "repeat(2, minmax(0, 1fr))";
const CONTROL_GAP = 1;
const CHIP_GAP = 0.5;

interface PoseControlsProps {
    readonly objectId: string;
    readonly report: ReportCommandResult;
}

interface PoseColumnSpec {
    readonly part: BodyPart;
    readonly labelZh: string;
}

/** 上下半身互补且不相交,两列各自单选:换手势不必重选坐姿,姿势数量因此是乘法。 */
const POSE_COLUMNS: readonly PoseColumnSpec[] = [
    { part: BODY_PART.LOWER, labelZh: "下半身" },
    { part: BODY_PART.UPPER, labelZh: "上半身" },
];

type AppliedPresets = Partial<Record<BodyPart, string>>;

interface PoseColumnProps extends PoseControlsProps {
    readonly column: PoseColumnSpec;
    readonly appliedId: string | undefined;
    readonly onApplied: (part: BodyPart, presetId: string) => void;
}

/** 预设列表自取(库是 observable,自建预设保存后本列即时出现)。 */
const PosePresetColumn = observer(function PosePresetColumn({
    objectId,
    report,
    column,
    appliedId,
    onApplied,
}: PoseColumnProps) {
    const stores = useDirectorDeskStores();
    const isEditing = !stores.clock.isPlaying;
    const presets = stores.posePresets.list(column.part);

    const apply = (presetId: string) => {
        const result = stores.dispatcher.dispatch(
            { type: "pose.apply-preset", payload: { objectId, presetId } },
            stores,
        );
        report(result);
        if (result.ok) onApplied(column.part, presetId);
    };

    return (
        <Box>
            <Typography variant="caption" color="text.secondary">
                {column.labelZh}
            </Typography>
            <Stack sx={{ gap: CHIP_GAP, mt: CHIP_GAP }}>
                {presets.map((preset) => (
                    <Chip
                        key={preset.id}
                        size="small"
                        label={preset.labelZh}
                        disabled={!isEditing}
                        color={appliedId === preset.id ? "primary" : "default"}
                        variant={appliedId === preset.id ? "filled" : "outlined"}
                        onClick={() => apply(preset.id)}
                    />
                ))}
            </Stack>
        </Box>
    );
});

/** 自建预设:PoseSnapshot 本就可序列化,精修后一键入库,随工程文档走。 */
const SavePosePresetControls = observer(function SavePosePresetControls({ objectId, report }: PoseControlsProps) {
    const stores = useDirectorDeskStores();
    const [labelZh, setLabelZh] = useState("");
    const [part, setPart] = useState<BodyPart>(BODY_PART.UPPER);
    const hasPose = Boolean(stores.scene.manager.getEntity(objectId)?.pose);

    const save = () => {
        const result = stores.dispatcher.dispatch(
            { type: "pose.preset.save", payload: { objectId, labelZh, part } },
            stores,
        );
        report(result);
        if (result.ok) setLabelZh("");
    };

    return (
        <Stack sx={{ gap: CHIP_GAP, mt: CONTROL_GAP }}>
            <TextField
                size="small"
                label="存为我的姿势"
                value={labelZh}
                onChange={(event) => setLabelZh(event.target.value)}
            />
            <Stack direction="row" sx={{ gap: CHIP_GAP, alignItems: "center" }}>
                <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={part}
                    aria-label="保存部位"
                    sx={{ flex: 1 }}
                    onChange={(_, next: BodyPart | null) => {
                        if (next) setPart(next);
                    }}
                >
                    {POSE_COLUMNS.map((option) => (
                        <ToggleButton key={option.part} value={option.part} sx={{ flex: 1 }}>
                            {option.labelZh}
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>
                <Button
                    size="small"
                    variant="outlined"
                    disabled={!hasPose || labelZh.trim().length === 0}
                    onClick={save}
                >
                    保存
                </Button>
            </Stack>
        </Stack>
    );
});

/**
 * 姿势组合器:两列各自单选,选中态是本地瞬时 UI 态——实体只存骨骼旋转,不存预设身份,
 * 骨骼精修之后不会假装「还是那个预设」。
 */
const PoseCombinationPanel = observer(function PoseCombinationPanel({ objectId, report }: PoseControlsProps) {
    const stores = useDirectorDeskStores();
    const [applied, setApplied] = useState<AppliedPresets>({});
    const isEditing = !stores.clock.isPlaying;
    const hasPose = Boolean(stores.scene.manager.getEntity(objectId)?.pose);
    const onApplied = (part: BodyPart, presetId: string) => setApplied((current) => ({ ...current, [part]: presetId }));

    return (
        <Box sx={INSPECTOR_FIELD_SX}>
            <Typography variant="overline">姿势 / POSE</Typography>
            <Box sx={{ display: "grid", gap: CONTROL_GAP, gridTemplateColumns: COLUMN_GRID, mt: CHIP_GAP }}>
                {POSE_COLUMNS.map((column) => (
                    <PosePresetColumn
                        key={column.part}
                        objectId={objectId}
                        report={report}
                        column={column}
                        appliedId={applied[column.part]}
                        onApplied={onApplied}
                    />
                ))}
            </Box>
            <SavePosePresetControls objectId={objectId} report={report} />
            <Button
                size="small"
                color="warning"
                sx={{ mt: CHIP_GAP }}
                disabled={!isEditing || !hasPose}
                onClick={() =>
                    report(stores.dispatcher.dispatch({ type: "pose.clear", payload: { objectId } }, stores))
                }
            >
                清除姿势
            </Button>
            {!isEditing && (
                <Typography variant="caption" sx={{ display: "block" }}>
                    播放期间姿势编辑已禁用。
                </Typography>
            )}
        </Box>
    );
});

/** 姿势 tab:人偶的姿势组合器 + 动作分区(动作改的是 actionId,与静态姿势互斥)。 */
export const PoseComposerSection = observer(function PoseComposerSection({ primaryId, report }: InspectorSectionProps) {
    const stores = useDirectorDeskStores();

    return (
        <>
            {hasActorProfile(stores, primaryId) && <PoseCombinationPanel objectId={primaryId} report={report} />}
            <ModelActionSection primaryId={primaryId} report={report} />
        </>
    );
});
