import { CameraFocusTrack, FOCUS_TARGET_KIND } from "@/camera/CameraFocusTrack";
import type { FocusTargetJSON } from "@/camera/CameraFocusTrack";
import {
    CameraFollowTrack,
    FOLLOW_ANCHOR_LIMIT_METERS,
    FOLLOW_APPROACH,
    FOLLOW_APPROACH_AZIMUTH,
    FOLLOW_LAG_MAX_SECONDS,
    FOLLOW_LAG_MIN_SECONDS,
    FOLLOW_SMOOTHING_MAX_SECONDS,
    FOLLOW_SMOOTHING_MIN_SECONDS,
    isFollowApproach,
} from "@/camera/CameraFollowTrack";
import type { CameraFollowTrackJSON, FollowApproach } from "@/camera/CameraFollowTrack";
import { FOLLOW_SPACE, followSpaceCodecFor } from "@/camera/FollowSpaceCodec";
import { FOLLOW_FRAME, isFollowFrame } from "@/motion/SubjectFrameResolver";
import type { FollowFrame } from "@/motion/SubjectFrameResolver";
import { CameraKey } from "@/camera/CameraKey";
import type { CameraKeyJSON } from "@/camera/CameraKey";
import { CameraMotionClip } from "@/camera/CameraMotionClip";
import type { CameraMotionClipJSON } from "@/camera/CameraMotionClip";
import { EASING, isEasingCurve } from "@/motion/EasingCurve";
import type { EasingCurve } from "@/motion/EasingCurve";
import { CameraProgramClip, PROGRAM_SOURCE_KIND } from "@/camera/CameraProgramTrack";
import type { CameraProgramClipJSON, ProgramSource } from "@/camera/CameraProgramTrack";
import { PROGRAM_SLOT_KIND, ProgramLinkage } from "@/camera/ProgramLinkage";
import {
    isOrbitMove,
    isOrientationMove,
    MotionPresetCompiler,
    MOTION_MOVE,
    ORBIT_DIRECTION,
    OrbitMotionParameters,
} from "@/authoring/MotionPresetCompiler";
import type { MotionMove, MotionPresetRequest, OrbitMotionParametersInit } from "@/authoring/MotionPresetCompiler";
import { TimelineSelection } from "@/authoring/TimelineSelection";
import { SHOT_SIZE } from "@/camera/CameraShot";
import type { CameraShot, ShotSize } from "@/camera/CameraShot";
import { azimuthAroundCenter, DEFAULT_SHOT_AZIMUTH_RADIANS, ShotSizePresets } from "@/camera/ShotSizePresets";
import { subjectBoundsFor } from "@/command/subjectBounds";
import type { SubjectFocusBounds } from "@/command/subjectBounds";
import { quantizeSeconds, SetTimelineDurationCommand } from "@/command/timelineCommands";
import { VIEW_MODE } from "@/store/MotionAuthoringStore";
import type { ViewMode } from "@/store/MotionAuthoringStore";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import { finiteVec3 } from "@/core/SceneObject";
import type { Vec3 } from "@/core/SceneObject";
import { MOTION_HANDLE_MODE } from "@/motion/MotionKey";
import { EMPTY_PAYLOAD_CONTRACT, nullable, VEC3_SCHEMA } from "@/command/PayloadContract";
import type { PayloadContract, PayloadFieldSchema } from "@/command/PayloadContract";

const MOTION_COMMAND_VERSION = "1" as const;
const MOTION_PERMISSION = "motion:edit";
const MOTION_READ_PERMISSION = "motion:read";
const MOTION_APPLIES_WHEN = "director-desk.camera-motion-v4";
const EMPTY_PAYLOAD: Record<string, never> = {};
const MINIMUM_KEYS_PER_CLIP = 2;
const CAMERA_FOCUS_MODE = "single" as const;
const MOTION_KEY_HANDLE_KIND = {
    IN: "in",
    OUT: "out",
} as const;
type MotionKeyHandleKind = (typeof MOTION_KEY_HANDLE_KIND)[keyof typeof MOTION_KEY_HANDLE_KIND];

const MINIMUM_TRAJECTORY_PROGRESS = 0;
const MAXIMUM_TRAJECTORY_PROGRESS = 1;

const ISSUE_CODE = {
    PAYLOAD: "motion-invalid-payload",
    CAMERA: "motion-camera-not-found",
    CLIP: "motion-clip-not-found",
    KEY: "motion-key-not-found",
    KEY_MINIMUM: "motion-key-minimum",
    KEY_CONFLICT: "motion-key-progress-conflict",
    DURATION: "motion-time-outside-duration",
    OVERLAP: "motion-overlapping-clip",
    PROGRAM_OVERLAP: "program-overlapping-clip",
    PROGRAM_CLIP: "program-clip-not-found",
    FOCUS_OBJECT: "motion-focus-object-not-found",
    FOLLOW_SUBJECT: "motion-follow-subject-not-found",
    FOLLOW_FRAME: "motion-follow-frame-invalid",
    FOLLOW_RANGE: "motion-follow-out-of-range",
    FOLLOW_UNBOUND: "motion-follow-not-bound",
    FOLLOW_UNRESOLVED: "motion-follow-unresolvable",
    SUBJECT: "motion-subject-not-found",
    MOVE: "motion-unknown-move",
    MOVE_CONFLICT: "motion-move-overridden-by-focus",
} as const;

/** Program 跟随策略:UI 与 AI 共用同一组语义,冲突时由调用方二选一。 */
export const PROGRAM_FOLLOW = {
    FOLLOW: "follow",
    NONE: "none",
    REPLACE: "replace",
} as const;
export type ProgramFollow = (typeof PROGRAM_FOLLOW)[keyof typeof PROGRAM_FOLLOW];

const programLinkage = new ProgramLinkage();
const presetCompiler = new MotionPresetCompiler();
const shotSizePresets = new ShotSizePresets();

interface CreateMotionClipPayload {
    readonly clip: CameraMotionClipJSON;
}

interface CreateTakePayload {
    readonly id?: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly keys: readonly CameraKeyJSON[];
    readonly focus?: FocusTargetJSON | null;
    /** 跟拍覆盖层:非空时 keys 视为跟随系坐标 */
    readonly follow?: CameraFollowTrackJSON | null;
    readonly program?: ProgramFollow;
    /** 整段时间曲线;缺省 smooth */
    readonly easing?: EasingCurve;
}

interface ReplaceMotionClipPayload {
    readonly clip: CameraMotionClipJSON;
}

interface MotionClipIdPayload {
    readonly id: string;
}

/** 跟拍绑定/调参共用载荷:片段 id + 覆盖层全字段(纯数据,与 JSON 同形) */
interface BindMotionClipFollowPayload extends CameraFollowTrackJSON {
    readonly id: string;
}

interface AuthorMotionPayload extends MotionPresetRequest {
    /** 仅创建期读取的静态起幅机位;不会写入运镜资产。 */
    readonly cameraId: string;
}

interface SetMotionClipRangePayload {
    readonly id: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
}

interface SetMotionKeyPayload {
    readonly clipId: string;
    readonly key: CameraKeyJSON;
}

interface MoveMotionKeyPayload {
    readonly clipId: string;
    readonly keyId: string;
    readonly progress: number;
}

interface MotionKeyPayload {
    readonly clipId: string;
    readonly keyId: string;
}

interface SetMotionKeyHandlePayload extends MotionKeyPayload {
    readonly kind: MotionKeyHandleKind;
    readonly value: Vec3;
}

interface SetMotionClipEasingPayload {
    readonly id: string;
    readonly easing: EasingCurve;
}

interface SetMotionClipFocusPayload {
    readonly id: string;
    readonly target: FocusTargetJSON | null;
}

interface RemoveMotionClipPayload {
    readonly id: string;
}

interface SetProgramClipPayload {
    readonly clip: CameraProgramClipJSON;
}

interface RemoveProgramClipPayload {
    readonly id: string;
}

interface PreviewClipPayload {
    readonly clipId: string;
}

interface SetViewModePayload {
    readonly mode: ViewMode;
}

const CAMERA_KEY_SCHEMA: PayloadFieldSchema = {
    type: "object",
    properties: {
        id: { type: "string" },
        progress: { type: "number" },
        position: VEC3_SCHEMA,
        target: VEC3_SCHEMA,
        fov: { type: "number" },
        handleMode: { type: "string", enum: Object.values(MOTION_HANDLE_MODE) },
        inHandle: VEC3_SCHEMA,
        outHandle: VEC3_SCHEMA,
    },
    required: ["id", "progress", "position", "target", "fov", "handleMode", "inHandle", "outHandle"],
};

const FOCUS_TARGET_SCHEMA: PayloadFieldSchema = {
    anyOf: [
        {
            type: "object",
            properties: {
                kind: { type: "string", enum: [FOCUS_TARGET_KIND.WORLD_POINT] },
                position: VEC3_SCHEMA,
            },
            required: ["kind", "position"],
        },
        {
            type: "object",
            properties: {
                kind: { type: "string", enum: [FOCUS_TARGET_KIND.SCENE_OBJECT] },
                objectId: { type: "string" },
                worldOffset: VEC3_SCHEMA,
            },
            required: ["kind", "objectId", "worldOffset"],
        },
    ],
};

const CAMERA_FOCUS_TRACK_SCHEMA: PayloadFieldSchema = {
    type: "object",
    properties: {
        mode: { type: "string", enum: [CAMERA_FOCUS_MODE] },
        target: FOCUS_TARGET_SCHEMA,
    },
    required: ["mode", "target"],
};

const CAMERA_FOLLOW_TRACK_SCHEMA: PayloadFieldSchema = {
    type: "object",
    properties: {
        objectId: { type: "string" },
        anchorOffset: VEC3_SCHEMA,
        frame: { type: "string", enum: Object.values(FOLLOW_FRAME) },
        lagSeconds: { type: "number" },
        smoothingSeconds: { type: "number" },
    },
    required: ["objectId", "anchorOffset", "frame", "lagSeconds", "smoothingSeconds"],
};

const CAMERA_MOTION_CLIP_SCHEMA: PayloadFieldSchema = {
    type: "object",
    properties: {
        id: { type: "string" },
        startTimeSeconds: { type: "number" },
        durationSeconds: { type: "number" },
        keys: { type: "array", items: CAMERA_KEY_SCHEMA, minItems: MINIMUM_KEYS_PER_CLIP },
        focus: nullable(CAMERA_FOCUS_TRACK_SCHEMA),
        follow: nullable(CAMERA_FOLLOW_TRACK_SCHEMA),
        easing: { type: "string", enum: Object.values(EASING) },
    },
    required: ["id", "startTimeSeconds", "durationSeconds", "keys", "focus", "follow", "easing"],
};

const PROGRAM_SOURCE_SCHEMA: PayloadFieldSchema = {
    anyOf: [
        {
            type: "object",
            properties: {
                kind: { type: "string", enum: [PROGRAM_SOURCE_KIND.STATIC_SHOT] },
                shotId: { type: "string" },
            },
            required: ["kind", "shotId"],
        },
        {
            type: "object",
            properties: {
                kind: { type: "string", enum: [PROGRAM_SOURCE_KIND.MOTION_CLIP] },
                motionClipId: { type: "string" },
            },
            required: ["kind", "motionClipId"],
        },
    ],
};

const CAMERA_PROGRAM_CLIP_SCHEMA: PayloadFieldSchema = {
    type: "object",
    properties: {
        id: { type: "string" },
        source: PROGRAM_SOURCE_SCHEMA,
        startTimeSeconds: { type: "number" },
        durationSeconds: { type: "number" },
    },
    required: ["id", "source", "startTimeSeconds", "durationSeconds"],
};

const CREATE_MOTION_CLIP_CONTRACT: PayloadContract = {
    properties: { clip: CAMERA_MOTION_CLIP_SCHEMA },
    required: ["clip"],
};

const CREATE_MOTION_TAKE_CONTRACT: PayloadContract = {
    properties: {
        id: { type: "string" },
        startTimeSeconds: { type: "number" },
        durationSeconds: { type: "number" },
        keys: { type: "array", items: CAMERA_KEY_SCHEMA, minItems: MINIMUM_KEYS_PER_CLIP },
        focus: nullable(FOCUS_TARGET_SCHEMA),
        follow: nullable(CAMERA_FOLLOW_TRACK_SCHEMA),
        program: { type: "string", enum: Object.values(PROGRAM_FOLLOW) },
        easing: { type: "string", enum: Object.values(EASING) },
    },
    required: ["startTimeSeconds", "durationSeconds", "keys"],
};

const REPLACE_MOTION_CLIP_CONTRACT: PayloadContract = {
    properties: { clip: CAMERA_MOTION_CLIP_SCHEMA },
    required: ["clip"],
};

/** 绑定与调参同形:片段 id + 覆盖层全字段 */
const MOTION_FOLLOW_CONTRACT: PayloadContract = {
    properties: {
        id: { type: "string" },
        objectId: { type: "string" },
        anchorOffset: VEC3_SCHEMA,
        frame: { type: "string", enum: Object.values(FOLLOW_FRAME) },
        lagSeconds: { type: "number" },
        smoothingSeconds: { type: "number" },
    },
    required: ["id", "objectId", "anchorOffset", "frame", "lagSeconds", "smoothingSeconds"],
};

const UNBIND_MOTION_FOLLOW_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" } },
    required: ["id"],
};

const SET_MOTION_CLIP_RANGE_CONTRACT: PayloadContract = {
    properties: {
        id: { type: "string" },
        startTimeSeconds: { type: "number" },
        durationSeconds: { type: "number" },
    },
    required: ["id", "startTimeSeconds", "durationSeconds"],
};

const SET_MOTION_KEY_CONTRACT: PayloadContract = {
    properties: { clipId: { type: "string" }, key: CAMERA_KEY_SCHEMA },
    required: ["clipId", "key"],
};

const MOVE_MOTION_KEY_CONTRACT: PayloadContract = {
    properties: { clipId: { type: "string" }, keyId: { type: "string" }, progress: { type: "number" } },
    required: ["clipId", "keyId", "progress"],
};

const REMOVE_MOTION_KEY_CONTRACT: PayloadContract = {
    properties: { clipId: { type: "string" }, keyId: { type: "string" } },
    required: ["clipId", "keyId"],
};

const SET_MOTION_KEY_HANDLE_CONTRACT: PayloadContract = {
    properties: {
        clipId: { type: "string" },
        keyId: { type: "string" },
        kind: { type: "string", enum: Object.values(MOTION_KEY_HANDLE_KIND) },
        value: VEC3_SCHEMA,
    },
    required: ["clipId", "keyId", "kind", "value"],
};

const RESET_MOTION_KEY_HANDLES_CONTRACT: PayloadContract = REMOVE_MOTION_KEY_CONTRACT;

const SET_MOTION_CLIP_EASING_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" }, easing: { type: "string", enum: Object.values(EASING) } },
    required: ["id", "easing"],
};

const SET_MOTION_CLIP_FOCUS_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" }, target: nullable(FOCUS_TARGET_SCHEMA) },
    required: ["id", "target"],
};

const REMOVE_MOTION_CLIP_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" } },
    required: ["id"],
};

const ORBIT_PARAMETERS_SCHEMA: PayloadFieldSchema = {
    type: "object",
    properties: {
        degrees: { type: "number" },
        direction: { type: "string", enum: Object.values(ORBIT_DIRECTION) },
        radiusMeters: { type: "number" },
    },
};

const AUTHOR_MOTION_CONTRACT: PayloadContract = {
    properties: {
        cameraId: { type: "string" },
        startTimeSeconds: { type: "number" },
        durationSeconds: { type: "number" },
        move: { type: "string", enum: Object.values(MOTION_MOVE) },
        subjectId: { type: "string" },
        shotSize: { type: "string", enum: Object.values(SHOT_SIZE) },
        easing: { type: "string", enum: Object.values(EASING) },
        orbit: ORBIT_PARAMETERS_SCHEMA,
    },
    required: ["cameraId", "startTimeSeconds", "durationSeconds", "move"],
};

const QUICK_AUTHOR_MOTION_CONTRACT: PayloadContract = {
    properties: {
        subjectId: { type: "string" },
        shotSize: { type: "string", enum: Object.values(SHOT_SIZE) },
        move: { type: "string", enum: Object.values(MOTION_MOVE) },
        durationSeconds: { type: "number" },
        orbit: ORBIT_PARAMETERS_SCHEMA,
        easing: { type: "string", enum: Object.values(EASING) },
        follow: {
            type: "object",
            properties: {
                approach: { type: "string", enum: Object.values(FOLLOW_APPROACH) },
                frame: { type: "string", enum: Object.values(FOLLOW_FRAME) },
            },
            required: ["approach"],
        },
    },
    required: ["subjectId", "shotSize", "move", "durationSeconds"],
};

const SET_PROGRAM_CLIP_CONTRACT: PayloadContract = {
    properties: { clip: CAMERA_PROGRAM_CLIP_SCHEMA },
    required: ["clip"],
};

const REMOVE_PROGRAM_CLIP_CONTRACT: PayloadContract = REMOVE_MOTION_CLIP_CONTRACT;

const ENTER_MOTION_PREVIEW_CONTRACT: PayloadContract = {
    properties: { clipId: { type: "string" } },
    required: ["clipId"],
};

const EXIT_MOTION_PREVIEW_CONTRACT: PayloadContract = EMPTY_PAYLOAD_CONTRACT;

const SET_VIEW_MODE_CONTRACT: PayloadContract = {
    properties: { mode: { type: "string", enum: Object.values(VIEW_MODE) } },
    required: ["mode"],
};

const CAMERA_MOTION_GET_CONTRACT: PayloadContract = EMPTY_PAYLOAD_CONTRACT;

function issue(code: string, path: string, message: string, options?: CommandIssue["options"]): CommandIssue {
    return { code, path, message, ...(options ? { options } : {}) };
}

function issueMessages(issues: readonly CommandIssue[]): string[] {
    return issues.map((current) => current.message);
}

function orbitParameterIssueFor(move: MotionMove, orbit: unknown): CommandIssue | null {
    switch (true) {
        case orbit === undefined:
            return null;
        case !isOrbitMove(move):
            return issue(ISSUE_CODE.PAYLOAD, "orbit", "环绕参数仅适用于环绕或螺旋升降");
        case OrbitMotionParameters.isValid(orbit):
            return null;
        default:
            return issue(ISSUE_CODE.PAYLOAD, "orbit", "环绕参数无效:转角须为 (0, 360],方向为 cw/ccw,半径为 0.2–50 米");
    }
}

/** author 与 quick-author 共用的语汇参数围栏(Rule of Two):语汇枚举、注视冲突与环绕值对象。 */
function presetParamIssues(payload: {
    readonly move: MotionMove;
    readonly orbit?: unknown;
    readonly subjectId?: string | undefined;
}): CommandIssue[] {
    const moveIssue = Object.values(MOTION_MOVE).includes(payload.move)
        ? null
        : issue(ISSUE_CODE.MOVE, "move", "未知的运镜语汇");
    const orientationIssue =
        payload.subjectId !== undefined && isOrientationMove(payload.move)
            ? issue(
                  ISSUE_CODE.MOVE_CONFLICT,
                  "move",
                  "摇镜/俯仰改的是注视方向,而注视已被被摄对象接管;改用横移或环绕,或去掉被摄对象",
              )
            : null;
    const orbitIssue = orbitParameterIssueFor(payload.move, payload.orbit);
    return [moveIssue, orientationIssue, orbitIssue].filter((current): current is CommandIssue => current !== null);
}

/** Program 跟随三件套只消费这个切片(拓宽签名:quick-author 的计划结构免构造整个 clip) */
interface ProgramRangeLike {
    readonly id: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
}

interface QuantizedTimeRange {
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
}

/** 片段起止同帧率栅格对齐，时长只由两端相减，避免独立舍入后终点漂移。 */
function quantizedTimeRange(
    ctx: DirectorContext,
    startTimeSeconds: number,
    durationSeconds: number,
): QuantizedTimeRange | null {
    const quantizedStart = quantizeSeconds(ctx, startTimeSeconds);
    const quantizedEnd = quantizeSeconds(ctx, startTimeSeconds + durationSeconds);
    return quantizedEnd > quantizedStart
        ? { startTimeSeconds: quantizedStart, durationSeconds: quantizedEnd - quantizedStart }
        : null;
}

function motionProgramSource(clip: ProgramRangeLike): ProgramSource {
    return { kind: PROGRAM_SOURCE_KIND.MOTION_CLIP, motionClipId: clip.id };
}

function motionClipFrom(clip: CameraMotionClipJSON): CameraMotionClip | null {
    try {
        return new CameraMotionClip(clip);
    } catch {
        return null;
    }
}

function quantizedMotionClip(ctx: DirectorContext, clip: CameraMotionClip): CameraMotionClip | null {
    const range = quantizedTimeRange(ctx, clip.startTimeSeconds, clip.durationSeconds);
    return range ? clip.withTimeRange(range.startTimeSeconds, range.durationSeconds) : null;
}

function replaceQuantizedClip(ctx: DirectorContext, clip: CameraMotionClip): void {
    const quantized = quantizedMotionClip(ctx, clip);
    if (quantized) ctx.motion.replaceClip(quantized);
}

function programClipFrom(payload: SetProgramClipPayload): CameraProgramClip | null {
    try {
        return new CameraProgramClip(payload.clip);
    } catch {
        return null;
    }
}

function quantizedProgramClip(ctx: DirectorContext, clip: CameraProgramClip): CameraProgramClip | null {
    const range = quantizedTimeRange(ctx, clip.startTimeSeconds, clip.durationSeconds);
    return range
        ? new CameraProgramClip({
              id: clip.id,
              source: clip.source,
              startTimeSeconds: range.startTimeSeconds,
              durationSeconds: range.durationSeconds,
          })
        : null;
}

function existingClip(ctx: DirectorContext, id: unknown): CameraMotionClip | null {
    return typeof id === "string" && id.length > 0 ? (ctx.motion.clip(id) ?? null) : null;
}

function clipRangeIssue(ctx: DirectorContext, clip: CameraMotionClip): CommandIssue | null {
    return clip.endTimeSeconds > ctx.timeline.document.duration
        ? issue(ISSUE_CODE.DURATION, "clip", "运镜片段不能超出时间轴时长")
        : null;
}

function clipIssues(ctx: DirectorContext, clip: CameraMotionClip): readonly CommandIssue[] {
    const target = clip.focus?.target;
    const hasFocusObject =
        !target ||
        target.kind !== FOCUS_TARGET_KIND.SCENE_OBJECT ||
        ctx.scene.manager.getEntity(target.objectId) !== undefined;
    if (!hasFocusObject) return [issue(ISSUE_CODE.FOCUS_OBJECT, "clip.focus.target.objectId", "注视绑定对象不存在")];
    const followObjectId = clip.follow?.objectId;
    if (followObjectId !== undefined && !ctx.scene.manager.getEntity(followObjectId)) {
        return [issue(ISSUE_CODE.FOLLOW_SUBJECT, "clip.follow.objectId", "跟拍主体不存在")];
    }
    const range = clipRangeIssue(ctx, clip);
    return range ? [range] : [];
}

/** payload → 跟拍覆盖层:数值与枚举围栏由值对象构造函数统一裁决(围栏单一真相源)。 */
function followFromPayload(payload: BindMotionClipFollowPayload): CameraFollowTrack | null {
    try {
        return new CameraFollowTrack(payload);
    } catch {
        return null;
    }
}

/** 越界原因逐项定位,AI 才知道该改哪个字段;顺序与值对象的校验顺序一致。 */
function followPayloadIssue(payload: BindMotionClipFollowPayload): CommandIssue {
    if (!isFollowFrame(payload.frame)) {
        return issue(ISSUE_CODE.FOLLOW_FRAME, "frame", "跟拍参考系只能是 world(平移)或 heading(朝向)");
    }
    if (!finiteVec3(payload.anchorOffset)) {
        return issue(
            ISSUE_CODE.FOLLOW_RANGE,
            "anchorOffset",
            `锚点偏移需为有限数值且不超过 ${FOLLOW_ANCHOR_LIMIT_METERS} 米`,
        );
    }
    if (!isWithinRange(payload.lagSeconds, FOLLOW_LAG_MIN_SECONDS, FOLLOW_LAG_MAX_SECONDS)) {
        return issue(
            ISSUE_CODE.FOLLOW_RANGE,
            "lagSeconds",
            `滞后需在 ${FOLLOW_LAG_MIN_SECONDS} ~ ${FOLLOW_LAG_MAX_SECONDS} 秒之间`,
        );
    }
    if (!isWithinRange(payload.smoothingSeconds, FOLLOW_SMOOTHING_MIN_SECONDS, FOLLOW_SMOOTHING_MAX_SECONDS)) {
        return issue(
            ISSUE_CODE.FOLLOW_RANGE,
            "smoothingSeconds",
            `平滑需在 ${FOLLOW_SMOOTHING_MIN_SECONDS} ~ ${FOLLOW_SMOOTHING_MAX_SECONDS} 秒之间`,
        );
    }
    return issue(ISSUE_CODE.FOLLOW_RANGE, "anchorOffset", `锚点偏移不得超过 ${FOLLOW_ANCHOR_LIMIT_METERS} 米`);
}

function isWithinRange(value: number, min: number, max: number): boolean {
    return Number.isFinite(value) && value >= min && value <= max;
}

/** 重写全部关键帧的聚合命令共用的逆命令:整片段回到前态。 */
function restoreClipCommand(ctx: DirectorContext, id: unknown): readonly SerializedCommand[] | null {
    const current = existingClip(ctx, id);
    return current ? [{ type: ReplaceMotionClipCommand.TYPE, payload: { clip: current.toJSON() } }] : null;
}

/** 关键帧写操作共用的定位:片段 + 关键帧一次解析,失败即结构化 issue。 */
function locateKey(
    ctx: DirectorContext,
    clipId: string,
    keyId: string,
): { readonly clip: CameraMotionClip; readonly key: CameraKey } | CommandIssue {
    const clip = existingClip(ctx, clipId);
    if (!clip) return issue(ISSUE_CODE.CLIP, "clipId", "运镜片段不存在");
    const key = clip.key(keyId);
    return key ? { clip, key } : issue(ISSUE_CODE.KEY, "keyId", "镜头关键帧不存在");
}

function isIssue(value: object): value is CommandIssue {
    return "code" in value;
}

/** 关键帧写命令的统一逆命令:回到该关键帧的前值。 */
function restoreKeyCommand(clipId: string, key: CameraKey): SerializedCommand {
    return { type: SetMotionKeyCommand.TYPE, payload: { clipId, key: key.toJSON() } };
}

function replaceKey(ctx: DirectorContext, clip: CameraMotionClip, key: CameraKey): void {
    replaceQuantizedClip(ctx, clip.withKey(key));
    ctx.playback.sampleCurrent();
}

/** 将帧对齐时刻映回轨迹域；浮点反解越界时钳住有效进度。 */
function quantizedTrajectoryProgress(ctx: DirectorContext, clip: CameraMotionClip, progress: number): number {
    const timeSeconds = quantizeSeconds(ctx, clip.timeAtProgress(progress));
    return Math.min(
        MAXIMUM_TRAJECTORY_PROGRESS,
        Math.max(MINIMUM_TRAJECTORY_PROGRESS, clip.trajectoryProgressAt(timeSeconds)),
    );
}

/** Creates a serialized, independent motion segment. Trajectory and temporal range remain independently editable. */
export class CreateMotionClipCommand extends DirectorCommand<CreateMotionClipPayload> {
    static readonly TYPE = "motion.create-clip";
    readonly type = CreateMotionClipCommand.TYPE;

    constructor(readonly payload: CreateMotionClipPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const parsed = motionClipFrom(this.payload.clip);
        const clip = parsed ? quantizedMotionClip(ctx, parsed) : null;
        if (!clip) return [issue(ISSUE_CODE.PAYLOAD, "clip", "运镜片段时间范围至少覆盖一帧")];
        if (ctx.motion.clip(clip.id)) return [issue(ISSUE_CODE.PAYLOAD, "clip.id", "运镜片段 id 已存在")];
        return clipIssues(ctx, clip);
    }

    execute(ctx: DirectorContext): void {
        const parsed = motionClipFrom(this.payload.clip);
        const clip = parsed ? quantizedMotionClip(ctx, parsed) : null;
        if (clip) replaceQuantizedClip(ctx, clip);
        ctx.playback.sampleCurrent();
    }

    override invert(): readonly SerializedCommand[] {
        return [{ type: RemoveMotionClipCommand.TYPE, payload: { id: this.payload.clip.id } }];
    }
}

/**
 * 一次成片:运镜片段与其 Program 输出片段同时落地。
 *
 * 「做完运镜忘了切 Program = 成片该段黑屏」是最贵的沉默失败,故输出跟随是默认行为;
 * 其它机位已占用该时段时不静默覆盖,返回带 options 的结构化冲突让作者/AI 二选一。
 */
export class CreateMotionTakeCommand extends DirectorCommand<CreateTakePayload> {
    static readonly TYPE = "motion.create-take";
    readonly type = CreateMotionTakeCommand.TYPE;

    constructor(readonly payload: CreateTakePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const clip = this.clip(ctx);
        if (!clip) return [issue(ISSUE_CODE.PAYLOAD, "keys", "镜头关键帧格式无效或时间范围不足一帧")];
        const clipProblems = clipIssues(ctx, clip);
        if (clipProblems.length > 0) return clipProblems;
        return programIssues(ctx, clip, this.programMode());
    }

    execute(ctx: DirectorContext): void {
        const clip = this.clip(ctx);
        if (!clip) return;
        replaceQuantizedClip(ctx, clip);
        applyProgramFollow(ctx, clip, this.programMode());
        ctx.timelineSelection.select(TimelineSelection.motionClip(clip.id));
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const clip = this.clip(ctx);
        if (!clip) return null;
        return [
            { type: RemoveMotionClipCommand.TYPE, payload: { id: clip.id } },
            ...invertProgramFollow(ctx, clip, this.programMode()),
        ];
    }

    private programMode(): ProgramFollow {
        return this.payload.program ?? PROGRAM_FOLLOW.FOLLOW;
    }

    private clip(ctx: DirectorContext): CameraMotionClip | null {
        const range = quantizedTimeRange(ctx, this.payload.startTimeSeconds, this.payload.durationSeconds);
        if (!range) return null;
        try {
            return new CameraMotionClip({
                id: this.payload.id ?? takeIdFor(this.payload),
                startTimeSeconds: range.startTimeSeconds,
                durationSeconds: range.durationSeconds,
                keys: this.payload.keys,
                focus: this.payload.focus ? { mode: CAMERA_FOCUS_MODE, target: this.payload.focus } : null,
                follow: this.payload.follow ?? null,
                ...(this.payload.easing ? { easing: this.payload.easing } : {}),
            });
        } catch {
            return null;
        }
    }
}

/** take id 必须在 validate 与 execute 之间稳定,故由 payload 的时间范围决定。 */
function takeIdFor(payload: CreateTakePayload): string {
    return `take-${payload.startTimeSeconds}-${payload.durationSeconds}`;
}

function programIssues(ctx: DirectorContext, clip: ProgramRangeLike, mode: ProgramFollow): readonly CommandIssue[] {
    if (mode !== PROGRAM_FOLLOW.FOLLOW) return [];
    const source = motionProgramSource(clip);
    const slot = programLinkage.slotFor(ctx.motion.program, source, clip.startTimeSeconds, clip.durationSeconds);
    if (slot.kind !== PROGRAM_SLOT_KIND.CONFLICT) return [];
    return [
        issue(ISSUE_CODE.PROGRAM_OVERLAP, "program", "该时段的 Program 输出已被其它来源占用", [
            { type: "motion.create-take:replace-program", label: "替换为本运镜输出" },
            { type: "motion.create-take:keep-current", label: "保留现有输出" },
        ]),
    ];
}

function applyProgramFollow(ctx: DirectorContext, clip: ProgramRangeLike, mode: ProgramFollow): void {
    if (mode === PROGRAM_FOLLOW.NONE) return;
    const source = motionProgramSource(clip);
    const slot = programLinkage.slotFor(ctx.motion.program, source, clip.startTimeSeconds, clip.durationSeconds);
    const cleared = slot.clips.reduce((program, current) => program.withoutClip(current.id), ctx.motion.program);
    const merged = programLinkage.mergedClip(
        slot.kind === PROGRAM_SLOT_KIND.CONFLICT ? { kind: slot.kind, clips: [] } : slot,
        source,
        clip.startTimeSeconds,
        clip.durationSeconds,
        `program-${clip.id}`,
    );
    ctx.motion.replaceProgram(cleared.withClip(merged));
}

function invertProgramFollow(
    ctx: DirectorContext,
    clip: ProgramRangeLike,
    mode: ProgramFollow,
): readonly SerializedCommand[] {
    if (mode === PROGRAM_FOLLOW.NONE) return [];
    const source = motionProgramSource(clip);
    const slot = programLinkage.slotFor(ctx.motion.program, source, clip.startTimeSeconds, clip.durationSeconds);
    // RemoveMotionClip cascades deletion of the generated Program source; only the pre-existing output needs restoration.
    return slot.clips.map((current) => ({
        type: SetProgramClipCommand.TYPE,
        payload: { clip: current.toJSON() },
    }));
}

/** 重定时一段运镜而不重画轨迹;跟随态的 Program 片段一并移动。 */
export class SetMotionClipRangeCommand extends DirectorCommand<SetMotionClipRangePayload> {
    static readonly TYPE = "motion.set-clip-range";
    readonly type = SetMotionClipRangeCommand.TYPE;

    constructor(readonly payload: SetMotionClipRangePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const current = existingClip(ctx, this.payload.id);
        if (!current) return [issue(ISSUE_CODE.CLIP, "id", "运镜片段不存在")];
        const candidate = this.retimed(ctx, current);
        if (!candidate) return [issue(ISSUE_CODE.PAYLOAD, "clip", "运镜片段时间范围必须至少覆盖一帧")];
        return clipIssues(ctx, candidate);
    }

    execute(ctx: DirectorContext): void {
        const current = existingClip(ctx, this.payload.id);
        const candidate = current ? this.retimed(ctx, current) : null;
        if (!current || !candidate) return;
        const following = programLinkage.followingClip(ctx.motion.program, current);
        replaceQuantizedClip(ctx, candidate);
        if (following) {
            ctx.motion.replaceProgram(
                ctx.motion.program.withoutClip(following.id).withClip(
                    new CameraProgramClip({
                        id: following.id,
                        source: following.source,
                        startTimeSeconds: candidate.startTimeSeconds,
                        durationSeconds: candidate.durationSeconds,
                    }),
                ),
            );
        }
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const current = existingClip(ctx, this.payload.id);
        if (!current) return null;
        const following = programLinkage.followingClip(ctx.motion.program, current);
        return [
            {
                type: SetMotionClipRangeCommand.TYPE,
                payload: {
                    id: current.id,
                    startTimeSeconds: current.startTimeSeconds,
                    durationSeconds: current.durationSeconds,
                },
            },
            ...(following ? [{ type: SetProgramClipCommand.TYPE, payload: { clip: following.toJSON() } }] : []),
        ];
    }

    private retimed(ctx: DirectorContext, current: CameraMotionClip): CameraMotionClip | null {
        const range = quantizedTimeRange(ctx, this.payload.startTimeSeconds, this.payload.durationSeconds);
        return range ? current.withTimeRange(range.startTimeSeconds, range.durationSeconds) : null;
    }
}

/** 落一枚镜头关键帧(存在即覆盖):视口摆位、时间轴打点与 AI 共用这一条写入口。 */
export class SetMotionKeyCommand extends DirectorCommand<SetMotionKeyPayload> {
    static readonly TYPE = "motion.set-key";
    readonly type = SetMotionKeyCommand.TYPE;

    constructor(readonly payload: SetMotionKeyPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const clip = existingClip(ctx, this.payload.clipId);
        if (!clip) return [issue(ISSUE_CODE.CLIP, "clipId", "运镜片段不存在")];
        const key = cameraKeyOrNull(this.payload.key);
        if (!key)
            return [issue(ISSUE_CODE.PAYLOAD, "key", "镜头关键帧参数无效(progress∈[0,1]、位姿有限、fov 在围栏内)")];
        return withKeyIssues(clip, key);
    }

    execute(ctx: DirectorContext): void {
        const clip = existingClip(ctx, this.payload.clipId);
        const key = cameraKeyOrNull(this.payload.key);
        if (clip && key) replaceKey(ctx, clip, key);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const clip = existingClip(ctx, this.payload.clipId);
        if (!clip) return null;
        const prior = clip.key(this.payload.key.id);
        return prior
            ? [restoreKeyCommand(clip.id, prior)]
            : [{ type: RemoveMotionKeyCommand.TYPE, payload: { clipId: clip.id, keyId: this.payload.key.id } }];
    }
}

function cameraKeyOrNull(json: CameraKeyJSON): CameraKey | null {
    try {
        return new CameraKey(json);
    } catch {
        return null;
    }
}

/** 关键帧写入的公共围栏:progress 冲突由轨迹聚合裁决,命令层只负责翻译成结构化 issue。 */
function withKeyIssues(clip: CameraMotionClip, key: CameraKey): readonly CommandIssue[] {
    try {
        clip.withKey(key);
        return [];
    } catch {
        return [issue(ISSUE_CODE.KEY_CONFLICT, "key.progress", "同一片段内关键帧进度必须唯一")];
    }
}

/** 重定时一枚关键帧:只改 progress,画面不动。 */
export class MoveMotionKeyCommand extends DirectorCommand<MoveMotionKeyPayload> {
    static readonly TYPE = "motion.move-key";
    readonly type = MoveMotionKeyCommand.TYPE;

    constructor(readonly payload: MoveMotionKeyPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        if (isIssue(located)) return [located];
        const progress = quantizedTrajectoryProgress(ctx, located.clip, this.payload.progress);
        const moved = movedKeyOrNull(located.key, progress);
        if (!moved) return [issue(ISSUE_CODE.PAYLOAD, "progress", "关键帧进度必须落在 [0,1]")];
        return withKeyIssues(located.clip, moved);
    }

    execute(ctx: DirectorContext): void {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        if (isIssue(located)) return;
        const progress = quantizedTrajectoryProgress(ctx, located.clip, this.payload.progress);
        const moved = movedKeyOrNull(located.key, progress);
        if (moved) replaceKey(ctx, located.clip, moved);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        return isIssue(located) ? null : [restoreKeyCommand(located.clip.id, located.key)];
    }
}

function movedKeyOrNull(key: CameraKey, progress: number): CameraKey | null {
    try {
        return key.withProgress(progress);
    } catch {
        return null;
    }
}

export class RemoveMotionKeyCommand extends DirectorCommand<MotionKeyPayload> {
    static readonly TYPE = "motion.remove-key";
    readonly type = RemoveMotionKeyCommand.TYPE;

    constructor(readonly payload: MotionKeyPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        if (isIssue(located)) return [located];
        return located.clip.keys.length > MINIMUM_KEYS_PER_CLIP
            ? []
            : [
                  issue(ISSUE_CODE.KEY_MINIMUM, "keyId", "运镜至少需要两枚关键帧;要清空请删除整段", [
                      { type: "motion.remove-clip", label: "删除该运镜片段" },
                  ]),
              ];
    }

    execute(ctx: DirectorContext): void {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        if (isIssue(located)) return;
        const next = located.clip.withoutKey(this.payload.keyId);
        if (!next) return;
        ctx.timelineSelection.forget(this.payload.keyId);
        replaceQuantizedClip(ctx, next);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        return isIssue(located) ? null : [restoreKeyCommand(located.clip.id, located.key)];
    }
}

/** 拖手柄即接管切线:命令层落地「auto → manual」的语义切换,系统此后不再自动平滑该点。 */
export class SetMotionKeyHandleCommand extends DirectorCommand<SetMotionKeyHandlePayload> {
    static readonly TYPE = "motion.set-key-handle";
    readonly type = SetMotionKeyHandleCommand.TYPE;

    constructor(readonly payload: SetMotionKeyHandlePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        if (isIssue(located)) return [located];
        const isValid =
            (this.payload.kind === MOTION_KEY_HANDLE_KIND.IN || this.payload.kind === MOTION_KEY_HANDLE_KIND.OUT) &&
            finiteVec3(this.payload.value);
        return isValid ? [] : [issue(ISSUE_CODE.PAYLOAD, "value", "手柄必须是有限向量,kind 取 in 或 out")];
    }

    execute(ctx: DirectorContext): void {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        if (isIssue(located)) return;
        replaceKey(ctx, located.clip, located.key.withHandle(this.payload.kind, this.payload.value));
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        return isIssue(located) ? null : [restoreKeyCommand(located.clip.id, located.key)];
    }
}

/** 交还切线控制权:关键帧回到 auto,曲线重新自动平滑。 */
export class ResetMotionKeyHandlesCommand extends DirectorCommand<MotionKeyPayload> {
    static readonly TYPE = "motion.reset-key-handles";
    readonly type = ResetMotionKeyHandlesCommand.TYPE;

    constructor(readonly payload: MotionKeyPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        return isIssue(located) ? [located] : [];
    }

    execute(ctx: DirectorContext): void {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        if (isIssue(located)) return;
        replaceKey(ctx, located.clip, located.key.withAutoHandles());
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        return isIssue(located) ? null : [restoreKeyCommand(located.clip.id, located.key)];
    }
}

/** 整段时间曲线:smooth = 起落加减速,linear = 全程匀速。段间快慢由关键帧 progress 分布表达。 */
export class SetMotionClipEasingCommand extends DirectorCommand<SetMotionClipEasingPayload> {
    static readonly TYPE = "motion.set-clip-easing";
    readonly type = SetMotionClipEasingCommand.TYPE;

    constructor(readonly payload: SetMotionClipEasingPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const clip = existingClip(ctx, this.payload.id);
        if (!clip) return [issue(ISSUE_CODE.CLIP, "id", "运镜片段不存在")];
        return isEasingCurve(this.payload.easing)
            ? []
            : [issue(ISSUE_CODE.PAYLOAD, "easing", "运镜缓动必须为 linear 或 smooth")];
    }

    execute(ctx: DirectorContext): void {
        const clip = existingClip(ctx, this.payload.id);
        if (!clip) return;
        replaceQuantizedClip(ctx, clip.withEasing(this.payload.easing));
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const clip = existingClip(ctx, this.payload.id);
        return clip ? [{ type: SetMotionClipEasingCommand.TYPE, payload: { id: clip.id, easing: clip.easing } }] : null;
    }
}

/** 注视覆盖层:绑定对象即接管全部关键帧的注视点,target=null 解除覆盖回到关键帧插值。 */
export class SetMotionClipFocusCommand extends DirectorCommand<SetMotionClipFocusPayload> {
    static readonly TYPE = "motion.set-focus";
    readonly type = SetMotionClipFocusCommand.TYPE;

    constructor(readonly payload: SetMotionClipFocusPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const current = existingClip(ctx, this.payload.id);
        if (!current) return [issue(ISSUE_CODE.CLIP, "id", "运镜片段不存在")];
        const focus = this.focus();
        if (focus === undefined) return [issue(ISSUE_CODE.PAYLOAD, "target", "注视目标格式无效")];
        const target = focus?.target;
        const isResolvable =
            !target ||
            target.kind !== FOCUS_TARGET_KIND.SCENE_OBJECT ||
            ctx.scene.manager.getEntity(target.objectId) !== undefined;
        return isResolvable ? [] : [issue(ISSUE_CODE.FOCUS_OBJECT, "target.objectId", "注视绑定对象不存在")];
    }

    execute(ctx: DirectorContext): void {
        const current = existingClip(ctx, this.payload.id);
        const focus = this.focus();
        if (!current || focus === undefined) return;
        replaceQuantizedClip(ctx, current.withFocus(focus));
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const current = existingClip(ctx, this.payload.id);
        return current
            ? [
                  {
                      type: SetMotionClipFocusCommand.TYPE,
                      payload: { id: current.id, target: current.focus?.target.toJSON() ?? null },
                  },
              ]
            : null;
    }

    /** undefined = 载荷非法;null = 解除覆盖 */
    private focus(): CameraFocusTrack | null | undefined {
        if (this.payload.target === null || this.payload.target === undefined) return null;
        try {
            return new CameraFocusTrack({ target: this.payload.target });
        } catch {
            return undefined;
        }
    }
}

/**
 * 整片段写入(地基):任何重写全部关键帧的聚合操作都以它作逆命令。
 *
 * 与 create-clip 的前置条件互斥——那条要求 id 不存在,这条要求 id 已存在,
 * 因此不是重复实现。自反:携前态 JSON 即可原样回滚。
 */
export class ReplaceMotionClipCommand extends DirectorCommand<ReplaceMotionClipPayload> {
    static readonly TYPE = "motion.replace-clip";
    readonly type = ReplaceMotionClipCommand.TYPE;

    constructor(readonly payload: ReplaceMotionClipPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (!existingClip(ctx, this.payload.clip.id)) return [issue(ISSUE_CODE.CLIP, "clip.id", "运镜片段不存在")];
        const clip = motionClipFrom(this.payload.clip);
        if (!clip) return [issue(ISSUE_CODE.PAYLOAD, "clip", "运镜片段数据无效")];
        return clipIssues(ctx, clip);
    }

    execute(ctx: DirectorContext): void {
        const clip = motionClipFrom(this.payload.clip);
        if (!clip || !existingClip(ctx, clip.id)) return;
        replaceQuantizedClip(ctx, clip);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const current = existingClip(ctx, this.payload.clip.id);
        return current ? [{ type: ReplaceMotionClipCommand.TYPE, payload: { clip: current.toJSON() } }] : null;
    }
}

/**
 * 绑定跟拍(聚合):设跟拍覆盖层 + 把全部关键帧从世界系搬进主体跟随系。
 *
 * 两件事必须同一条命令:分开发两次会撕碎撤销,并且中途失败会留下「覆盖层已设、关键帧还在世界系」
 * 的画面瞬移。绑定在关键帧时刻严格保画面(见 FollowSpaceCodec)。
 */
export class BindMotionClipFollowCommand extends DirectorCommand<BindMotionClipFollowPayload> {
    static readonly TYPE = "motion.bind-follow";
    readonly type = BindMotionClipFollowCommand.TYPE;

    constructor(readonly payload: BindMotionClipFollowPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const clip = existingClip(ctx, this.payload.id);
        if (!clip) return [issue(ISSUE_CODE.CLIP, "id", "运镜片段不存在")];
        const follow = followFromPayload(this.payload);
        if (!follow) return [followPayloadIssue(this.payload)];
        if (!ctx.scene.manager.getEntity(follow.objectId)) {
            return [issue(ISSUE_CODE.FOLLOW_SUBJECT, "objectId", "跟拍主体不存在")];
        }
        return followSpaceCodecFor(ctx).convertKeys(clip, follow, FOLLOW_SPACE.LOCAL)
            ? []
            : [issue(ISSUE_CODE.FOLLOW_UNRESOLVED, "objectId", "跟拍主体在该片段时段内无法定位")];
    }

    execute(ctx: DirectorContext): void {
        const clip = existingClip(ctx, this.payload.id);
        const follow = followFromPayload(this.payload);
        if (!clip || !follow) return;
        const keys = followSpaceCodecFor(ctx).convertKeys(clip, follow, FOLLOW_SPACE.LOCAL);
        if (!keys) return;
        replaceQuantizedClip(ctx, clip.withKeys(keys).withFollow(follow));
        ctx.motionAuthoring.setSubject(follow.objectId);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        return restoreClipCommand(ctx, this.payload.id);
    }
}

/** 解除跟拍(聚合):把关键帧烘回世界系 + 清覆盖层。与绑定互为正逆,画面同样不跳。 */
export class UnbindMotionClipFollowCommand extends DirectorCommand<MotionClipIdPayload> {
    static readonly TYPE = "motion.unbind-follow";
    readonly type = UnbindMotionClipFollowCommand.TYPE;

    constructor(readonly payload: MotionClipIdPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const clip = existingClip(ctx, this.payload.id);
        if (!clip) return [issue(ISSUE_CODE.CLIP, "id", "运镜片段不存在")];
        if (!clip.follow) return [issue(ISSUE_CODE.FOLLOW_UNBOUND, "id", "该片段未绑定跟拍")];
        return followSpaceCodecFor(ctx).convertKeys(clip, clip.follow, FOLLOW_SPACE.WORLD)
            ? []
            : [issue(ISSUE_CODE.FOLLOW_UNRESOLVED, "id", "跟拍主体在该片段时段内无法定位")];
    }

    execute(ctx: DirectorContext): void {
        const clip = existingClip(ctx, this.payload.id);
        if (!clip?.follow) return;
        const keys = followSpaceCodecFor(ctx).convertKeys(clip, clip.follow, FOLLOW_SPACE.WORLD);
        if (!keys) return;
        replaceQuantizedClip(ctx, clip.withKeys(keys).withFollow(null));
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        return restoreClipCommand(ctx, this.payload.id);
    }
}

/**
 * 调整跟拍参数:参考系/锚点/滞后/平滑。
 * 不重算关键帧——改这些参数本就应当改变画面,重算反而把改动抵消掉。
 */
export class SetMotionClipFollowParamsCommand extends DirectorCommand<BindMotionClipFollowPayload> {
    static readonly TYPE = "motion.set-follow-params";
    readonly type = SetMotionClipFollowParamsCommand.TYPE;

    constructor(readonly payload: BindMotionClipFollowPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const clip = existingClip(ctx, this.payload.id);
        if (!clip) return [issue(ISSUE_CODE.CLIP, "id", "运镜片段不存在")];
        if (!clip.follow) return [issue(ISSUE_CODE.FOLLOW_UNBOUND, "id", "该片段未绑定跟拍")];
        const follow = followFromPayload(this.payload);
        if (!follow) return [followPayloadIssue(this.payload)];
        return follow.objectId === clip.follow.objectId
            ? []
            : [issue(ISSUE_CODE.FOLLOW_SUBJECT, "objectId", "换跟拍主体请重新绑定,以免关键帧留在旧主体的坐标里")];
    }

    execute(ctx: DirectorContext): void {
        const clip = existingClip(ctx, this.payload.id);
        const follow = followFromPayload(this.payload);
        if (!clip?.follow || !follow || follow.objectId !== clip.follow.objectId) return;
        replaceQuantizedClip(ctx, clip.withFollow(follow));
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const clip = existingClip(ctx, this.payload.id);
        const follow = clip?.follow;
        return follow
            ? [{ type: SetMotionClipFollowParamsCommand.TYPE, payload: { id: clip.id, ...follow.toJSON() } }]
            : null;
    }
}

export class RemoveMotionClipCommand extends DirectorCommand<RemoveMotionClipPayload> {
    static readonly TYPE = "motion.remove-clip";
    readonly type = RemoveMotionClipCommand.TYPE;

    constructor(readonly payload: RemoveMotionClipPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        return existingClip(ctx, this.payload.id) ? [] : [issue(ISSUE_CODE.CLIP, "id", "运镜片段不存在")];
    }

    execute(ctx: DirectorContext): void {
        ctx.motionAuthoring.forgetClip(this.payload.id);
        ctx.timelineSelection.forget(this.payload.id);
        ctx.motion.removeClip(this.payload.id);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const current = existingClip(ctx, this.payload.id);
        if (!current) return null;
        const programCommands = ctx.motion.program.clips
            .filter(
                (clip) =>
                    clip.source.kind === PROGRAM_SOURCE_KIND.MOTION_CLIP && clip.source.motionClipId === current.id,
            )
            .map((clip) => ({ type: SetProgramClipCommand.TYPE, payload: { clip: clip.toJSON() } }));
        return [{ type: CreateMotionClipCommand.TYPE, payload: { clip: current.toJSON() } }, ...programCommands];
    }
}

/**
 * author 与 quick-author 共用的 take 装配(Rule of Two):keys 编译 + 两层覆盖注入一处收口。
 *
 * 跟拍态传入的 shot/subject 已是**跟随系**里的构图(主体在原点),
 * 因此现有全部 MOVE_RESOLVERS 一行不用改就能产出跟拍版关键帧。
 * focus 仍绑世界系的主体,注视由它接管;keys 的 target 只是兜底。
 */
function takeCommandFor(
    request: MotionPresetRequest,
    shot: CameraShot,
    subject: SubjectFocusBounds | null,
    takeId: string,
    follow: CameraFollowTrackJSON | null = null,
): CreateMotionTakeCommand {
    const keys = presetCompiler.compile(request, { shot, subject });
    return new CreateMotionTakeCommand({
        id: takeId,
        startTimeSeconds: request.startTimeSeconds,
        durationSeconds: request.durationSeconds,
        keys,
        follow,
        ...(request.easing ? { easing: request.easing } : {}),
        focus:
            request.subjectId && subject
                ? {
                      kind: FOCUS_TARGET_KIND.SCENE_OBJECT,
                      objectId: request.subjectId,
                      worldOffset: follow ? follow.anchorOffset : subject.focusOffset,
                  }
                : null,
    });
}

/**
 * 语义层入口:导演语汇 → 标准关键帧序列 → 与 create-take 同一条落地路径。
 * UI 的预设按钮与 AI 工具调用共用它,产出可再编辑,不是黑盒。
 */
export class AuthorMotionCommand extends DirectorCommand<AuthorMotionPayload> {
    static readonly TYPE = "motion.author";
    readonly type = AuthorMotionCommand.TYPE;

    constructor(readonly payload: AuthorMotionPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const paramIssues = presetParamIssues(this.payload);
        if (paramIssues.length > 0) return paramIssues;
        const shot = ctx.camera.director.getShot(this.payload.cameraId);
        if (!shot) return [issue(ISSUE_CODE.CAMERA, "cameraId", "创建来源机位不存在")];
        const subjectId = this.payload.subjectId;
        if (subjectId && !ctx.scene.manager.getEntity(subjectId)) {
            return [issue(ISSUE_CODE.SUBJECT, "subjectId", "跟拍对象不存在")];
        }
        return this.takeCommand(ctx)?.validateIssues?.(ctx) ?? [issue(ISSUE_CODE.PAYLOAD, "keys", "预设编译失败")];
    }

    execute(ctx: DirectorContext): void {
        this.takeCommand(ctx)?.execute(ctx);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        return this.takeCommand(ctx)?.invert(ctx) ?? null;
    }

    private takeCommand(ctx: DirectorContext): CreateMotionTakeCommand | null {
        const shot = ctx.camera.director.getShot(this.payload.cameraId);
        if (!shot) return null;
        const subject = this.payload.subjectId ? subjectBoundsFor(ctx, this.payload.subjectId) : null;
        return takeCommandFor(
            this.payload,
            shot,
            subject,
            `take-${this.payload.cameraId}-${this.payload.move}-${this.payload.startTimeSeconds}`,
        );
    }
}

/** 一句话跟拍:方位用枚举而非裸角度,LLM 永不发世界坐标 */
interface QuickAuthorFollowRequest {
    readonly approach: FollowApproach;
    readonly frame?: FollowFrame;
}

interface QuickAuthorPayload {
    /** 被摄对象(同时成为注视目标);机位由景别预设从它派生 */
    readonly subjectId: string;
    /** 起幅景别(ShotSizePresets 定距,方位角取当前相机朝向;跟拍态取站位枚举) */
    readonly shotSize: ShotSize;
    readonly move: MotionMove;
    readonly durationSeconds: number;
    /** 环绕/螺旋路径参数;省略时使用默认值。 */
    readonly orbit?: OrbitMotionParametersInit;
    readonly easing?: EasingCurve;
    /** 非空即产出跟拍片段:关键帧落在主体跟随系里 */
    readonly follow?: QuickAuthorFollowRequest;
}

/** 快建运镜 id:由被摄体、语汇与起始时刻派生,确保 undo/redo 重放不漂移。 */
function quickMotionIdFor(subjectId: string, move: MotionMove, startTimeSeconds: number): string {
    return `motion-${subjectId}-${move}-${startTimeSeconds}`;
}

interface QuickAuthorPlan {
    readonly range: ProgramRangeLike;
    readonly take: CreateMotionTakeCommand;
    readonly extendDuration: SetTimelineDurationCommand | null;
}

/** 跟随系原点:跟拍态构图的主体中心恒在此处 */
const FOLLOW_FRAME_ORIGIN: Vec3 = [0, 0, 0];
const DEFAULT_FOLLOW_LAG_SECONDS = 0;
const DEFAULT_FOLLOW_SMOOTHING_SECONDS = 0;

interface QuickAuthorFraming {
    readonly shot: CameraShot;
    readonly subject: SubjectFocusBounds;
    readonly follow: CameraFollowTrackJSON | null;
}

/**
 * 快速成片(聚合命令,地基优先红线 15):被摄对象 + 景别 + 语汇 → 独立运镜片段一次落地。
 * 起幅机位仅作为编译期 pose 快照,不创建、不持久化为运镜依赖。
 */
export class QuickAuthorMotionCommand extends DirectorCommand<QuickAuthorPayload> {
    static readonly TYPE = "motion.quick-author";
    readonly type = QuickAuthorMotionCommand.TYPE;

    constructor(readonly payload: QuickAuthorPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const paramIssues = presetParamIssues(this.payload);
        if (paramIssues.length > 0) return paramIssues;
        if (!Object.values(SHOT_SIZE).includes(this.payload.shotSize)) {
            return [issue(ISSUE_CODE.PAYLOAD, "shotSize", "未知的景别")];
        }
        if (!Number.isFinite(this.payload.durationSeconds) || this.payload.durationSeconds <= 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "durationSeconds", "时长须为正有限数")];
        }
        if (!ctx.scene.manager.getEntity(this.payload.subjectId)) {
            return [issue(ISSUE_CODE.SUBJECT, "subjectId", "被摄对象不存在")];
        }
        if (this.payload.follow && !isFollowApproach(this.payload.follow.approach)) {
            return [issue(ISSUE_CODE.FOLLOW_FRAME, "follow.approach", "跟拍站位只能是 back/front/left/right")];
        }
        const plan = this.plan(ctx);
        if (!plan) return [issue(ISSUE_CODE.PAYLOAD, "keys", "预设编译失败")];
        return programIssues(ctx, plan.range, PROGRAM_FOLLOW.FOLLOW);
    }

    execute(ctx: DirectorContext): void {
        const plan = this.plan(ctx);
        if (!plan) return;
        plan.extendDuration?.execute(ctx);
        plan.take.execute(ctx);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const range = this.planIdentity(ctx);
        if (!range) return [];
        const end = range.startTimeSeconds + range.durationSeconds;
        const durationRestore: readonly SerializedCommand[] =
            end > ctx.timeline.document.duration
                ? [{ type: SetTimelineDurationCommand.TYPE, payload: { duration: ctx.timeline.document.duration } }]
                : [];
        return [
            { type: RemoveMotionClipCommand.TYPE, payload: { id: range.id } },
            ...invertProgramFollow(ctx, range, PROGRAM_FOLLOW.FOLLOW),
            ...durationRestore,
        ];
    }

    private planIdentity(ctx: DirectorContext): ProgramRangeLike | null {
        const range = quantizedTimeRange(ctx, programEndSeconds(ctx), this.payload.durationSeconds);
        return range
            ? {
                  id: quickMotionIdFor(this.payload.subjectId, this.payload.move, range.startTimeSeconds),
                  startTimeSeconds: range.startTimeSeconds,
                  durationSeconds: range.durationSeconds,
              }
            : null;
    }

    private plan(ctx: DirectorContext): QuickAuthorPlan | null {
        const subject = subjectBoundsFor(ctx, this.payload.subjectId);
        if (!subject) return null;
        const range = this.planIdentity(ctx);
        if (!range) return null;
        const framing = this.framingFor(ctx, subject);
        const request: MotionPresetRequest = {
            startTimeSeconds: range.startTimeSeconds,
            durationSeconds: range.durationSeconds,
            move: this.payload.move,
            subjectId: this.payload.subjectId,
            ...(this.payload.easing ? { easing: this.payload.easing } : {}),
            ...(this.payload.orbit ? { orbit: this.payload.orbit } : {}),
        };
        const end = range.startTimeSeconds + range.durationSeconds;
        return {
            range,
            take: takeCommandFor(request, framing.shot, framing.subject, range.id, framing.follow),
            extendDuration:
                end > ctx.timeline.document.duration ? new SetTimelineDurationCommand({ duration: end }) : null,
        };
    }

    /**
     * 取景基准。跟拍态在**跟随系**里构图:主体恒在原点,站位由方位枚举查表,
     * 于是现有 MOVE_RESOLVERS 原样复用即产出跟拍版关键帧(orbit=环绕跟拍、dolly-in=跟随推进)。
     * 非跟拍态沿用世界系包围球与当前相机方位。
     */
    private framingFor(ctx: DirectorContext, subject: SubjectFocusBounds): QuickAuthorFraming {
        const follow = this.payload.follow;
        if (!follow) {
            const eye = ctx.camera.lastDirectorPose;
            const azimuth = eye ? azimuthAroundCenter(eye.position, subject.center) : DEFAULT_SHOT_AZIMUTH_RADIANS;
            return {
                shot: shotSizePresets.resolve(this.payload.shotSize, subject.center, subject.radius, azimuth),
                subject,
                follow: null,
            };
        }
        return {
            shot: shotSizePresets.resolve(
                this.payload.shotSize,
                FOLLOW_FRAME_ORIGIN,
                subject.radius,
                FOLLOW_APPROACH_AZIMUTH[follow.approach],
            ),
            subject: { center: FOLLOW_FRAME_ORIGIN, radius: subject.radius, focusOffset: FOLLOW_FRAME_ORIGIN },
            follow: {
                objectId: this.payload.subjectId,
                anchorOffset: subject.focusOffset,
                frame: follow.frame ?? FOLLOW_FRAME.HEADING,
                lagSeconds: DEFAULT_FOLLOW_LAG_SECONDS,
                smoothingSeconds: DEFAULT_FOLLOW_SMOOTHING_SECONDS,
            },
        };
    }
}

/** Program 末尾时刻:快速创建在此追加编排;空 Program 从 0 开始 */
function programEndSeconds(ctx: DirectorContext): number {
    return ctx.motion.program.clips.reduce((end, clip) => Math.max(end, clip.endTimeSeconds), 0);
}

function programSourceIssues(ctx: DirectorContext, clip: CameraProgramClip): readonly CommandIssue[] {
    switch (clip.source.kind) {
        case PROGRAM_SOURCE_KIND.STATIC_SHOT:
            return ctx.camera.director.getShot(clip.source.shotId)
                ? []
                : [issue(ISSUE_CODE.CAMERA, "clip.source.shotId", "输出片段引用的机位不存在")];
        case PROGRAM_SOURCE_KIND.MOTION_CLIP: {
            const motion = ctx.motion.clip(clip.source.motionClipId);
            const isAligned =
                motion !== undefined &&
                motion.startTimeSeconds === clip.startTimeSeconds &&
                motion.durationSeconds === clip.durationSeconds;
            return isAligned
                ? []
                : [issue(ISSUE_CODE.CLIP, "clip.source.motionClipId", "输出片段必须与引用运镜的时间范围一致")];
        }
    }
}

/** Updates the sole Program output track. A program segment may reference a static or moving camera. */
export class SetProgramClipCommand extends DirectorCommand<SetProgramClipPayload> {
    static readonly TYPE = "program.set-clip";
    readonly type = SetProgramClipCommand.TYPE;

    constructor(readonly payload: SetProgramClipPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const parsed = programClipFrom(this.payload);
        const clip = parsed ? quantizedProgramClip(ctx, parsed) : null;
        if (!clip) return [issue(ISSUE_CODE.PAYLOAD, "clip", "输出片段时间范围至少覆盖一帧")];
        const sourceIssues = programSourceIssues(ctx, clip);
        if (sourceIssues.length > 0) return sourceIssues;
        if (clip.endTimeSeconds > ctx.timeline.document.duration) {
            return [issue(ISSUE_CODE.DURATION, "clip", "输出片段不能超出时间轴时长")];
        }
        try {
            ctx.motion.program.withClip(clip);
            return [];
        } catch {
            return [issue(ISSUE_CODE.PROGRAM_OVERLAP, "clip", "Program 输出片段不能重叠")];
        }
    }

    execute(ctx: DirectorContext): void {
        const parsed = programClipFrom(this.payload);
        const clip = parsed ? quantizedProgramClip(ctx, parsed) : null;
        if (clip) ctx.motion.replaceProgram(ctx.motion.program.withClip(clip));
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const prior = ctx.motion.program.clip(this.payload.clip.id);
        return prior
            ? [{ type: SetProgramClipCommand.TYPE, payload: { clip: prior.toJSON() } }]
            : [{ type: RemoveProgramClipCommand.TYPE, payload: { id: this.payload.clip.id } }];
    }
}

export class RemoveProgramClipCommand extends DirectorCommand<RemoveProgramClipPayload> {
    static readonly TYPE = "program.remove-clip";
    readonly type = RemoveProgramClipCommand.TYPE;

    constructor(readonly payload: RemoveProgramClipPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        return ctx.motion.program.clip(this.payload.id)
            ? []
            : [issue(ISSUE_CODE.PROGRAM_CLIP, "id", "Program 输出片段不存在")];
    }

    execute(ctx: DirectorContext): void {
        ctx.motion.replaceProgram(ctx.motion.program.withoutClip(this.payload.id));
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const current = ctx.motion.program.clip(this.payload.id);
        return current ? [{ type: SetProgramClipCommand.TYPE, payload: { clip: current.toJSON() } }] : null;
    }
}

/** 预览尚未切入 Program 的片段(瞬态视图态,不入撤销栈)。 */
export class EnterMotionPreviewCommand extends DirectorCommand<PreviewClipPayload> {
    static readonly TYPE = "motion.preview.enter";
    readonly type = EnterMotionPreviewCommand.TYPE;

    constructor(readonly payload: PreviewClipPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        return existingClip(ctx, this.payload.clipId) ? [] : [issue(ISSUE_CODE.CLIP, "clipId", "运镜片段不存在")];
    }

    execute(ctx: DirectorContext): void {
        const clip = ctx.motion.clip(this.payload.clipId);
        ctx.motionAuthoring.setPreviewClip(this.payload.clipId);
        ctx.motionAuthoring.setViewMode(VIEW_MODE.LENS);
        // 预览一段就该看到这一段:playhead 不在片段内时移到片段起点,否则画面停在别的机位上
        if (clip && !clip.covers(ctx.clock.time)) ctx.clock.seek(quantizeSeconds(ctx, clip.startTimeSeconds));
        ctx.playback.sampleCurrent();
    }
}

export class ExitMotionPreviewCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "motion.preview.exit";
    readonly type = ExitMotionPreviewCommand.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {
        super();
    }

    validate(): string[] {
        return [];
    }

    execute(ctx: DirectorContext): void {
        ctx.motionAuthoring.setPreviewClip(null);
        ctx.playback.sampleCurrent();
    }
}

/** 视口模式切换(瞬态):导演视角 ↔ 镜头视角,写入目标随之从「无」变为镜头关键帧。 */
export class SetViewModeCommand extends DirectorCommand<SetViewModePayload> {
    static readonly TYPE = "view.set-mode";
    readonly type = SetViewModeCommand.TYPE;

    constructor(readonly payload: SetViewModePayload) {
        super();
    }

    validate(): string[] {
        const isKnown = this.payload.mode === VIEW_MODE.DIRECTOR || this.payload.mode === VIEW_MODE.LENS;
        return isKnown ? [] : ["视口模式必须是 director 或 lens"];
    }

    execute(ctx: DirectorContext): void {
        ctx.motionAuthoring.setViewMode(this.payload.mode);
        ctx.playback.sampleCurrent();
    }
}

interface SetSweepPathVisiblePayload {
    readonly visible: boolean;
}

const SET_SWEEP_PATH_VISIBLE_CONTRACT: PayloadContract = {
    properties: { visible: { type: "boolean" } },
    required: ["visible"],
};

/** 跟拍世界扫掠路径显隐(瞬态):仅供排查世界结果,默认关闭。 */
export class SetSweepPathVisibleCommand extends DirectorCommand<SetSweepPathVisiblePayload> {
    static readonly TYPE = "view.set-sweep-path";
    readonly type = SetSweepPathVisibleCommand.TYPE;

    constructor(readonly payload: SetSweepPathVisiblePayload) {
        super();
    }

    validate(): string[] {
        return typeof this.payload.visible === "boolean" ? [] : ["扫掠路径显隐必须是 boolean"];
    }

    execute(ctx: DirectorContext): void {
        ctx.motionAuthoring.setSweepPathVisible(this.payload.visible);
    }
}

/** Read-only AI discovery and inspection endpoint. No Three references cross this boundary. */
export class CameraMotionGetQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "motion.get";
    readonly type = CameraMotionGetQuery.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {}

    validate(): readonly string[] {
        return Object.keys(this.payload).length === 0 ? [] : ["motion.get payload 必须是空对象"];
    }

    execute(ctx: DirectorContext): unknown {
        return {
            clips: ctx.motion.clips.map((clip) => clip.toJSON()),
            program: ctx.motion.program.toJSON(),
            activeProgramSource: ctx.motion.program.sourceAt(ctx.clock.time),
            timelineDurationSeconds: ctx.timeline.document.duration,
            viewMode: ctx.motionAuthoring.viewMode,
            previewClipId: ctx.motionAuthoring.previewClipId,
            handleModes: Object.values(MOTION_HANDLE_MODE),
        };
    }
}

function capability(
    type: string,
    kind: "command" | "query",
    permissions: readonly string[],
    payload: PayloadContract,
): CommandCapability {
    return { type, version: MOTION_COMMAND_VERSION, kind, permissions, appliesWhen: MOTION_APPLIES_WHEN, payload };
}

/** Motion and Program commands share one discovery namespace while retaining independent write permissions. */
export function registerCameraMotionCommands(dispatcher: CommandDispatcher): void {
    const commands = [
        CreateMotionClipCommand,
        CreateMotionTakeCommand,
        QuickAuthorMotionCommand,
        SetMotionClipRangeCommand,
        SetMotionKeyCommand,
        MoveMotionKeyCommand,
        RemoveMotionKeyCommand,
        SetMotionKeyHandleCommand,
        ResetMotionKeyHandlesCommand,
        SetMotionClipEasingCommand,
        SetMotionClipFocusCommand,
        ReplaceMotionClipCommand,
        BindMotionClipFollowCommand,
        UnbindMotionClipFollowCommand,
        SetMotionClipFollowParamsCommand,
        RemoveMotionClipCommand,
        AuthorMotionCommand,
        SetProgramClipCommand,
        RemoveProgramClipCommand,
        EnterMotionPreviewCommand,
        ExitMotionPreviewCommand,
        SetViewModeCommand,
        SetSweepPathVisibleCommand,
    ] as const;
    type CameraMotionCommandType = (typeof commands)[number]["TYPE"];
    const contracts: Record<CameraMotionCommandType, PayloadContract> = {
        [CreateMotionClipCommand.TYPE]: CREATE_MOTION_CLIP_CONTRACT,
        [CreateMotionTakeCommand.TYPE]: CREATE_MOTION_TAKE_CONTRACT,
        [QuickAuthorMotionCommand.TYPE]: QUICK_AUTHOR_MOTION_CONTRACT,
        [SetMotionClipRangeCommand.TYPE]: SET_MOTION_CLIP_RANGE_CONTRACT,
        [SetMotionKeyCommand.TYPE]: SET_MOTION_KEY_CONTRACT,
        [MoveMotionKeyCommand.TYPE]: MOVE_MOTION_KEY_CONTRACT,
        [RemoveMotionKeyCommand.TYPE]: REMOVE_MOTION_KEY_CONTRACT,
        [SetMotionKeyHandleCommand.TYPE]: SET_MOTION_KEY_HANDLE_CONTRACT,
        [ResetMotionKeyHandlesCommand.TYPE]: RESET_MOTION_KEY_HANDLES_CONTRACT,
        [SetMotionClipEasingCommand.TYPE]: SET_MOTION_CLIP_EASING_CONTRACT,
        [SetMotionClipFocusCommand.TYPE]: SET_MOTION_CLIP_FOCUS_CONTRACT,
        [ReplaceMotionClipCommand.TYPE]: REPLACE_MOTION_CLIP_CONTRACT,
        [BindMotionClipFollowCommand.TYPE]: MOTION_FOLLOW_CONTRACT,
        [UnbindMotionClipFollowCommand.TYPE]: UNBIND_MOTION_FOLLOW_CONTRACT,
        [SetMotionClipFollowParamsCommand.TYPE]: MOTION_FOLLOW_CONTRACT,
        [RemoveMotionClipCommand.TYPE]: REMOVE_MOTION_CLIP_CONTRACT,
        [AuthorMotionCommand.TYPE]: AUTHOR_MOTION_CONTRACT,
        [SetProgramClipCommand.TYPE]: SET_PROGRAM_CLIP_CONTRACT,
        [RemoveProgramClipCommand.TYPE]: REMOVE_PROGRAM_CLIP_CONTRACT,
        [EnterMotionPreviewCommand.TYPE]: ENTER_MOTION_PREVIEW_CONTRACT,
        [ExitMotionPreviewCommand.TYPE]: EXIT_MOTION_PREVIEW_CONTRACT,
        [SetViewModeCommand.TYPE]: SET_VIEW_MODE_CONTRACT,
        [SetSweepPathVisibleCommand.TYPE]: SET_SWEEP_PATH_VISIBLE_CONTRACT,
    };
    for (const Command of commands) {
        dispatcher.register(
            Command.TYPE,
            (payload) => new Command(payload as never),
            capability(Command.TYPE, "command", [MOTION_PERMISSION], contracts[Command.TYPE]),
        );
    }
    dispatcher.registerQuery(
        CameraMotionGetQuery.TYPE,
        (payload: Record<string, never>) => new CameraMotionGetQuery(payload),
        capability(CameraMotionGetQuery.TYPE, "query", [MOTION_READ_PERMISSION], CAMERA_MOTION_GET_CONTRACT),
    );
}
