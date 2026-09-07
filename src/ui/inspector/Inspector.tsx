import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { DEFAULT_CAMERA_FOV } from "@/camera/CameraShot";
import { FOV_MAX, FOV_MIN } from "@/command/commands";
import type { CommandResult } from "@/command/DirectorCommand";
import { transformKeyCommandFor } from "@/command/timelineCommands";
import { TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";
import {
    isLightType,
    LIGHT_DECAY_MAX,
    LIGHT_DECAY_MIN,
    LIGHT_DISTANCE_MAX_METERS,
    LIGHT_DISTANCE_MIN_METERS,
    LIGHT_INTENSITY_MAX,
    LIGHT_INTENSITY_MIN,
    LIGHT_PENUMBRA_MAX,
    LIGHT_PENUMBRA_MIN,
    LIGHT_SPOT_ANGLE_MAX_DEGREES,
    LIGHT_SPOT_ANGLE_MIN_DEGREES,
    LIGHT_TYPES,
    retypeLightParams,
} from "@/core/LightParams";
import type { LightParams } from "@/core/LightParams";
import type { SceneObject, Vec3 } from "@/core/SceneObject";
import { ASSET_KIND } from "@/assets/catalog/AssetEntry";
import { ACTION_LOOP_MODE, ACTION_LOOP_MODE_LABEL } from "@/assets/ActionAsset";
import { listActionClips, presentEmbeddedClip } from "@/pose/PosePresetCatalog";
import { formatShortcutHint, SHORTCUT_ID } from "@/shortcuts/builtinShortcuts";
import { SCRUB_STEP } from "@/ui/controls/numberFieldConfig";
import type { ScrubKind } from "@/ui/controls/numberFieldConfig";
import { ScrubNumberField } from "@/ui/controls/ScrubNumberField";
import { invalidInputNotice } from "@/ui/shell/commandFeedback";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { PresetButtonGrid } from "@/ui/inspector/PresetButtonGrid";
import { INSPECTOR_FIELD_SX, TransformFields } from "@/ui/inspector/TransformFields";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { WalkPolicySection } from "@/ui/inspector/WalkPolicyControls";

const AXIS_X = 0;
const AXIS_Y = 1;
const AXIS_Z = 2;
const FIELD_GROUP_GAP = 1;
const FIELD_COLUMN_GAP = 0.5;

const FIELD_LABEL_WIDTH_PX = 32;
const NUMBER_COMPANION_WIDTH_PX = 96;
/** 与 INSPECTOR_FIELD_SX 的区内节奏同源:浮起标签上溢约 9px,小于 12px 会与上一控件相切 */
const CONTROL_GAP = 1.5;

type AxisIndex = typeof AXIS_X | typeof AXIS_Y | typeof AXIS_Z;
type ShotVectorKey = "position" | "target";
/** 检查器 section 标准 props:身份 id + 命令结果回调;stores 一律经 hook 自取(值型状态禁下传)。 */
export interface InspectorSectionProps {
    readonly primaryId: string;
    readonly report: ReportCommandResult;
}

interface ShotFieldsProps {
    shotId: string;
    report: ReportCommandResult;
}

interface ShotVectorFieldsProps {
    shotId: string;
    onCommit: (group: ShotVectorKey, axis: AxisIndex, value: number) => void;
}

interface ShotFovFieldProps {
    shotId: string;
    onCommit: (fov: number) => void;
}

const AXES: readonly { label: string; index: AxisIndex }[] = [
    { label: "X", index: AXIS_X },
    { label: "Y", index: AXIS_Y },
    { label: "Z", index: AXIS_Z },
];

const SHOT_VECTOR_GROUPS: readonly { key: ShotVectorKey; label: string }[] = [
    { key: "position", label: "位置" },
    { key: "target", label: "目标" },
];

function replaceAxis(vector: Vec3, axis: AxisIndex, value: number): Vec3 {
    switch (axis) {
        case AXIS_X:
            return [value, vector[AXIS_Y], vector[AXIS_Z]];
        case AXIS_Y:
            return [vector[AXIS_X], value, vector[AXIS_Z]];
        case AXIS_Z:
            return [vector[AXIS_X], vector[AXIS_Y], value];
    }
}

/** props 只收机位身份与提交回调;向量值自取,父组件不因坐标改动整片重渲。 */
const ShotVectorFields = observer(function ShotVectorFields({ shotId, onCommit }: ShotVectorFieldsProps) {
    const stores = useDirectorDeskStores();
    const shot = stores.camera.director.getShot(shotId);
    if (!shot) return null;
    return (
        <>
            {SHOT_VECTOR_GROUPS.map((group) => (
                <Box
                    key={group.key}
                    sx={{
                        display: "grid",
                        gridTemplateColumns: `${FIELD_LABEL_WIDTH_PX}px repeat(3, 1fr)`,
                        gap: FIELD_COLUMN_GAP,
                        alignItems: "center",
                    }}
                >
                    <Typography variant="caption" color="text.secondary">
                        {group.label}
                    </Typography>
                    {AXES.map((axis) => {
                        const value = shot[group.key][axis.index];
                        const fieldLabel = `${group.label}${axis.label}`;
                        return (
                            <ScrubNumberField
                                key={axis.label}
                                label={axis.label}
                                ariaLabel={fieldLabel}
                                kind="position"
                                value={value}
                                onCommit={(nextValue) => onCommit(group.key, axis.index, nextValue)}
                                onInvalid={invalidInputNotice(stores, fieldLabel)}
                            />
                        );
                    })}
                </Box>
            ))}
        </>
    );
});

/** props 只收机位身份与提交回调;fov 自取,滑杆草稿仍是一次拖拽的局部瞬时态。 */
const ShotFovField = observer(function ShotFovField({ shotId, onCommit }: ShotFovFieldProps) {
    const stores = useDirectorDeskStores();
    const fov = stores.camera.director.getShot(shotId)?.fov ?? DEFAULT_CAMERA_FOV;
    const [draftFov, setDraftFov] = useState<number | null>(null);
    const shownFov = draftFov ?? fov;

    return (
        <Box
            sx={{
                display: "grid",
                gridTemplateColumns: `${FIELD_LABEL_WIDTH_PX}px 1fr ${NUMBER_COMPANION_WIDTH_PX}px`,
                gap: FIELD_COLUMN_GAP,
                alignItems: "center",
            }}
        >
            <Typography variant="overline" color="text.secondary">
                视角
            </Typography>
            <Slider
                size="small"
                min={FOV_MIN}
                max={FOV_MAX}
                step={SCRUB_STEP.angleDeg}
                value={shownFov}
                aria-label="视角"
                onChange={(_, value) => {
                    if (Array.isArray(value)) return;
                    setDraftFov(value);
                }}
                onChangeCommitted={(_, value) => {
                    if (Array.isArray(value)) return;
                    setDraftFov(null);
                    if (value !== fov) onCommit(value);
                }}
            />
            <ScrubNumberField
                label="度"
                ariaLabel="视角"
                kind="angleDeg"
                min={FOV_MIN}
                max={FOV_MAX}
                value={shownFov}
                onCommit={onCommit}
                onInvalid={invalidInputNotice(stores, "视角", { min: FOV_MIN, max: FOV_MAX })}
            />
        </Box>
    );
});

const ShotFields = observer(function ShotFields({ shotId, report }: ShotFieldsProps) {
    const stores = useDirectorDeskStores();
    const { camera, dispatcher } = stores;
    const shot = camera.director.getShot(shotId);
    if (!shot) return null;

    const commitVectorAxis = (group: ShotVectorKey, axis: AxisIndex, value: number) => {
        const latestShot = camera.director.getShot(shotId);
        if (!latestShot || latestShot[group][axis] === value) return;
        report(
            dispatcher.dispatch(
                {
                    type: "camera.set-shot",
                    payload: {
                        id: shotId,
                        shot: {
                            position:
                                group === "position"
                                    ? replaceAxis(latestShot.position, axis, value)
                                    : latestShot.position,
                            target:
                                group === "target" ? replaceAxis(latestShot.target, axis, value) : latestShot.target,
                            fov: latestShot.fov,
                        },
                    },
                },
                stores,
            ),
        );
    };

    const commitFov = (fov: number) => {
        const latestShot = camera.director.getShot(shotId);
        if (!latestShot || latestShot.fov === fov) return;
        report(
            dispatcher.dispatch(
                {
                    type: "camera.set-shot",
                    payload: { id: shotId, shot: { position: latestShot.position, target: latestShot.target, fov } },
                },
                stores,
            ),
        );
    };

    return (
        <Stack spacing={FIELD_GROUP_GAP}>
            <Box sx={INSPECTOR_FIELD_SX}>
                <Typography variant="overline">变换</Typography>
                <ShotVectorFields shotId={shotId} onCommit={commitVectorAxis} />
            </Box>
            <Box sx={INSPECTOR_FIELD_SX}>
                <Typography variant="overline">镜头</Typography>
                <ShotFovField shotId={shotId} onCommit={commitFov} />
            </Box>
        </Stack>
    );
});

export type ReportCommandResult = (result: CommandResult) => void;

/** 机位 tab:镜头参数 + 进出机位视图。 */
export const ShotCameraSection = observer(function ShotCameraSection({ primaryId, report }: InspectorSectionProps) {
    const stores = useDirectorDeskStores();
    const { camera, dispatcher, selection } = stores;
    const active = camera.activeShotId === primaryId;

    const toggleShot = () => {
        report(
            dispatcher.dispatch(
                { type: active ? "camera.deactivate" : "camera.activate", payload: active ? {} : { id: primaryId } },
                stores,
            ),
        );
    };

    const removeShot = () => {
        const result = dispatcher.dispatch({ type: "camera.remove-shot", payload: { id: primaryId } }, stores);
        report(result);
        if (result.ok) selection.remove(primaryId);
    };
    return (
        <>
            <ShotFields shotId={primaryId} report={report} />
            <Stack direction="row" spacing={CONTROL_GAP}>
                <Button variant="contained" onClick={toggleShot} fullWidth>
                    {active ? "回自由视角" : "进入机位视图"}
                </Button>
                <Button variant="text" color="error" onClick={removeShot}>
                    删除机位
                </Button>
            </Stack>
        </>
    );
});

interface ObjectControlsProps {
    objectId: string;
    report: ReportCommandResult;
}

interface LightIntensityControlProps {
    readonly intensity: number;
    readonly onCommit: (intensity: number) => void;
}

/** 滑杆与数字输入同显一份草稿:任一交互中另一侧实时跟随;权威 LightParams 始终留在实体。 */
const LightIntensityControl = observer(function LightIntensityControl({
    intensity,
    onCommit,
}: LightIntensityControlProps) {
    const stores = useDirectorDeskStores();
    const [draft, setDraft] = useState<number | null>(null);
    const shown = draft ?? intensity;

    return (
        <Box
            sx={{
                display: "grid",
                gridTemplateColumns: `1fr ${NUMBER_COMPANION_WIDTH_PX}px`,
                gap: FIELD_COLUMN_GAP,
                alignItems: "center",
            }}
        >
            <Slider
                size="small"
                min={LIGHT_INTENSITY_MIN}
                max={LIGHT_INTENSITY_MAX}
                step={SCRUB_STEP.intensity}
                value={shown}
                aria-label="灯光强度"
                onChange={(_, value) => {
                    if (typeof value === "number") setDraft(value);
                }}
                onChangeCommitted={(_, value) => {
                    if (typeof value !== "number") return;
                    setDraft(null);
                    if (value !== intensity) onCommit(value);
                }}
            />
            <ScrubNumberField
                label="强度"
                ariaLabel="灯光强度"
                kind="intensity"
                min={LIGHT_INTENSITY_MIN}
                max={LIGHT_INTENSITY_MAX}
                value={shown}
                onCommit={(value) => {
                    setDraft(null);
                    onCommit(value);
                }}
                onInvalid={invalidInputNotice(stores, "灯光强度", {
                    min: LIGHT_INTENSITY_MIN,
                    max: LIGHT_INTENSITY_MAX,
                })}
            />
        </Box>
    );
});
type LightNumericParameter = "distance" | "decay" | "angleDegrees" | "penumbra";

interface LightParameterControlProps {
    readonly label: string;
    readonly ariaLabel: string;
    readonly kind: ScrubKind;
    readonly minimum: number;
    readonly maximum: number;
    readonly value: number;
    readonly onCommit: (value: number) => void;
}

const LightParameterControl = observer(function LightParameterControl({
    label,
    ariaLabel,
    kind,
    minimum,
    maximum,
    value,
    onCommit,
}: LightParameterControlProps) {
    const stores = useDirectorDeskStores();
    return (
        <ScrubNumberField
            label={label}
            ariaLabel={ariaLabel}
            kind={kind}
            min={minimum}
            max={maximum}
            value={value}
            onCommit={onCommit}
            onInvalid={invalidInputNotice(stores, label, { min: minimum, max: maximum })}
        />
    );
});

function replaceLightNumberParameter(
    light: LightParams,
    parameter: LightNumericParameter,
    value: number,
): LightParams | null {
    switch (parameter) {
        case "distance":
            return light.type === "directional" ? null : { ...light, distance: value };
        case "decay":
            return light.type === "directional" ? null : { ...light, decay: value };
        case "angleDegrees":
            return light.type === "spot" ? { ...light, angleDegrees: value } : null;
        case "penumbra":
            return light.type === "spot" ? { ...light, penumbra: value } : null;
    }
}

/** 内嵌 clip 目录条目查找:姿势/动作预设区与「动作」tab 可见性谓词共用同一真相。 */
function embeddedClipEntryFor(stores: DirectorDeskStores, entity: SceneObject) {
    return entity.kind === "model" && entity.sourceUrl
        ? stores.catalog
              .list()
              .find((candidate) => candidate.url === entity.sourceUrl && (candidate.embeddedClips?.length ?? 0) > 0)
        : undefined;
}

/** 「动作」tab 可见性谓词:模型带内嵌 clip 或已挂载动作时才有内容,否则不产生空 tab。 */
export function modelHasActionContent(stores: DirectorDeskStores, objectId: string): boolean {
    const entity = stores.scene.manager.getEntity(objectId);
    if (!entity || entity.kind !== "model") return false;
    const hasCatalogActions = entity.actor
        ? stores.catalog
              .list({ kind: ASSET_KIND.ACTION })
              .some((entry) => entry.skeletonFamily === entity.actor?.skeletonFamily)
        : false;
    return Boolean(entity.actionId) || hasCatalogActions || embeddedClipEntryFor(stores, entity) !== undefined;
}

/** 动作分区:只呈现可播放动作,静态造型归「姿势」组合器,同一造型不再有两个入口。 */
const ActionPresetSection = observer(function ActionPresetSection({ objectId, report }: ObjectControlsProps) {
    const stores = useDirectorDeskStores();
    const { animations, dispatcher, models, scene, ui } = stores;
    const entity = scene.manager.getEntity(objectId);
    const entry = entity ? embeddedClipEntryFor(stores, entity) : undefined;
    if (!entity || !entry?.embeddedClips || !entry.format) return null;
    const actionPresets = listActionClips(entry.embeddedClips);
    const format = entry.format;

    const mountAction = async (clipName: string) => {
        try {
            const handle = await models.acquire(entry.url, format, { signal: stores.lifecycle.signal });
            try {
                const clip = handle.animations.find((candidate) => candidate.name === clipName);
                if (!clip) throw new Error(`动作 clip 不存在:${clipName}`);
                // 姿势是常驻底层:挂动作不再清姿势,动作只覆盖自己写到的骨骼。
                const presentation = presentEmbeddedClip(clipName);
                const action = animations.register({
                    name: `${entry.name}#${clipName}`,
                    url: entry.url,
                    clip,
                    loopMode: presentation.loopMode ?? ACTION_LOOP_MODE.ONCE,
                }).action;
                report(
                    dispatcher.dispatch({ type: "action.mount", payload: { objectId, actionId: action.id } }, stores),
                );
            } finally {
                handle.release();
            }
        } catch (error) {
            console.warn(`[ActionPresetSection] 动作置备失败 ${clipName}`, error);
            ui.setApplicationNotice(`动作不可用:${clipName}`);
        }
    };

    return (
        <Box sx={INSPECTOR_FIELD_SX}>
            <Typography variant="overline">动作（{actionPresets.length}）</Typography>
            <PresetButtonGrid
                items={actionPresets.map((preset) => {
                    const loopMode = preset.loopMode ?? ACTION_LOOP_MODE.ONCE;
                    return { id: preset.clipName, label: `${preset.labelZh} · ${ACTION_LOOP_MODE_LABEL[loopMode]}` };
                })}
                onApply={mountAction}
            />
        </Box>
    );
});

/** 目录动作分区:按人偶骨架族列出动作资产,写入统一走 assets.mount。 */
const CatalogActionSection = observer(function CatalogActionSection({ objectId, report }: ObjectControlsProps) {
    const stores = useDirectorDeskStores();
    const entity = stores.scene.manager.getEntity(objectId);
    const actor = entity?.actor;
    const actions = actor
        ? stores.catalog
              .list({ kind: ASSET_KIND.ACTION })
              .filter((entry) => entry.skeletonFamily === actor.skeletonFamily)
        : [];
    if (actions.length === 0) return null;

    const mountAction = (assetId: string) => {
        report(stores.dispatcher.dispatch({ type: "assets.mount", payload: { assetId, objectId } }, stores));
    };

    return (
        <Box sx={INSPECTOR_FIELD_SX}>
            <Typography variant="overline">动作资产（{actions.length}）</Typography>
            <PresetButtonGrid
                items={actions.map((action) => {
                    const loopMode = action.loopMode ?? ACTION_LOOP_MODE.ONCE;
                    return { id: action.id, label: `${action.name} · ${ACTION_LOOP_MODE_LABEL[loopMode]}` };
                })}
                onApply={mountAction}
            />
        </Box>
    );
});

/** 挂载动作自取:模型换动作时只有本组件重渲,不牵动上层控制区。 */
const PlaybackControls = observer(function PlaybackControls({ objectId, report }: ObjectControlsProps) {
    const stores = useDirectorDeskStores();
    const { actionPreview, animations, dispatcher, scene } = stores;
    const actionId = scene.manager.getEntity(objectId)?.actionId ?? null;
    const mountedAction = actionId ? animations.actions.find((action) => action.id === actionId) : undefined;
    if (!mountedAction) return null;
    const isPlaying = actionPreview.activeObjectId === objectId && actionPreview.isPlaying;

    return (
        <Box sx={INSPECTOR_FIELD_SX}>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                <Typography variant="overline" sx={{ flex: 1 }}>
                    {mountedAction.name} · {ACTION_LOOP_MODE_LABEL[mountedAction.loopMode]}
                </Typography>
                <IconButton
                    size="small"
                    aria-label={isPlaying ? "暂停动作播放" : "播放动作"}
                    onClick={() =>
                        report(
                            dispatcher.dispatch(
                                isPlaying
                                    ? { type: "action.preview.pause", payload: {} }
                                    : { type: "action.preview.play", payload: { objectId } },
                                stores,
                            ),
                        )
                    }
                >
                    {isPlaying ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
                </IconButton>
            </Stack>
        </Box>
    );
});

/** 动作分区(嵌在「姿势」tab 内):可播放动作预设 + 当前动作播放控制。 */
export const ModelActionSection = observer(function ModelActionSection({ primaryId, report }: InspectorSectionProps) {
    return (
        <>
            <ActionPresetSection objectId={primaryId} report={report} />
            <CatalogActionSection objectId={primaryId} report={report} />
            <PlaybackControls objectId={primaryId} report={report} />
        </>
    );
});

/** 灯光参数自取实体、统一写回 light.adjust；灯型切换只保留颜色与强度，专属参数不跨型泄漏。 */
const LightControls = observer(function LightControls({ objectId, report }: ObjectControlsProps) {
    const stores = useDirectorDeskStores();
    const entity = stores.scene.manager.getEntity(objectId);
    const light = entity?.light;
    if (!entity || !light) return null;

    const dispatchAdjustment = (next: LightParams) => {
        report(stores.dispatcher.dispatch({ type: "light.adjust", payload: { id: objectId, light: next } }, stores));
    };
    const updateNumericParameter = (parameter: LightNumericParameter, value: number) => {
        const latest = stores.scene.manager.getEntity(objectId)?.light;
        const next = latest ? replaceLightNumberParameter(latest, parameter, value) : null;
        if (next) dispatchAdjustment(next);
    };
    const changeLightType = (value: string) => {
        if (!isLightType(value)) return;
        dispatchAdjustment(retypeLightParams(light, value));
    };

    return (
        <Box sx={INSPECTOR_FIELD_SX}>
            <Typography variant="overline">灯光</Typography>
            <Stack spacing={CONTROL_GAP}>
                <TextField
                    select
                    size="small"
                    label="类型"
                    value={light.type}
                    onChange={(event) => changeLightType(event.target.value)}
                >
                    {LIGHT_TYPES.map((type) => (
                        <MenuItem key={type} value={type}>
                            {type === "directional" ? "平行光" : type === "point" ? "点光" : "聚光"}
                        </MenuItem>
                    ))}
                </TextField>
                <TextField
                    size="small"
                    label="颜色"
                    type="color"
                    value={light.color}
                    slotProps={{ htmlInput: { "aria-label": "灯光颜色" } }}
                    onChange={(event) => dispatchAdjustment({ ...light, color: event.target.value })}
                />
                <LightIntensityControl
                    intensity={light.intensity}
                    onCommit={(intensity) => dispatchAdjustment({ ...light, intensity })}
                />
                {light.type !== "directional" && (
                    <>
                        <LightParameterControl
                            label="范围 (m)"
                            ariaLabel="灯光范围"
                            kind="distanceMeters"
                            minimum={LIGHT_DISTANCE_MIN_METERS}
                            maximum={LIGHT_DISTANCE_MAX_METERS}
                            value={light.distance}
                            onCommit={(value) => updateNumericParameter("distance", value)}
                        />
                        <LightParameterControl
                            label="衰减"
                            ariaLabel="灯光衰减"
                            kind="decay"
                            minimum={LIGHT_DECAY_MIN}
                            maximum={LIGHT_DECAY_MAX}
                            value={light.decay}
                            onCommit={(value) => updateNumericParameter("decay", value)}
                        />
                    </>
                )}
                {light.type === "spot" && (
                    <>
                        <LightParameterControl
                            label="半角 (°)"
                            ariaLabel="聚光半角"
                            kind="angleDeg"
                            minimum={LIGHT_SPOT_ANGLE_MIN_DEGREES}
                            maximum={LIGHT_SPOT_ANGLE_MAX_DEGREES}
                            value={light.angleDegrees}
                            onCommit={(value) => updateNumericParameter("angleDegrees", value)}
                        />
                        <LightParameterControl
                            label="边缘软化"
                            ariaLabel="聚光边缘软化"
                            kind="ratio"
                            minimum={LIGHT_PENUMBRA_MIN}
                            maximum={LIGHT_PENUMBRA_MAX}
                            value={light.penumbra}
                            onCommit={(value) => updateNumericParameter("penumbra", value)}
                        />
                    </>
                )}
            </Stack>
        </Box>
    );
});

/** 灯光单 tab:变换 + 关键帧 + 灯光参数(内容短,不拆 tab)。 */
export const LightEntitySection = observer(function LightEntitySection({ primaryId, report }: InspectorSectionProps) {
    return (
        <>
            <EntityTransformSection primaryId={primaryId} report={report} />
            <LightControls objectId={primaryId} report={report} />
        </>
    );
});

/** 当前选中对象的权威实体变换经 timeline.add-key 固化为关键帧。 */
const TimelineKeyControls = observer(function TimelineKeyControls({ objectId, report }: ObjectControlsProps) {
    const stores = useDirectorDeskStores();
    const entity = stores.scene.manager.getEntity(objectId);
    if (!entity) return null;
    const addKey = () => {
        const command = transformKeyCommandFor(stores, entity.id);
        if (command) report(stores.dispatcher.dispatch(command, stores));
    };

    return (
        <Box sx={INSPECTOR_FIELD_SX}>
            <Typography variant="overline">关键帧</Typography>
            <Button size="small" variant="outlined" fullWidth onClick={addKey}>
                在当前时间打关键帧 ({formatShortcutHint(SHORTCUT_ID.TIMELINE_ADD_KEY)})
            </Button>
        </Box>
    );
});

/** 对象变换 tab 只按对象身份查轨;轨级策略控件自身只接收轨 id。 */
const ObjectWalkPolicySection = observer(function ObjectWalkPolicySection({ objectId, report }: ObjectControlsProps) {
    const stores = useDirectorDeskStores();
    const track = stores.timeline.document.trackForTarget(objectId, TIMELINE_TRACK_KIND.TRANSFORM);
    return track ? <WalkPolicySection trackId={track.id} report={report} /> : null;
});

/** 变换 tab:数值变换 + 打关键帧(灯光/相机实体即单 tab 面板)。 */
export const EntityTransformSection = observer(function EntityTransformSection({
    primaryId,
    report,
}: InspectorSectionProps) {
    return (
        <>
            <Box sx={INSPECTOR_FIELD_SX}>
                <Typography variant="overline">变换</Typography>
                <TransformFields objectId={primaryId} />
            </Box>
            <TimelineKeyControls objectId={primaryId} report={report} />
            <ObjectWalkPolicySection objectId={primaryId} report={report} />
        </>
    );
});
