import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { DEFAULT_CAMERA_FOV } from "@/camera/CameraShot";
import { FOV_MAX, FOV_MIN } from "@/command/commands";
import type { CommandResult } from "@/command/DirectorCommand";
import { transformKeyCommandFor } from "@/command/timelineCommands";
import { LIGHT_INTENSITY_MAX, LIGHT_INTENSITY_MIN, LIGHT_TYPES } from "@/core/LightParams";
import type { LightParams, LightType } from "@/core/LightParams";
import type { Vec3 } from "@/core/SceneObject";
import { createStaticPoseSnapshot, isStaticPoseClip } from "@/pose/StaticPoseClip";
import { POSE_PRESET_KIND, presentPosePreset } from "@/pose/PosePresetCatalog";
import type { PosePresetPresentation } from "@/pose/PosePresetCatalog";
import type { BoneTreeNodeDto, SkeletonDiscoveryDto } from "@/pose/SkeletonRuntimeRegistry";
import { formatShortcutHint, SHORTCUT_ID } from "@/shortcuts/builtinShortcuts";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { INSPECTOR_FIELD_SX, TransformFields } from "@/ui/inspector/TransformFields";
import { MONO_FONT_STACK } from "@/ui/shell/theme";

const DISPLAY_DECIMAL_PLACES = 4;
const AXIS_X = 0;
const AXIS_Y = 1;
const AXIS_Z = 2;
const FIELD_GROUP_GAP = 0.75;
const FIELD_COLUMN_GAP = 0.5;

const PRESET_GRID_TEMPLATE_COLUMNS = "repeat(2, minmax(0, 1fr))";
const PRESET_BUTTON_MIN_HEIGHT_PX = 40;
const FIELD_LABEL_WIDTH_PX = 32;
const FOV_INPUT_WIDTH_PX = 80;
const FOV_STEP = 1;
const CONTROL_GAP = 1;
const PANEL_PADDING = 1.5;
const SNACKBAR_DURATION_MS = 4000;
const LIGHT_INTENSITY_STEP = 0.1;

type AxisIndex = typeof AXIS_X | typeof AXIS_Y | typeof AXIS_Z;
type ShotVectorKey = "position" | "target";

interface ShotNumberFieldProps {
    axisLabel: string;
    label: string;
    value: number;
    min?: number;
    max?: number;
    onCommit: (value: number) => void;
}

interface ShotFieldsProps {
    shotId: string;
    report: ReportCommandResult;
}

interface ShotInspectorProps {
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

function formatValue(value: number): string {
    return String(Number(value.toFixed(DISPLAY_DECIMAL_PLACES)));
}

function finiteNumber(value: string): number | null {
    const parsed = Number(value);
    return value.trim() !== "" && Number.isFinite(parsed) ? parsed : null;
}

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

const ShotNumberField = observer(function ShotNumberField({
    axisLabel,
    label,
    value,
    min,
    max,
    onCommit,
}: ShotNumberFieldProps) {
    const [inputValue, setInputValue] = useState(() => formatValue(value));
    const hasCommitted = useRef(false);

    const commit = () => {
        if (hasCommitted.current) return;
        const parsed = finiteNumber(inputValue);
        hasCommitted.current = true;
        if (parsed === null || (min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
            setInputValue(formatValue(value));
            return;
        }
        onCommit(parsed);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commit();
        event.currentTarget.blur();
    };

    return (
        <TextField
            aria-label={label}
            label={axisLabel}
            fullWidth
            size="small"
            type="number"
            value={inputValue}
            onBlur={commit}
            onChange={(event) => {
                hasCommitted.current = false;
                setInputValue(event.target.value);
            }}
            onKeyDown={handleKeyDown}
            sx={{ "& .MuiInputBase-input": { fontFamily: MONO_FONT_STACK } }}
        />
    );
});

/** props 只收机位身份与提交回调;向量值自取,父组件不因坐标改动整片重渲。 */
const ShotVectorFields = observer(function ShotVectorFields({ shotId, onCommit }: ShotVectorFieldsProps) {
    const { camera } = useDirectorDeskStores();
    const shot = camera.director.getShot(shotId);
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
                        return (
                            <ShotNumberField
                                key={`${group.key}-${axis.label}-${value}`}
                                axisLabel={axis.label}
                                label={`${group.label}${axis.label}`}
                                value={value}
                                onCommit={(nextValue) => onCommit(group.key, axis.index, nextValue)}
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
    const { camera } = useDirectorDeskStores();
    const fov = camera.director.getShot(shotId)?.fov ?? DEFAULT_CAMERA_FOV;
    const [draftFov, setDraftFov] = useState<number | null>(null);

    return (
        <Box
            sx={{
                display: "grid",
                gridTemplateColumns: `${FIELD_LABEL_WIDTH_PX}px 1fr ${FOV_INPUT_WIDTH_PX}px`,
                gap: FIELD_COLUMN_GAP,
                alignItems: "center",
            }}
        >
            <Typography variant="overline" color="text.secondary">
                FOV
            </Typography>
            <Slider
                size="small"
                min={FOV_MIN}
                max={FOV_MAX}
                step={FOV_STEP}
                value={draftFov ?? fov}
                aria-label="FOV"
                onChange={(_, value) => {
                    if (Array.isArray(value)) return;
                    setDraftFov(value);
                }}
                onChangeCommitted={(_, value) => {
                    if (Array.isArray(value)) return;
                    onCommit(value);
                    setDraftFov(null);
                }}
            />
            <ShotNumberField
                key={`fov-${fov}`}
                axisLabel="度"
                label="FOV"
                value={fov}
                min={FOV_MIN}
                max={FOV_MAX}
                onCommit={onCommit}
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
                <Typography variant="overline">变换 / TRANSFORM</Typography>
                <ShotVectorFields shotId={shotId} onCommit={commitVectorAxis} />
            </Box>
            <Box sx={INSPECTOR_FIELD_SX}>
                <Typography variant="overline">镜头 / LENS · FOV</Typography>
                <ShotFovField shotId={shotId} onCommit={commitFov} />
            </Box>
        </Stack>
    );
});

const ShotInspector = observer(function ShotInspector({ shotId, report }: ShotInspectorProps) {
    const stores = useDirectorDeskStores();
    const { camera, dispatcher, selection } = stores;
    const active = camera.activeShotId === shotId;

    const toggleShot = () => {
        report(
            dispatcher.dispatch(
                { type: active ? "camera.deactivate" : "camera.activate", payload: active ? {} : { id: shotId } },
                stores,
            ),
        );
    };

    const removeShot = () => {
        const result = dispatcher.dispatch({ type: "camera.remove-shot", payload: { id: shotId } }, stores);
        report(result);
        if (result.ok) selection.remove(shotId);
    };
    return (
        <Box sx={{ display: "grid", gap: CONTROL_GAP }}>
            <ShotFields shotId={shotId} report={report} />
            <Stack direction="row" spacing={CONTROL_GAP}>
                <Button variant="contained" onClick={toggleShot} fullWidth>
                    {active ? "回自由视角" : "进入机位视图"}
                </Button>
                <Button variant="text" color="error" onClick={removeShot}>
                    删除机位
                </Button>
            </Stack>
        </Box>
    );
});

type ReportCommandResult = (result: CommandResult) => void;

interface ObjectControlsProps {
    objectId: string;
    report: ReportCommandResult;
}

interface LightIntensityControlProps {
    readonly intensity: number;
    readonly onCommit: (intensity: number) => void;
}

/** 输入草稿仅服务于一次 slider 拖拽；权威 LightParams 始终留在实体。 */
const LightIntensityControl = observer(function LightIntensityControl({
    intensity,
    onCommit,
}: LightIntensityControlProps) {
    const [draft, setDraft] = useState(intensity);

    return (
        <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO_FONT_STACK }}>
                强度 {draft}
            </Typography>
            <Slider
                size="small"
                min={LIGHT_INTENSITY_MIN}
                max={LIGHT_INTENSITY_MAX}
                step={LIGHT_INTENSITY_STEP}
                value={draft}
                aria-label="灯光强度"
                onChange={(_, value) => {
                    if (typeof value === "number") setDraft(value);
                }}
                onChangeCommitted={(_, value) => {
                    if (typeof value === "number" && value !== intensity) onCommit(value);
                }}
            />
        </Box>
    );
});

interface PresetGridProps {
    readonly presets: readonly PosePresetPresentation[];
    readonly onApply: (clipName: string) => void;
}

function renderPresetGrid({ presets, onApply }: PresetGridProps) {
    return (
        <Box sx={{ display: "grid", gap: 0.5, gridTemplateColumns: PRESET_GRID_TEMPLATE_COLUMNS }}>
            {presets.map((preset) => (
                <Button
                    key={preset.clipName}
                    size="small"
                    variant="outlined"
                    sx={{ minHeight: PRESET_BUTTON_MIN_HEIGHT_PX, px: 0.75, py: 0.5 }}
                    onClick={() => onApply(preset.clipName)}
                >
                    {preset.labelZh}
                </Button>
            ))}
        </Box>
    );
}

const PosePresetSection = observer(function PosePresetSection({ objectId, report }: ObjectControlsProps) {
    const stores = useDirectorDeskStores();
    const { animations, catalog, dispatcher, models, scene, skeletons, ui } = stores;
    const entity = scene.manager.getEntity(objectId);
    const entry =
        entity?.kind === "model" && entity.sourceUrl
            ? catalog
                  .list()
                  .find((candidate) => candidate.url === entity.sourceUrl && (candidate.embeddedClips?.length ?? 0) > 0)
            : undefined;
    if (!entity || !entry?.embeddedClips || !entry.format) return null;
    const clips = entry.embeddedClips;
    const presets = clips.map(presentPosePreset);
    const posePresets = presets.filter((preset) => preset.kind === POSE_PRESET_KIND.POSE);
    const actionPresets = presets.filter((preset) => preset.kind === POSE_PRESET_KIND.ACTION);
    const format = entry.format;

    const applyPreset = async (clipName: string) => {
        try {
            const handle = await models.acquire(entry.url, format, { signal: stores.lifecycle.signal });
            try {
                const clip = handle.animations.find((candidate) => candidate.name === clipName);
                if (!clip) throw new Error(`预设 clip 不存在:${clipName}`);
                if (isStaticPoseClip(clip)) {
                    const snapshot = createStaticPoseSnapshot(clip, skeletons.discover(objectId));
                    if (!snapshot) throw new Error(`预设姿势骨骼未就绪:${clipName}`);
                    report(
                        dispatcher.dispatch(
                            { type: "pose.apply-preset", payload: { objectId, pose: snapshot.toJSON() } },
                            stores,
                        ),
                    );
                    return;
                }
                if (entity.pose) {
                    report(dispatcher.dispatch({ type: "pose.clear", payload: { objectId } }, stores));
                }
                const action = animations.register({ name: `${entry.name}#${clipName}`, url: entry.url, clip }).action;
                report(
                    dispatcher.dispatch({ type: "action.mount", payload: { objectId, actionId: action.id } }, stores),
                );
            } finally {
                handle.release();
            }
        } catch (error) {
            console.warn(`[PosePresetSection] 预设置备失败 ${clipName}`, error);
            ui.setApplicationNotice(`预设姿势不可用:${clipName}`);
        }
    };

    return (
        <>
            <Box sx={INSPECTOR_FIELD_SX}>
                <Typography variant="overline">姿势 / POSE ({posePresets.length})</Typography>
                {renderPresetGrid({ presets: posePresets, onApply: applyPreset })}
                <Typography variant="overline" sx={{ display: "block", mt: CONTROL_GAP }}>
                    动作 / MOTION ({actionPresets.length})
                </Typography>
                {renderPresetGrid({ presets: actionPresets, onApply: applyPreset })}
            </Box>
            <Divider sx={{ my: CONTROL_GAP }} />
        </>
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
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <Typography variant="overline" sx={{ flex: 1 }}>
                当前动作 / CURRENT MOTION
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
    );
});

const ModelActionControls = observer(function ModelActionControls({ objectId, report }: ObjectControlsProps) {
    const { scene } = useDirectorDeskStores();
    const entity = scene.manager.getEntity(objectId);
    if (!entity || entity.kind !== "model") return null;

    return (
        <>
            <Divider sx={{ my: 1 }} />
            <PosePresetSection objectId={objectId} report={report} />
            <PlaybackControls objectId={objectId} report={report} />
        </>
    );
});

/** 灯光参数只读实体、写回 light.adjust；不维护 LightParams 的组件本地镜像。 */
const LightControls = observer(function LightControls({ objectId, report }: ObjectControlsProps) {
    const stores = useDirectorDeskStores();
    const entity = stores.scene.manager.getEntity(objectId);
    const light = entity?.light;
    if (!entity || !light) return null;

    const adjust = (next: Partial<LightParams>) => {
        const latest = stores.scene.manager.getEntity(objectId)?.light;
        if (!latest) return;
        report(
            stores.dispatcher.dispatch(
                { type: "light.adjust", payload: { id: objectId, light: { ...latest, ...next } } },
                stores,
            ),
        );
    };

    return (
        <>
            <Divider sx={{ my: CONTROL_GAP }} />
            <Box sx={INSPECTOR_FIELD_SX}>
                <Typography variant="overline">灯光 / LIGHT</Typography>
                <Stack spacing={CONTROL_GAP} sx={{ mt: CONTROL_GAP }}>
                    <TextField
                        select
                        size="small"
                        label="类型"
                        value={light.type}
                        onChange={(event) => adjust({ type: event.target.value as LightType })}
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
                        onChange={(event) => adjust({ color: event.target.value })}
                    />
                    <LightIntensityControl
                        key={`${objectId}-${light.intensity}`}
                        intensity={light.intensity}
                        onCommit={(intensity) => adjust({ intensity })}
                    />
                </Stack>
            </Box>
        </>
    );
});

const BoneTree = observer(function BoneTree({
    objectId,
    nodes,
    editing,
}: {
    objectId: string;
    nodes: readonly BoneTreeNodeDto[];
    editing: boolean;
}) {
    const { ui } = useDirectorDeskStores();
    return (
        <List dense disablePadding>
            {nodes.map((node) => (
                <ListItem key={node.key} disableGutters sx={{ display: "block", pl: node.key.split("/").length - 2 }}>
                    <Button
                        size="small"
                        variant={
                            ui.posePickingObjectId === objectId && ui.posePickingBoneKey === node.key
                                ? "contained"
                                : "text"
                        }
                        disabled={!editing}
                        onClick={() => ui.setPosePicking(objectId, node.key)}
                    >
                        {node.name}{" "}
                        <Typography component="span" variant="caption">
                            ({node.key})
                        </Typography>
                    </Button>
                    {node.children.length > 0 && (
                        <BoneTree objectId={objectId} nodes={node.children} editing={editing} />
                    )}
                </ListItem>
            ))}
        </List>
    );
});

/** Inspector-only UI state controls skeleton discovery; all persistent mutations use the Dispatcher. */
const PoseControls = observer(function PoseControls({ objectId, report }: ObjectControlsProps) {
    const stores = useDirectorDeskStores();
    const entity = stores.scene.manager.getEntity(objectId);
    const [discovery, setDiscovery] = useState<SkeletonDiscoveryDto | null>(null);
    if (!entity || entity.kind !== "model") return null;
    const editing = !stores.clock.isPlaying;
    const discover = () => {
        const result = stores.dispatcher.query({ type: "pose.bones.discover", payload: { objectId } }, stores);
        if (!result.ok) {
            report(result);
            return;
        }
        setDiscovery(result.value as SkeletonDiscoveryDto);
    };
    return (
        <>
            <Divider sx={{ my: CONTROL_GAP }} />
            <Box sx={INSPECTOR_FIELD_SX}>
                <Typography variant="overline">姿态精修 / POSE</Typography>
                <Stack spacing={CONTROL_GAP} sx={{ mt: CONTROL_GAP }}>
                    <Button size="small" variant="outlined" disabled={!editing} onClick={discover}>
                        发现骨骼
                    </Button>
                    {stores.ui.posePickingObjectId === objectId && (
                        <Button size="small" disabled={!editing} onClick={() => stores.ui.setPosePicking(null, null)}>
                            退出骨骼编辑
                        </Button>
                    )}
                    {discovery && !discovery.ready && (
                        <Typography variant="caption">模型骨骼尚未就绪，请等待加载完成后重试。</Typography>
                    )}
                    {discovery?.ready && (
                        <>
                            {discovery.semanticCandidates.length > 0 && (
                                <Box>
                                    <Typography variant="caption">语义候选（唯一匹配）</Typography>
                                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                                        {discovery.semanticCandidates.map((candidate) => (
                                            <Button
                                                key={candidate.label}
                                                size="small"
                                                disabled={!editing}
                                                onClick={() => stores.ui.setPosePicking(objectId, candidate.boneKey)}
                                            >
                                                {candidate.label}
                                            </Button>
                                        ))}
                                    </Stack>
                                </Box>
                            )}
                            <Box>
                                <Typography variant="caption">原始骨骼树（歧义或未命名时请从此处选择）</Typography>
                                <BoneTree objectId={objectId} nodes={discovery.roots} editing={editing} />
                            </Box>
                        </>
                    )}
                    <Button
                        size="small"
                        color="warning"
                        disabled={!editing || entity.pose === null}
                        onClick={() =>
                            report(stores.dispatcher.dispatch({ type: "pose.clear", payload: { objectId } }, stores))
                        }
                    >
                        清除姿态
                    </Button>
                    {!editing && <Typography variant="caption">播放期间姿态编辑已禁用。</Typography>}
                </Stack>
            </Box>
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
        <>
            <Divider sx={{ my: CONTROL_GAP }} />
            <Box sx={INSPECTOR_FIELD_SX}>
                <Typography variant="overline">关键帧 / KEYFRAME</Typography>
                <Button size="small" variant="outlined" fullWidth onClick={addKey}>
                    在当前时间打关键帧 ({formatShortcutHint(SHORTCUT_ID.TIMELINE_ADD_KEY)})
                </Button>
            </Box>
        </>
    );
});

/** 对象面板(右侧):实体显示数值变换，机位显示镜头参数与机位控制。 */
export const Inspector = observer(function Inspector() {
    const stores = useDirectorDeskStores();
    const { camera, scene, selection } = stores;
    const [notice, setNotice] = useState<string | null>(null);
    const primaryId = selection.primaryId;

    useEffect(() => {
        if (stores.ui.posePickingObjectId !== null && stores.ui.posePickingObjectId !== primaryId) {
            stores.ui.setPosePicking(null, null);
        }
    }, [stores.ui, primaryId]);

    if (primaryId === null) return null;
    const entity = scene.manager.getEntity(primaryId);
    const shot = entity ? undefined : camera.director.getShot(primaryId);
    const report = (result: CommandResult) => {
        if (result.ok) return;
        const message = result.issues?.join(";") ?? result.error;
        stores.ui.setApplicationNotice(message);
        setNotice(message);
    };
    const content = shot ? (
        <ShotInspector shotId={primaryId} report={report} />
    ) : entity ? (
        <>
            <Box sx={INSPECTOR_FIELD_SX}>
                <Typography variant="overline">变换 / TRANSFORM</Typography>
                <TransformFields objectId={entity.id} />
            </Box>
            {entity.kind === "light" && <LightControls objectId={entity.id} report={report} />}
            <TimelineKeyControls objectId={entity.id} report={report} />
            {entity.kind === "model" && <ModelActionControls objectId={entity.id} report={report} />}
            {entity.kind === "model" && <PoseControls objectId={entity.id} report={report} />}
        </>
    ) : null;

    return (
        <>
            <Box sx={{ display: "grid", gap: CONTROL_GAP, p: PANEL_PADDING }}>{content}</Box>
            <Snackbar
                open={notice !== null}
                autoHideDuration={SNACKBAR_DURATION_MS}
                onClose={() => setNotice(null)}
                message={notice}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            />
        </>
    );
});
