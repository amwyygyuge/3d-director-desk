import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { CAPTURE_PROFILE } from "@/capture/CaptureProfile";
import {
    DEFAULT_STAGE_COMPOSITION,
    STAGE_COMPOSITION_RANGE,
    STAGE_GAZE,
    STAGE_PRESET,
    stagePresetSlots,
} from "@/command/stageCommands";
import type { StageComposition, StageGaze, StagePresetId } from "@/command/stageCommands";
import type { InspectorSectionProps, ReportCommandResult } from "@/ui/inspector/Inspector";
import { INSPECTOR_FIELD_SX } from "@/ui/inspector/TransformFields";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

const STAGE_MIN_MODELS = 2;
const SECTION_GAP = 1.5;
const SLOT_GAP = 0.75;
const FIELD_GAP = 0.75;
const CHIP_GAP = 0.5;
const SLOT_LABEL_WIDTH = 16;
const BALANCE_STEP = 0.05;
const SPREAD_STEP = 0.05;
const COMPOSITION_DECIMALS = 2;
const SELECT_SX = { flex: 1, minWidth: 0 } as const;

const STAGE_PRESET_IDS = Object.values(STAGE_PRESET) as readonly StagePresetId[];

const STAGE_PRESET_LABEL: Record<StagePresetId, string> = {
    [STAGE_PRESET.FACE_OFF]: "对峙",
    [STAGE_PRESET.SIDE_BY_SIDE]: "并肩",
    [STAGE_PRESET.TRIANGLE]: "三角",
    [STAGE_PRESET.DEPTH_LINEUP]: "纵深",
};

/** UI 只暴露无需拾取目标的三种视线;gaze=point 需视口点选,留给 AI/后续拾取器 */
const UI_GAZES: readonly StageGaze[] = [STAGE_GAZE.ANCHOR, STAGE_GAZE.MUTUAL, STAGE_GAZE.CAMERA];
const STAGE_GAZE_LABEL: Record<StageGaze, string> = {
    [STAGE_GAZE.ANCHOR]: "看对方",
    [STAGE_GAZE.MUTUAL]: "互瞪",
    [STAGE_GAZE.CAMERA]: "看镜头",
    [STAGE_GAZE.POINT]: "看指定点",
};

interface SlotDraft {
    readonly objectId: string;
    readonly poseHint: string;
    readonly gaze: string;
}
const EMPTY_SLOT_DRAFT: SlotDraft = { objectId: "", poseHint: "", gaze: "" };

/** tab 可见性谓词:纯函数,observer 渲染期求值即追踪 */
export function hasStageableScene(stores: Pick<DirectorDeskStores, "scene">): boolean {
    return stores.scene.manager.list().filter((entity) => entity.kind === "model").length >= STAGE_MIN_MODELS;
}

/** 按序把可用实体(优先当前选中)填进配方槽位;槽多于实体时留空,由 canApply 拦截 */
function seedAssign(
    slots: readonly string[],
    preferredIds: readonly string[],
    modelIds: readonly string[],
): Record<string, SlotDraft> {
    return Object.fromEntries(
        slots.map((slot, index) => [
            slot,
            { ...EMPTY_SLOT_DRAFT, objectId: preferredIds[index] ?? modelIds[index] ?? "" },
        ]),
    );
}

function stageSlotPayload(slot: string, draft: SlotDraft): Record<string, string> {
    return {
        slot,
        objectId: draft.objectId,
        ...(draft.poseHint ? { poseHint: draft.poseHint } : {}),
        ...(draft.gaze ? { gaze: draft.gaze } : {}),
    };
}

const PresetChips = observer(function PresetChips({
    presetId,
    onSelect,
}: {
    presetId: StagePresetId;
    onSelect: (next: StagePresetId) => void;
}) {
    return (
        <Box>
            <Typography variant="overline">配方</Typography>
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: CHIP_GAP }}>
                {STAGE_PRESET_IDS.map((id) => (
                    <Chip
                        key={id}
                        size="small"
                        label={STAGE_PRESET_LABEL[id]}
                        color={presetId === id ? "primary" : "default"}
                        variant={presetId === id ? "filled" : "outlined"}
                        onClick={() => onSelect(id)}
                    />
                ))}
            </Stack>
        </Box>
    );
});

/** 槽位行(自取实体/姿势清单);draft 是本地 UI 态,作值传入叶子控件 */
const SlotRow = observer(function SlotRow({
    slot,
    draft,
    onPatch,
}: {
    slot: string;
    draft: SlotDraft;
    onPatch: (patch: Partial<SlotDraft>) => void;
}) {
    const stores = useDirectorDeskStores();
    const models = stores.scene.manager.list().filter((entity) => entity.kind === "model");
    const poses = stores.posePresets.list();
    return (
        <Stack direction="row" spacing={FIELD_GAP} sx={{ alignItems: "center" }}>
            <Typography variant="caption" color="text.secondary" sx={{ width: SLOT_LABEL_WIDTH }}>
                {slot.toUpperCase()}
            </Typography>
            <Select
                size="small"
                value={draft.objectId}
                displayEmpty
                onChange={(event) => onPatch({ objectId: event.target.value })}
                sx={SELECT_SX}
            >
                <MenuItem value="">
                    <em>选实体</em>
                </MenuItem>
                {models.map((entity) => (
                    <MenuItem key={entity.id} value={entity.id}>
                        {entity.name}
                    </MenuItem>
                ))}
            </Select>
            <Select
                size="small"
                value={draft.poseHint}
                displayEmpty
                onChange={(event) => onPatch({ poseHint: event.target.value })}
                sx={SELECT_SX}
            >
                <MenuItem value="">
                    <em>姿势·无</em>
                </MenuItem>
                {poses.map((preset) => (
                    <MenuItem key={preset.id} value={preset.id}>
                        {preset.labelZh}
                    </MenuItem>
                ))}
            </Select>
            <Select
                size="small"
                value={draft.gaze}
                displayEmpty
                onChange={(event) => onPatch({ gaze: event.target.value })}
                sx={SELECT_SX}
            >
                <MenuItem value="">
                    <em>视线·默认</em>
                </MenuItem>
                {UI_GAZES.map((gaze) => (
                    <MenuItem key={gaze} value={gaze}>
                        {STAGE_GAZE_LABEL[gaze]}
                    </MenuItem>
                ))}
            </Select>
        </Stack>
    );
});

const CompositionSlider = observer(function CompositionSlider({
    label,
    value,
    range,
    step,
    onChange,
}: {
    label: string;
    value: number;
    range: { readonly min: number; readonly max: number };
    step: number;
    onChange: (next: number) => void;
}) {
    return (
        <Box>
            <Typography variant="caption" color="text.secondary">
                {label} {value.toFixed(COMPOSITION_DECIMALS)}
            </Typography>
            <Slider
                size="small"
                min={range.min}
                max={range.max}
                step={step}
                value={value}
                aria-label={label}
                onChange={(_, next) => {
                    if (typeof next === "number") onChange(next);
                }}
            />
        </Box>
    );
});

const CompositionControls = observer(function CompositionControls({
    composition,
    onChange,
}: {
    composition: StageComposition;
    onChange: (next: StageComposition) => void;
}) {
    return (
        <Box>
            <Typography variant="overline">构图</Typography>
            <CompositionSlider
                label="平衡"
                value={composition.balance}
                range={STAGE_COMPOSITION_RANGE.balance}
                step={BALANCE_STEP}
                onChange={(balance) => onChange({ ...composition, balance })}
            />
            <CompositionSlider
                label="疏密"
                value={composition.spread}
                range={STAGE_COMPOSITION_RANGE.spread}
                step={SPREAD_STEP}
                onChange={(spread) => onChange({ ...composition, spread })}
            />
            <Stack direction="row" sx={{ alignItems: "center", gap: FIELD_GAP, mt: CHIP_GAP }}>
                <Button size="small" onClick={() => onChange({ ...composition, seed: composition.seed + 1 })}>
                    🎲 换一版
                </Button>
                <Typography variant="caption" color="text.secondary">
                    seed {composition.seed}
                </Typography>
            </Stack>
        </Box>
    );
});

/** 交接产物:摆完一键出中性首帧/参考片(封入 prompt 与被摄体身份);产物走既有采集停靠层 */
const HandoffButtons = observer(function HandoffButtons({ report }: { report: ReportCommandResult }) {
    const stores = useDirectorDeskStores();
    const emit = (profileId: string): void =>
        report(stores.dispatcher.dispatch({ type: "capture.bundle", payload: { profileId } }, stores));
    return (
        <Box>
            <Typography variant="overline">交接给视频模型</Typography>
            <Stack direction="row" sx={{ gap: FIELD_GAP, flexWrap: "wrap" }}>
                <Button size="small" variant="outlined" onClick={() => emit(CAPTURE_PROFILE.I2V_HERO)}>
                    出 i2v 首帧
                </Button>
                <Button size="small" variant="outlined" onClick={() => emit(CAPTURE_PROFILE.V2V_CLIP)}>
                    出 v2v 参考片
                </Button>
            </Stack>
        </Box>
    );
});

/**
 * 布景 tab:配方 + 槽位(实体/姿势/视线)+ 构图,一次 scene.stage 聚合命令落地(撤销一步全组回原);
 * 底部一键出视频模型交接产物。draft 全是本地 UI 态(useState 白名单),应用时才写领域状态。
 * 构图无独立预览通道(transform 即 observable),故按「应用」提交而非拖拽实时——保撤销一条一记录。
 */
export const StagingSection = observer(function StagingSection({ report }: InspectorSectionProps) {
    const stores = useDirectorDeskStores();
    const modelIds = stores.scene.manager
        .list()
        .filter((entity) => entity.kind === "model")
        .map((entity) => entity.id);
    const selectedModelIds = stores.selection.selectedIds.filter((id) => modelIds.includes(id));
    const [presetId, setPresetId] = useState<StagePresetId>(STAGE_PRESET.FACE_OFF);
    const [assign, setAssign] = useState<Record<string, SlotDraft>>(() =>
        seedAssign(stagePresetSlots(STAGE_PRESET.FACE_OFF), selectedModelIds, modelIds),
    );
    const [composition, setComposition] = useState<StageComposition>(DEFAULT_STAGE_COMPOSITION);
    const slots = stagePresetSlots(presetId);

    const choosePreset = (next: StagePresetId): void => {
        setPresetId(next);
        setAssign(seedAssign(stagePresetSlots(next), selectedModelIds, modelIds));
    };
    const patchSlot = (slot: string, patch: Partial<SlotDraft>): void =>
        setAssign((current) => ({ ...current, [slot]: { ...(current[slot] ?? EMPTY_SLOT_DRAFT), ...patch } }));

    const canApply = slots.every((slot) => (assign[slot] ?? EMPTY_SLOT_DRAFT).objectId.length > 0);
    const apply = (): void => {
        if (!canApply) return;
        const payloadSlots = slots.map((slot) => stageSlotPayload(slot, assign[slot] ?? EMPTY_SLOT_DRAFT));
        report(
            stores.dispatcher.dispatch(
                { type: "scene.stage", payload: { presetId, slots: payloadSlots, composition } },
                stores,
            ),
        );
    };

    return (
        <Stack sx={INSPECTOR_FIELD_SX} spacing={SECTION_GAP}>
            <PresetChips presetId={presetId} onSelect={choosePreset} />
            <Stack spacing={SLOT_GAP}>
                {slots.map((slot) => (
                    <SlotRow
                        key={slot}
                        slot={slot}
                        draft={assign[slot] ?? EMPTY_SLOT_DRAFT}
                        onPatch={(patch) => patchSlot(slot, patch)}
                    />
                ))}
            </Stack>
            <CompositionControls composition={composition} onChange={setComposition} />
            <Button size="small" variant="contained" disabled={!canApply} onClick={apply}>
                应用布景
            </Button>
            <HandoffButtons report={report} />
        </Stack>
    );
});
