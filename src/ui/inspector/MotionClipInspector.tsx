import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { observer } from "mobx-react-lite";

import {
    FOLLOW_ANCHOR_LIMIT_METERS,
    FOLLOW_LAG_MAX_SECONDS,
    FOLLOW_LAG_MIN_SECONDS,
    FOLLOW_SMOOTHING_MAX_SECONDS,
    FOLLOW_SMOOTHING_MIN_SECONDS,
} from "@/camera/CameraFollowTrack";
import type { CameraFollowTrackJSON } from "@/camera/CameraFollowTrack";
import { EASING, EASING_LABEL } from "@/motion/EasingCurve";
import type { EasingCurve } from "@/motion/EasingCurve";
import { FOCUS_TARGET_KIND } from "@/camera/CameraFocusTrack";
import type { CameraKey } from "@/camera/CameraKey";
import type { CameraMotionClip } from "@/camera/CameraMotionClip";
import type { Vec3 } from "@/core/SceneObject";
import { MOTION_HANDLE_MODE } from "@/motion/MotionKey";
import { FOLLOW_FRAME } from "@/motion/SubjectFrameResolver";
import type { FollowFrame } from "@/motion/SubjectFrameResolver";
import { TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";
import { RemoveMotionKeyCommand } from "@/command/cameraMotionCommands";
import { subjectBoundsFor } from "@/command/subjectBounds";
import { TimelineSelection } from "@/authoring/TimelineSelection";
import { MotionPresetControls } from "@/ui/inspector/MotionPresetControls";
import { INSPECTOR_FIELD_SX } from "@/ui/inspector/TransformFields";
import { formatShortcutHint, SHORTCUT_ID } from "@/shortcuts/builtinShortcuts";
import { ScrubNumberField } from "@/ui/controls/ScrubNumberField";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { invalidInputNotice, reportCommandFailure } from "@/ui/shell/commandFeedback";
import type { InspectorSectionProps } from "@/ui/inspector/Inspector";
const FIELD_GAP = 0.75;
const FIELD_GRID_COLUMNS = "repeat(3, minmax(0, 1fr))";
const KEY_ROW_GRID_COLUMNS = "1fr auto";
const MIN_CLIP_DURATION_SECONDS = 0.1;
const ORIGIN: Vec3 = [0, 0, 0];
const NO_FOCUS = "none";
const NO_FOLLOW = "none";
const DEFAULT_FOLLOW_FRAME = FOLLOW_FRAME.HEADING;
const DEFAULT_FOLLOW_LAG_SECONDS = 0;
const DEFAULT_FOLLOW_SMOOTHING_SECONDS = 0;
const MIN_FOLLOW_ANCHOR_HEIGHT_METERS = 0;
const FOLLOW_FRAME_OPTIONS = [
    { value: FOLLOW_FRAME.WORLD, label: "平移" },
    { value: FOLLOW_FRAME.HEADING, label: "朝向" },
] as const;
const AXIS_X = 0;
const AXIS_Y = 1;
const AXIS_Z = 2;
const AXES = [
    { label: "X", index: AXIS_X },
    { label: "Y", index: AXIS_Y },
    { label: "Z", index: AXIS_Z },
] as const;
const POSE_GROUPS = [
    { label: "位置", property: "position" },
    { label: "注视", property: "target" },
] as const;
const HANDLE_GROUPS = [
    { label: "入手柄", kind: "in", property: "inHandle" },
    { label: "出手柄", kind: "out", property: "outHandle" },
] as const;

function replaceAxis(vector: Vec3, index: (typeof AXES)[number]["index"], value: number): Vec3 {
    switch (index) {
        case AXIS_X:
            return [value, vector[AXIS_Y], vector[AXIS_Z]];
        case AXIS_Y:
            return [vector[AXIS_X], value, vector[AXIS_Z]];
        default:
            return [vector[AXIS_X], vector[AXIS_Y], value];
    }
}

function focusDescription(clip: CameraMotionClip): string {
    const target = clip.focus?.target;
    if (!target) return "未绑定";
    if (target.kind === FOCUS_TARGET_KIND.SCENE_OBJECT) return `绑定 ${target.objectId}`;
    return "固定世界点";
}

const ClipRangeEditor = observer(function ClipRangeEditor({ clipId }: { clipId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion } = stores;
    const clip = motion.clip(clipId);

    if (!clip) return null;

    const commitRange = (startTimeSeconds: number, durationSeconds: number) => {
        const result = dispatcher.dispatch(
            { type: "motion.set-clip-range", payload: { id: clip.id, startTimeSeconds, durationSeconds } },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    return (
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: FIELD_GAP }}>
            <ScrubNumberField
                key={clip.id}
                label="起始"
                ariaLabel="起始时间"
                kind="timeSeconds"
                value={clip.startTimeSeconds}
                onCommit={(startTimeSeconds) => commitRange(startTimeSeconds, clip.durationSeconds)}
                onInvalid={invalidInputNotice(stores, "起始时间")}
            />
            <ScrubNumberField
                key={clip.id}
                label="时长"
                ariaLabel="时长"
                kind="timeSeconds"
                min={MIN_CLIP_DURATION_SECONDS}
                value={clip.durationSeconds}
                onCommit={(durationSeconds) => commitRange(clip.startTimeSeconds, durationSeconds)}
                onInvalid={invalidInputNotice(stores, "时长", { min: MIN_CLIP_DURATION_SECONDS })}
            />
        </Box>
    );
});

/**
 * 注视锁定被摄目标(注视覆盖层):选定后整段注视由该对象接管,关键帧的 target 被忽略但不丢失。
 * 这里用下拉直接选对象,而不是「绑定当前选中」——看得到本面板时选中的必然是机位。
 */
const ClipFocusControls = observer(function ClipFocusControls({ clipId }: { clipId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion, motionAuthoring, scene } = stores;
    const clip = motion.clip(clipId);
    const subjects = scene.manager.list().filter((entity) => entity.kind === "model");

    if (!clip) return null;

    const lockedId = clip.focus?.target.kind === FOCUS_TARGET_KIND.SCENE_OBJECT ? clip.focus.target.objectId : NO_FOCUS;

    const lockFocus = (objectId: string): void => {
        const target =
            objectId === NO_FOCUS
                ? null
                : {
                      kind: FOCUS_TARGET_KIND.SCENE_OBJECT,
                      objectId,
                      worldOffset: subjectBoundsFor(stores, objectId)?.focusOffset ?? ORIGIN,
                  };
        const result = dispatcher.dispatch({ type: "motion.set-focus", payload: { id: clip.id, target } }, stores);
        reportCommandFailure(stores, result);
        if (objectId !== NO_FOCUS) motionAuthoring.setSubject(objectId);
    };

    return (
        <>
            <Typography variant="caption" color="text.secondary">
                注视目标：{focusDescription(clip)}
            </Typography>
            <Select
                size="small"
                value={lockedId}
                onChange={(event) => lockFocus(event.target.value)}
                aria-label="注视锁定"
            >
                <MenuItem value={NO_FOCUS}>不锁定(注视由关键帧插值)</MenuItem>
                {subjects.map((entity) => (
                    <MenuItem key={entity.id} value={entity.id}>
                        注视 {entity.name}
                    </MenuItem>
                ))}
            </Select>
        </>
    );
});

const ClipFollowControls = observer(function ClipFollowControls({ clipId }: { clipId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion, scene, timeline } = stores;
    const clip = motion.clip(clipId);
    const subjects = scene.manager.list().filter((entity) => entity.kind === "model");

    if (!clip) return null;

    const follow = clip.follow;
    const subject = follow ? scene.manager.getEntity(follow.objectId) : undefined;
    const subjectName = subject?.name ?? follow?.objectId ?? "";
    const hasTransformTrack = follow
        ? timeline.document.trackForTarget(follow.objectId, TIMELINE_TRACK_KIND.TRANSFORM) !== undefined
        : false;

    const bindFollow = (objectId: string): void => {
        const anchorOffset = subjectBoundsFor(stores, objectId)?.focusOffset ?? ORIGIN;
        const result = dispatcher.dispatch(
            {
                type: "motion.bind-follow",
                payload: {
                    id: clip.id,
                    objectId,
                    anchorOffset,
                    frame: DEFAULT_FOLLOW_FRAME,
                    lagSeconds: DEFAULT_FOLLOW_LAG_SECONDS,
                    smoothingSeconds: DEFAULT_FOLLOW_SMOOTHING_SECONDS,
                },
            },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    const unbindFollow = (): void => {
        const result = dispatcher.dispatch({ type: "motion.unbind-follow", payload: { id: clip.id } }, stores);
        reportCommandFailure(stores, result);
    };

    const selectFollowSubject = (objectId: string): void => {
        if (objectId === NO_FOLLOW) {
            unbindFollow();
            return;
        }
        bindFollow(objectId);
    };

    const setFollowParams = (params: CameraFollowTrackJSON): void => {
        const result = dispatcher.dispatch(
            { type: "motion.set-follow-params", payload: { id: clip.id, ...params } },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    const updateFollowParams = (patch: Partial<CameraFollowTrackJSON>): void => {
        if (!follow) return;
        setFollowParams({ ...follow.toJSON(), ...patch });
    };

    return (
        <>
            <Typography variant="subtitle2">跟拍</Typography>
            <Select
                aria-label="跟拍主体"
                size="small"
                value={follow?.objectId ?? NO_FOLLOW}
                onChange={(event) => selectFollowSubject(event.target.value)}
            >
                <MenuItem value={NO_FOLLOW}>不跟拍(机位固定于世界)</MenuItem>
                {subjects.map((entity) => (
                    <MenuItem key={entity.id} value={entity.id}>
                        跟拍 {entity.name}
                    </MenuItem>
                ))}
            </Select>
            {follow && (
                <Box sx={INSPECTOR_FIELD_SX}>
                    <Typography variant="caption" color="text.secondary">
                        参考系
                    </Typography>
                    <ToggleButtonGroup
                        aria-label="跟拍参考系"
                        exclusive
                        fullWidth
                        size="small"
                        value={follow.frame}
                        onChange={(_, frame: FollowFrame | null) => frame && updateFollowParams({ frame })}
                    >
                        {FOLLOW_FRAME_OPTIONS.map((option) => (
                            <ToggleButton key={option.value} value={option.value}>
                                {option.label}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                    <Typography variant="caption" color="text.secondary">
                        平移=只跟位移，朝向=随主体转身环绕
                    </Typography>
                    {follow.frame === FOLLOW_FRAME.HEADING && (
                        <Typography variant="caption" color="text.secondary">
                            朝向系会随主体转身环绕；原地转身抖动时可调大平滑或改用平移系
                        </Typography>
                    )}
                    <ScrubNumberField
                        ariaLabel="锚点高度"
                        kind="distanceMeters"
                        label="锚点高度"
                        max={FOLLOW_ANCHOR_LIMIT_METERS}
                        min={MIN_FOLLOW_ANCHOR_HEIGHT_METERS}
                        value={follow.anchorOffset[AXIS_Y]}
                        onCommit={(anchorHeight) =>
                            updateFollowParams({ anchorOffset: replaceAxis(follow.anchorOffset, AXIS_Y, anchorHeight) })
                        }
                        onInvalid={invalidInputNotice(stores, "锚点高度", {
                            min: MIN_FOLLOW_ANCHOR_HEIGHT_METERS,
                            max: FOLLOW_ANCHOR_LIMIT_METERS,
                        })}
                    />
                    <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: FIELD_GAP }}>
                        <ScrubNumberField
                            ariaLabel="滞后"
                            kind="timeSeconds"
                            label="滞后"
                            max={FOLLOW_LAG_MAX_SECONDS}
                            min={FOLLOW_LAG_MIN_SECONDS}
                            value={follow.lagSeconds}
                            onCommit={(lagSeconds) => updateFollowParams({ lagSeconds })}
                            onInvalid={invalidInputNotice(stores, "滞后", {
                                min: FOLLOW_LAG_MIN_SECONDS,
                                max: FOLLOW_LAG_MAX_SECONDS,
                            })}
                        />
                        <ScrubNumberField
                            ariaLabel="平滑"
                            kind="timeSeconds"
                            label="平滑"
                            max={FOLLOW_SMOOTHING_MAX_SECONDS}
                            min={FOLLOW_SMOOTHING_MIN_SECONDS}
                            value={follow.smoothingSeconds}
                            onCommit={(smoothingSeconds) => updateFollowParams({ smoothingSeconds })}
                            onInvalid={invalidInputNotice(stores, "平滑", {
                                min: FOLLOW_SMOOTHING_MIN_SECONDS,
                                max: FOLLOW_SMOOTHING_MAX_SECONDS,
                            })}
                        />
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                        正数=镜头慢半拍，负数=预判先行
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        关键帧坐标已相对「{subjectName}」；解除跟拍会烘回世界坐标
                    </Typography>
                    {!hasTransformTrack && (
                        <Typography role="status" variant="caption" color="text.secondary">
                            {subjectName} 还没有走位轨迹，跟拍暂等同于固定偏移机位
                        </Typography>
                    )}
                    <Button size="small" variant="outlined" onClick={unbindFollow}>
                        解除跟拍
                    </Button>
                </Box>
            )}
        </>
    );
});

const ClipActionControls = observer(function ClipActionControls({ clipId }: { clipId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion, motionAuthoring } = stores;
    const clip = motion.clip(clipId);

    if (!clip) return null;

    const togglePreview = () => {
        const previewing = motionAuthoring.previewClipId === clip.id;
        const result = dispatcher.dispatch(
            previewing
                ? { type: "motion.preview.exit", payload: {} }
                : { type: "motion.preview.enter", payload: { clipId: clip.id } },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    const removeClip = () => {
        const result = dispatcher.dispatch({ type: "motion.remove-clip", payload: { id: clip.id } }, stores);
        reportCommandFailure(stores, result);
    };

    return (
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: FIELD_GAP }}>
            <Button
                size="small"
                variant="outlined"
                aria-pressed={motionAuthoring.previewClipId === clip.id}
                onClick={togglePreview}
            >
                {motionAuthoring.previewClipId === clip.id ? "退出镜头预览" : "镜头视角预览"}
            </Button>
            <Button size="small" color="error" onClick={removeClip}>
                删除片段
            </Button>
        </Box>
    );
});

const MotionKeyList = observer(function MotionKeyList({ clipId }: { clipId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion, timelineSelection } = stores;
    const clip = motion.clip(clipId);

    if (!clip) return null;

    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP }}>
            <Typography variant="subtitle2">关键帧 ({clip.keys.length})</Typography>
            {clip.keys.map((key) => {
                const selected = timelineSelection.current.motionKeyId === key.id;
                const timeSeconds = clip.timeAtProgress(key.progress);
                return (
                    <Box
                        key={key.id}
                        sx={{ display: "grid", gridTemplateColumns: KEY_ROW_GRID_COLUMNS, gap: FIELD_GAP }}
                    >
                        <Button
                            size="small"
                            variant={selected ? "contained" : "text"}
                            sx={{ justifyContent: "flex-start" }}
                            onClick={() => timelineSelection.select(TimelineSelection.motionKey(clip.id, key.id))}
                        >
                            {timeSeconds.toFixed(2)}s
                        </Button>
                        <Box sx={{ display: "flex", gap: FIELD_GAP }}>
                            <Button
                                size="small"
                                onClick={() => {
                                    const result = dispatcher.dispatch(
                                        { type: "transport.seek", payload: { time: timeSeconds } },
                                        stores,
                                    );
                                    reportCommandFailure(stores, result);
                                }}
                            >
                                定位
                            </Button>
                            <Tooltip
                                title={`删除关键帧 (${formatShortcutHint(SHORTCUT_ID.TIMELINE_SELECTION_DELETE)})`}
                            >
                                <IconButton
                                    size="small"
                                    aria-label={`删除 ${timeSeconds.toFixed(2)} 秒的关键帧`}
                                    onClick={() => {
                                        const result = dispatcher.dispatch(
                                            {
                                                type: RemoveMotionKeyCommand.TYPE,
                                                payload: { clipId: clip.id, keyId: key.id },
                                            },
                                            stores,
                                        );
                                        reportCommandFailure(stores, result);
                                    }}
                                >
                                    <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
});

const SelectedMotionKeyInspector = observer(function SelectedMotionKeyInspector({ clipId }: { clipId: string }) {
    const stores = useDirectorDeskStores();
    const { motion, timelineSelection } = stores;
    const clip = motion.clip(clipId);
    const keyId = timelineSelection.current.motionKeyId;
    const key = clip && keyId ? clip.key(keyId) : undefined;

    if (!clip || !key) return null;

    return (
        <>
            <Divider />
            <KeyPoseFields clipId={clip.id} keyId={key.id} />
            {key.handleMode === MOTION_HANDLE_MODE.MANUAL && <ManualHandleFields clipId={clip.id} keyId={key.id} />}
        </>
    );
});

const KeyPoseFields = observer(function KeyPoseFields({ clipId, keyId }: { clipId: string; keyId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion, scene, ui } = stores;
    const clip = motion.clip(clipId);
    const key = clip?.key(keyId);

    if (!clip || !key) return null;
    const followSubjectName = clip.follow
        ? (scene.manager.getEntity(clip.follow.objectId)?.name ?? clip.follow.objectId)
        : "";

    const commitPose = (next: CameraKey) => {
        const result = dispatcher.dispatch(
            { type: "motion.set-key", payload: { clipId: clip.id, key: next.toJSON() } },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP }}>
            <Typography variant="subtitle2">关键帧姿态</Typography>
            {clip.isFocusOverriding && (
                <Typography variant="caption" color="text.secondary">
                    注视由跟拍目标接管
                </Typography>
            )}
            {POSE_GROUPS.map((group) => {
                const groupLabel =
                    group.property === "position" && clip.follow ? `位置 · 相对${followSubjectName}` : group.label;
                return (
                    <Box key={group.property} sx={{ display: "grid", gap: FIELD_GAP }}>
                        <Typography variant="caption" color="text.secondary">
                            {groupLabel}
                        </Typography>
                        <Box sx={{ display: "grid", gridTemplateColumns: FIELD_GRID_COLUMNS, gap: FIELD_GAP }}>
                            {AXES.map((axis) => {
                                const vector = key[group.property];
                                const disabled = group.property === "target" && clip.isFocusOverriding;
                                const fieldLabel = `${groupLabel}${axis.label}`;
                                return (
                                    <ScrubNumberField
                                        key={`${key.id}-${group.property}-${axis.index}`}
                                        label={axis.label}
                                        ariaLabel={fieldLabel}
                                        kind="position"
                                        value={vector[axis.index]}
                                        disabled={disabled}
                                        onCommit={(value) => {
                                            const position =
                                                group.property === "position"
                                                    ? replaceAxis(key.position, axis.index, value)
                                                    : key.position;
                                            const target =
                                                group.property === "target"
                                                    ? replaceAxis(key.target, axis.index, value)
                                                    : key.target;
                                            commitPose(key.withPose({ position, target, fov: key.fov }));
                                        }}
                                        onInvalid={invalidInputNotice(stores, fieldLabel)}
                                    />
                                );
                            })}
                        </Box>
                        {group.property === "position" && clip.follow && (
                            <Typography variant="caption" color="text.secondary">
                                跟随系：+Z 在主体身后、−Z 在正前、+X 在右手侧
                            </Typography>
                        )}
                    </Box>
                );
            })}
            <ScrubNumberField
                key={key.id}
                label="视角"
                ariaLabel="视角"
                kind="angleDeg"
                value={key.fov}
                onCommit={(fov) => commitPose(key.withPose({ position: key.position, target: key.target, fov }))}
                onInvalid={() => ui.setApplicationNotice("视角必须是范围内的有限数值")}
            />
        </Box>
    );
});

/** 整段时间曲线:平滑=起落加减速,线性=全程匀速。段间快慢改关键帧的时间分布,不在这里。 */
const ClipEasingControl = observer(function ClipEasingControl({ clipId }: { clipId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion } = stores;
    const clip = motion.clip(clipId);

    if (!clip) return null;

    const setEasing = (easing: EasingCurve) => {
        const result = dispatcher.dispatch(
            { type: "motion.set-clip-easing", payload: { id: clip.id, easing } },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP }}>
            <Typography variant="caption" color="text.secondary">
                整段时间曲线
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: FIELD_GAP }}>
                {Object.values(EASING).map((easing) => (
                    <Button
                        key={easing}
                        size="small"
                        variant={clip.easing === easing ? "contained" : "outlined"}
                        onClick={() => setEasing(easing)}
                    >
                        {EASING_LABEL[easing]}
                    </Button>
                ))}
            </Box>
        </Box>
    );
});

const ManualHandleFields = observer(function ManualHandleFields({ clipId, keyId }: { clipId: string; keyId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, motion } = stores;
    const clip = motion.clip(clipId);
    const key = clip?.key(keyId);

    if (!clip || !key) return null;

    const resetHandles = () => {
        const result = dispatcher.dispatch(
            { type: "motion.reset-key-handles", payload: { clipId: clip.id, keyId: key.id } },
            stores,
        );
        reportCommandFailure(stores, result);
    };

    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP }}>
            <Divider />
            <Typography variant="subtitle2">高级手柄</Typography>
            {HANDLE_GROUPS.map((group) => (
                <Box key={group.kind} sx={{ display: "grid", gap: FIELD_GAP }}>
                    <Typography variant="caption" color="text.secondary">
                        {group.label}
                    </Typography>
                    <Box sx={{ display: "grid", gridTemplateColumns: FIELD_GRID_COLUMNS, gap: FIELD_GAP }}>
                        {AXES.map((axis) => {
                            const vector = key[group.property];
                            const fieldLabel = `${group.label}${axis.label}`;
                            return (
                                <ScrubNumberField
                                    key={`${key.id}-${group.kind}-${axis.index}`}
                                    label={axis.label}
                                    ariaLabel={fieldLabel}
                                    kind="position"
                                    value={vector[axis.index]}
                                    onCommit={(value) => {
                                        const result = dispatcher.dispatch(
                                            {
                                                type: "motion.set-key-handle",
                                                payload: {
                                                    clipId: clip.id,
                                                    keyId: key.id,
                                                    kind: group.kind,
                                                    value: replaceAxis(vector, axis.index, value),
                                                },
                                            },
                                            stores,
                                        );
                                        reportCommandFailure(stores, result);
                                    }}
                                    onInvalid={invalidInputNotice(stores, fieldLabel)}
                                />
                            );
                        })}
                    </Box>
                </Box>
            ))}
            <Button size="small" onClick={resetHandles}>
                恢复自动手柄
            </Button>
        </Box>
    );
});

/** 静态机位可作为创建期起幅,但不会拥有或展示生成后的运镜资产。 */
export const CameraMotionSection = observer(function CameraMotionSection({ cameraId }: { cameraId: string }) {
    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP, p: FIELD_GAP }}>
            <MotionPresetControls cameraId={cameraId} />
        </Box>
    );
});

/** 运镜片段范围、时间曲线与片段动作。 */
export const MotionClipRangeSection = observer(function MotionClipRangeSection({ primaryId }: InspectorSectionProps) {
    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP, p: FIELD_GAP }}>
            <ClipRangeEditor clipId={primaryId} />
            <ClipEasingControl clipId={primaryId} />
            <Divider />
            <ClipActionControls clipId={primaryId} />
        </Box>
    );
});

/** 运镜片段的注视锁定与跟拍设置。 */
export const MotionClipTargetSection = observer(function MotionClipTargetSection({ primaryId }: InspectorSectionProps) {
    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP, p: FIELD_GAP }}>
            <ClipFocusControls clipId={primaryId} />
            <Divider />
            <ClipFollowControls clipId={primaryId} />
        </Box>
    );
});

/** 运镜片段的关键帧列表、位姿与手柄。 */
export const MotionClipKeysSection = observer(function MotionClipKeysSection({ primaryId }: InspectorSectionProps) {
    return (
        <Box sx={{ display: "grid", gap: FIELD_GAP, p: FIELD_GAP }}>
            <MotionKeyList clipId={primaryId} />
            <SelectedMotionKeyInspector clipId={primaryId} />
        </Box>
    );
});
