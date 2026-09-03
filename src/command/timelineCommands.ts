import { TimelineContentSpan } from "@/authoring/TimelineContentSpan";
import { TimelineSelection } from "@/authoring/TimelineSelection";
import { CameraMotionClip } from "@/camera/CameraMotionClip";
import type { CameraMotionClipJSON } from "@/camera/CameraMotionClip";
import { CameraProgramTrack } from "@/camera/CameraProgramTrack";
import type { CameraProgramTrackJSON } from "@/camera/CameraProgramTrack";
import { createId } from "@/core/createId";
import { finiteTransform, finiteVec3 } from "@/core/SceneObject";
import { EASING, isEasingCurve } from "@/motion/EasingCurve";
import type { EasingCurve } from "@/motion/EasingCurve";
import { MOTION_HANDLE_MODE } from "@/motion/MotionKey";
import { isFrameRateFps } from "@/timeline/FrameRate";
import { TimelineDoc } from "@/timeline/TimelineDoc";
import type { TimelineDocJSON } from "@/timeline/TimelineDoc";
import { TimelineMarker } from "@/timeline/TimelineMarker";
import { TimelineTrack, TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";
import type { TimelineTrackInit } from "@/timeline/TimelineTrack";
import {
    GROUNDING_MODE,
    LOCOMOTION_MODE,
    ORIENTATION_MODE,
    isGroundingMode,
    isLocomotionMode,
    isOrientationMode,
    isStrideMeters,
} from "@/timeline/TrackPolicies";
import type { TrackPoliciesInit } from "@/timeline/TrackPolicies";
import { TransformKeyframe } from "@/timeline/TransformKeyframe";
import type { TransformKeyframeInit } from "@/timeline/TransformKeyframe";
import type { CommandCapability, DirectorQuery } from "@/command/CommandDispatcher";
import type { CommandDispatcher } from "@/command/CommandDispatcher";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import {
    EMPTY_PAYLOAD_CONTRACT,
    TRANSFORM_SCHEMA,
    VEC3_SCHEMA,
    type PayloadContract,
    type PayloadFieldSchema,
} from "@/command/PayloadContract";

const TIMELINE_COMMAND_VERSION = "1" as const;
const TIMELINE_PERMISSION = "timeline:edit";
const TIMELINE_READ_PERMISSION = "timeline:read";
const EMPTY_PAYLOAD: Record<string, never> = {};
const FIRST_KEYFRAME_INDEX = 0;
const MINIMUM_RETIME_KEYFRAMES = 2;
const LAST_KEYFRAME_INDEX_OFFSET = 1;
const TIMELINE_START_SECONDS = 0;

const ISSUE_CODE = {
    PAYLOAD: "timeline.invalid-payload",
    TARGET: "timeline.target-not-found",
    TRACK: "timeline.track-not-found",
    TRACK_CONFLICT: "timeline.track-conflict",
    KEY: "timeline.key-not-found",
    DUPLICATE_TIME: "timeline.duplicate-time",
    DURATION: "timeline.invalid-duration",
} as const;

interface AddKeyPayload {
    readonly trackId: string;
    readonly targetId: string;
    readonly keyframe: TransformKeyframeInit;
}

interface MoveKeyPayload {
    readonly trackId: string;
    readonly keyframeId: string;
    readonly time: number;
}

interface RemoveKeyPayload {
    readonly trackId: string;
    readonly keyframeId: string;
}

interface SetEasingPayload {
    readonly trackId: string;
    readonly keyframeId: string;
    readonly easing: EasingCurve;
}

interface SetDurationPayload {
    readonly duration: number;
}
interface ScaleTimelinePayload {
    readonly factor: number;
}

interface SetPlaybackRangePayload {
    readonly inSeconds: number;
    readonly outSeconds: number;
}

interface TimelineScaleSnapshot {
    readonly document: TimelineDocJSON;
    readonly motionClips: readonly CameraMotionClipJSON[];
    readonly program: CameraProgramTrackJSON;
}

interface RestoreTimelineScalePayload {
    readonly snapshot: TimelineScaleSnapshot;
}

interface SetFrameRatePayload {
    readonly fps: number;
}
interface RestoreTracksPayload {
    readonly tracks: readonly TimelineTrackInit[];
}

interface SetKeyPayload {
    readonly trackId: string;
    readonly keyframe: TransformKeyframeInit;
}

interface SetPoliciesPayload {
    readonly trackId: string;
    readonly policies: TrackPoliciesInit;
}

interface SetTrackPayload {
    readonly trackId: string;
    readonly targetId: string;
    /** 该对象走位轨的目标完整状态;空数组 = 清空走位 */
    readonly keyframes: readonly TransformKeyframeInit[];
    /** 缺省 = 沿用该对象既有策略(重画不重置作者调好的朝向/贴地/步幅) */
    readonly policies?: TrackPoliciesInit;
}
interface RetimeTrackPayload {
    readonly trackId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
}

/** 关键帧形状:单帧写入与整轨替换共用一份(Rule of Two),字段增减不会两处分叉。 */
const KEYFRAME_SCHEMA: PayloadFieldSchema = {
    type: "object",
    properties: {
        id: { type: "string" },
        time: { type: "number" },
        value: TRANSFORM_SCHEMA,
        easing: { type: "string", enum: Object.values(EASING) },
        inHandle: VEC3_SCHEMA,
        outHandle: VEC3_SCHEMA,
        handleMode: { type: "string", enum: Object.values(MOTION_HANDLE_MODE) },
    },
    required: ["id", "time", "value", "easing"],
};

const AddTimelineKeyContract: PayloadContract = {
    properties: {
        trackId: { type: "string" },
        targetId: { type: "string" },
        keyframe: KEYFRAME_SCHEMA,
    },
    required: ["trackId", "targetId", "keyframe"],
};

const POLICIES_SCHEMA: PayloadFieldSchema = {
    type: "object",
    properties: {
        orientation: { type: "string", enum: Object.values(ORIENTATION_MODE) },
        grounding: { type: "string", enum: Object.values(GROUNDING_MODE) },
        locomotion: { type: "string", enum: Object.values(LOCOMOTION_MODE) },
        strideMeters: { type: "number" },
    },
};

const SetTimelineTrackContract: PayloadContract = {
    properties: {
        trackId: { type: "string" },
        targetId: { type: "string" },
        keyframes: { type: "array", items: KEYFRAME_SCHEMA },
        // SetTrackPayload 一直支持策略入参,契约漏声明会把合法调用挡在门外(未知字段即拒)
        policies: POLICIES_SCHEMA,
    },
    required: ["trackId", "targetId", "keyframes"],
};
const RetimeTimelineTrackContract: PayloadContract = {
    properties: {
        trackId: { type: "string" },
        startTimeSeconds: { type: "number" },
        durationSeconds: { type: "number" },
    },
    required: ["trackId", "startTimeSeconds", "durationSeconds"],
};

const SetTimelineKeyContract: PayloadContract = {
    properties: { trackId: { type: "string" }, keyframe: KEYFRAME_SCHEMA },
    required: ["trackId", "keyframe"],
};

const SetTimelineTrackPoliciesContract: PayloadContract = {
    properties: { trackId: { type: "string" }, policies: POLICIES_SCHEMA },
    required: ["trackId", "policies"],
};

const MoveTimelineKeyContract: PayloadContract = {
    properties: {
        trackId: { type: "string" },
        keyframeId: { type: "string" },
        time: { type: "number" },
    },
    required: ["trackId", "keyframeId", "time"],
};

const RemoveTimelineKeyContract: PayloadContract = {
    properties: {
        trackId: { type: "string" },
        keyframeId: { type: "string" },
    },
    required: ["trackId", "keyframeId"],
};

const SetTimelineKeyEasingContract: PayloadContract = {
    properties: {
        trackId: { type: "string" },
        keyframeId: { type: "string" },
        easing: { type: "string", enum: Object.values(EASING) },
    },
    required: ["trackId", "keyframeId", "easing"],
};

const SetTimelineDurationContract: PayloadContract = {
    properties: { duration: { type: "number" } },
    required: ["duration"],
};

const FitTimelineDurationContract: PayloadContract = EMPTY_PAYLOAD_CONTRACT;

const ScaleTimelineContract: PayloadContract = {
    properties: { factor: { type: "number" } },
    required: ["factor"],
};

const SetPlaybackRangeContract: PayloadContract = {
    properties: {
        inSeconds: { type: "number" },
        outSeconds: { type: "number" },
    },
    required: ["inSeconds", "outSeconds"],
};

const RestoreTimelineScaleContract: PayloadContract = {
    properties: { snapshot: { type: "object" } },
    required: ["snapshot"],
};

const SetTimelineFrameRateContract: PayloadContract = {
    properties: { fps: { type: "number" } },
    required: ["fps"],
};

const RestoreTimelineTracksContract: PayloadContract = {
    properties: { tracks: { type: "array", items: { type: "object" } } },
    required: ["tracks"],
};

function issue(code: string, path: string, message: string): CommandIssue {
    return { code, path, message };
}

/** 文档时间唯一栅格入口:写命令共享，防止相邻命令各自定义舍入规则。 */
export function quantizeSeconds(ctx: DirectorContext, seconds: number): number {
    return ctx.timeline.document.frameRate.quantize(seconds);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 空间幻觉围栏:手柄可缺省(auto),但一旦给了就必须是有限三元组。 */
function isOptionalHandle(value: unknown): boolean {
    return value === undefined || finiteVec3(value);
}

/** 策略字段全部可缺省(缺省 = 不改该项),给了就必须是登记过的模式或合法步幅。 */
function policiesIssues(value: Record<string, unknown>): readonly CommandIssue[] {
    const checks: readonly (readonly [string, boolean, string])[] = [
        ["orientation", value.orientation === undefined || isOrientationMode(value.orientation), "朝向策略无效"],
        ["grounding", value.grounding === undefined || isGroundingMode(value.grounding), "贴地策略无效"],
        ["locomotion", value.locomotion === undefined || isLocomotionMode(value.locomotion), "步频策略无效"],
        ["strideMeters", value.strideMeters === undefined || isStrideMeters(value.strideMeters), "步幅必须是正数米"],
    ];
    const failed = checks.find(([, valid]) => !valid);
    return failed ? [issue(ISSUE_CODE.PAYLOAD, `policies.${failed[0]}`, failed[2])] : [];
}

function keyframePayloadIssue(value: unknown): CommandIssue | null {
    if (!isRecord(value)) return issue(ISSUE_CODE.PAYLOAD, "keyframe", "关键帧参数格式无效");
    if (typeof value.id !== "string" || value.id.length === 0) {
        return issue(ISSUE_CODE.PAYLOAD, "keyframe.id", "关键帧 id 格式无效");
    }
    if (typeof value.time !== "number" || !Number.isFinite(value.time) || value.time < 0) {
        return issue(ISSUE_CODE.PAYLOAD, "keyframe.time", "关键帧时间必须是非负有限秒数");
    }
    if (!finiteTransform(value.value)) {
        return issue(ISSUE_CODE.PAYLOAD, "keyframe.value", "关键帧变换含非法数值");
    }
    if (!isOptionalHandle(value.inHandle) || !isOptionalHandle(value.outHandle)) {
        return issue(ISSUE_CODE.PAYLOAD, "keyframe.inHandle", "关键帧切线手柄含非法数值");
    }
    return isEasingCurve(value.easing)
        ? null
        : issue(ISSUE_CODE.PAYLOAD, "keyframe.easing", "关键帧缓动必须为 linear 或 smooth");
}

function quantizedKeyframe(ctx: DirectorContext, keyframe: TransformKeyframeInit): TransformKeyframeInit {
    return { ...keyframe, time: quantizeSeconds(ctx, keyframe.time) };
}

/** 超出时间轴时长的第一枚关键帧;整轨替换会自动扩长时间轴,故由调用方决定用不用这条。 */
function durationOverflowIssue(keyframes: readonly unknown[], ctx: DirectorContext, path: string): CommandIssue | null {
    const index = keyframes.findIndex(
        (keyframe) =>
            isRecord(keyframe) &&
            typeof keyframe.time === "number" &&
            quantizeSeconds(ctx, keyframe.time) > ctx.timeline.document.duration,
    );
    return index >= 0 ? issue(ISSUE_CODE.DURATION, `${path}.${index}.time`, "关键帧时间超过时间轴时长") : null;
}

/**
 * 关键帧列表的通用校验:逐帧参数与 id/时间唯一。
 * 整轨替换与轨道恢复共用一份——两处曾各写一遍,任何一条规则改动都要改两处。
 * 时长边界不在此处:它对「恢复」是硬约束,对「绘制」则应触发自动扩长,语义不同。
 */
function keyframeListIssues(
    keyframes: readonly unknown[],
    ctx: DirectorContext,
    path = "keyframes",
): readonly CommandIssue[] {
    const invalidIndex = keyframes.findIndex((keyframe) => keyframePayloadIssue(keyframe) !== null);
    if (invalidIndex >= 0) return [issue(ISSUE_CODE.PAYLOAD, `${path}.${invalidIndex}`, "关键帧参数无效")];
    const duplicate = keyframes.some(
        (keyframe, index) =>
            isRecord(keyframe) &&
            keyframes.some(
                (candidate, candidateIndex) =>
                    candidateIndex !== index &&
                    isRecord(candidate) &&
                    (candidate.id === keyframe.id ||
                        (typeof candidate.time === "number" &&
                            typeof keyframe.time === "number" &&
                            quantizeSeconds(ctx, candidate.time) === quantizeSeconds(ctx, keyframe.time))),
            ),
    );
    return duplicate ? [issue(ISSUE_CODE.DUPLICATE_TIME, path, "关键帧 id 或时间重复")] : [];
}

function restoreTrackIssue(
    value: unknown,
    index: number,
    tracks: readonly unknown[],
    ctx: DirectorContext,
): CommandIssue | null {
    const path = `tracks.${index}`;
    if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
        return issue(ISSUE_CODE.PAYLOAD, `${path}.id`, "恢复轨道 id 格式无效");
    }
    if (typeof value.targetId !== "string" || value.targetId.length === 0) {
        return issue(ISSUE_CODE.PAYLOAD, `${path}.targetId`, "恢复轨道目标 id 格式无效");
    }
    const kind = value.kind;
    if (kind !== TIMELINE_TRACK_KIND.TRANSFORM) {
        return issue(ISSUE_CODE.PAYLOAD, `${path}.kind`, "恢复轨道类型无效");
    }
    if (!Array.isArray(value.keyframes) || value.keyframes.length === 0) {
        return issue(ISSUE_CODE.PAYLOAD, `${path}.keyframes`, "恢复轨道必须包含关键帧");
    }
    const keyframes: readonly unknown[] = value.keyframes;
    if (!ctx.scene.manager.getEntity(value.targetId)) {
        return issue(ISSUE_CODE.TARGET, `${path}.targetId`, "恢复轨道目标不存在");
    }
    if (ctx.timeline.document.track(value.id) || ctx.timeline.document.trackForTarget(value.targetId, kind)) {
        return issue(ISSUE_CODE.TRACK_CONFLICT, path, "恢复轨道与当前文档冲突");
    }
    const duplicateTrack = tracks.some(
        (candidate, candidateIndex) =>
            candidateIndex !== index &&
            isRecord(candidate) &&
            (candidate.id === value.id || (candidate.targetId === value.targetId && candidate.kind === kind)),
    );
    if (duplicateTrack) return issue(ISSUE_CODE.TRACK_CONFLICT, path, "恢复轨道 id 或同类型目标重复");
    const overflow = durationOverflowIssue(keyframes, ctx, `${path}.keyframes`);
    if (overflow) return overflow;
    const listIssues = keyframeListIssues(keyframes, ctx, `${path}.keyframes`);
    return listIssues[0] ?? null;
}

function duplicateTimeIssue(
    track: TimelineTrack,
    time: number,
    excludedKeyId: string | null,
    ctx: DirectorContext,
): CommandIssue | null {
    const quantizedTime = quantizeSeconds(ctx, time);
    const duplicate = track.keyframes.find(
        (keyframe) => keyframe.id !== excludedKeyId && keyframe.time === quantizedTime,
    );
    return duplicate ? issue(ISSUE_CODE.DUPLICATE_TIME, "keyframe.time", "同一轨道不能有重复时间的关键帧") : null;
}

/** 关键帧序列的末帧时刻:整轨替换据此判断要不要把时间轴撑长。 */
function lastKeyframeTime(keyframes: readonly TransformKeyframeInit[]): number {
    return keyframes.reduce((latest, keyframe) => Math.max(latest, keyframe.time), 0);
}

function issueMessages(issues: readonly CommandIssue[]): string[] {
    return issues.map((current) => current.message);
}

/** 新建变换关键帧；首次写入时同时创建该对象的唯一 transform 轨道。 */
export class AddTimelineKeyCommand extends DirectorCommand<AddKeyPayload> {
    static readonly TYPE = "timeline.add-key";
    readonly type = AddTimelineKeyCommand.TYPE;

    constructor(readonly payload: AddKeyPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const payload = this.payload;
        if (!isRecord(payload) || typeof payload.trackId !== "string" || payload.trackId.length === 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "trackId", "轨道 id 格式无效")];
        }
        if (typeof payload.targetId !== "string" || payload.targetId.length === 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "targetId", "目标对象 id 格式无效")];
        }
        const keyIssue = keyframePayloadIssue(payload.keyframe);
        if (keyIssue) return [keyIssue];
        const keyframeTime = quantizeSeconds(ctx, payload.keyframe.time);
        const durationIssue =
            keyframeTime > ctx.timeline.document.duration
                ? issue(ISSUE_CODE.DURATION, "keyframe.time", "关键帧时间不能超过时间轴时长")
                : null;
        if (durationIssue) return [durationIssue];
        if (!ctx.scene.manager.getEntity(payload.targetId)) {
            return [issue(ISSUE_CODE.TARGET, "targetId", "关键帧目标对象不存在")];
        }
        const track = ctx.timeline.document.track(payload.trackId);
        if (track) {
            if (track.targetId !== payload.targetId) {
                return [issue(ISSUE_CODE.TRACK_CONFLICT, "targetId", "轨道已属于另一个对象")];
            }
            if (track.kind !== TIMELINE_TRACK_KIND.TRANSFORM) {
                return [issue(ISSUE_CODE.TRACK_CONFLICT, "trackId", "轨道类型不是 transform")];
            }
            const duplicate = duplicateTimeIssue(track, payload.keyframe.time, null, ctx);
            if (duplicate) return [duplicate];
            if (track.keyframe(payload.keyframe.id)) {
                return [issue(ISSUE_CODE.PAYLOAD, "keyframe.id", "关键帧 id 已存在")];
            }
            return [];
        }
        const targetTrack = ctx.timeline.document.trackForTarget(payload.targetId, TIMELINE_TRACK_KIND.TRANSFORM);
        return targetTrack ? [issue(ISSUE_CODE.TRACK_CONFLICT, "trackId", "每个对象只能有一个 transform 轨道")] : [];
    }

    execute(ctx: DirectorContext): void {
        ctx.timeline.addKey(
            this.payload.trackId,
            this.payload.targetId,
            new TransformKeyframe(quantizedKeyframe(ctx, this.payload.keyframe)),
        );
        ctx.playback.sampleCurrent();
    }

    override invert(): readonly SerializedCommand[] {
        return [
            {
                type: RemoveTimelineKeyCommand.TYPE,
                payload: { trackId: this.payload.trackId, keyframeId: this.payload.keyframe.id },
            },
        ];
    }
}

/** 拖动结束时提交一条绝对秒定位命令，拖拽过程不污染 MobX/历史。 */
export class MoveTimelineKeyCommand extends DirectorCommand<MoveKeyPayload> {
    static readonly TYPE = "timeline.move-key";
    readonly type = MoveTimelineKeyCommand.TYPE;

    constructor(readonly payload: MoveKeyPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const payload = this.payload;
        if (!isRecord(payload) || typeof payload.trackId !== "string" || payload.trackId.length === 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "trackId", "轨道 id 格式无效")];
        }
        if (typeof payload.keyframeId !== "string" || payload.keyframeId.length === 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "keyframeId", "关键帧 id 格式无效")];
        }
        if (!Number.isFinite(payload.time) || payload.time < 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "time", "关键帧时间必须是非负有限秒数")];
        }
        if (quantizeSeconds(ctx, payload.time) > ctx.timeline.document.duration) {
            return [issue(ISSUE_CODE.DURATION, "time", "关键帧时间不能超过时间轴时长")];
        }
        const track = ctx.timeline.document.track(payload.trackId);
        if (!track) return [issue(ISSUE_CODE.TRACK, "trackId", "轨道不存在")];
        if (track.kind !== TIMELINE_TRACK_KIND.TRANSFORM)
            return [issue(ISSUE_CODE.TRACK, "trackId", "轨道类型不是 transform")];
        if (!track.keyframe(payload.keyframeId)) return [issue(ISSUE_CODE.KEY, "keyframeId", "关键帧不存在")];
        const duplicate = duplicateTimeIssue(track, payload.time, payload.keyframeId, ctx);
        return duplicate ? [duplicate] : [];
    }

    execute(ctx: DirectorContext): void {
        const keyframe = ctx.timeline.document.track(this.payload.trackId)?.keyframe(this.payload.keyframeId);
        if (!keyframe) return;
        ctx.timeline.moveKey(
            this.payload.trackId,
            new TransformKeyframe({
                ...(keyframe as TransformKeyframe).toJSON(),
                time: quantizeSeconds(ctx, this.payload.time),
            }),
        );
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const keyframe = ctx.timeline.document.track(this.payload.trackId)?.keyframe(this.payload.keyframeId);
        return keyframe
            ? [{ type: MoveTimelineKeyCommand.TYPE, payload: { ...this.payload, time: keyframe.time } }]
            : null;
    }
}

export class RemoveTimelineKeyCommand extends DirectorCommand<RemoveKeyPayload> {
    static readonly TYPE = "timeline.remove-key";
    readonly type = RemoveTimelineKeyCommand.TYPE;

    constructor(readonly payload: RemoveKeyPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const payload = this.payload;
        if (!isRecord(payload) || typeof payload.trackId !== "string" || payload.trackId.length === 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "trackId", "轨道 id 格式无效")];
        }
        if (typeof payload.keyframeId !== "string" || payload.keyframeId.length === 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "keyframeId", "关键帧 id 格式无效")];
        }
        const track = ctx.timeline.document.track(payload.trackId);
        if (!track) return [issue(ISSUE_CODE.TRACK, "trackId", "轨道不存在")];
        if (track.kind !== TIMELINE_TRACK_KIND.TRANSFORM)
            return [issue(ISSUE_CODE.TRACK, "trackId", "轨道类型不是 transform")];
        return track.keyframe(payload.keyframeId) ? [] : [issue(ISSUE_CODE.KEY, "keyframeId", "关键帧不存在")];
    }

    execute(ctx: DirectorContext): void {
        const targetId = ctx.timeline.document.track(this.payload.trackId)?.targetId;
        ctx.timeline.removeKey(this.payload.trackId, this.payload.keyframeId);
        ctx.timelineSelection.forget(this.payload.keyframeId);
        if (targetId) ctx.playback.restoreObject(targetId);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const track = ctx.timeline.document.track(this.payload.trackId);
        const keyframe = track?.keyframe(this.payload.keyframeId);
        return track && keyframe
            ? [
                  {
                      type: AddTimelineKeyCommand.TYPE,
                      payload: { trackId: track.id, targetId: track.targetId, keyframe: keyframe.toJSON() },
                  },
              ]
            : null;
    }
}

export class SetTimelineKeyEasingCommand extends DirectorCommand<SetEasingPayload> {
    static readonly TYPE = "timeline.set-key-easing";
    readonly type = SetTimelineKeyEasingCommand.TYPE;

    constructor(readonly payload: SetEasingPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const payload = this.payload;
        if (!isRecord(payload) || typeof payload.trackId !== "string" || payload.trackId.length === 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "trackId", "轨道 id 格式无效")];
        }
        if (typeof payload.keyframeId !== "string" || payload.keyframeId.length === 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "keyframeId", "关键帧 id 格式无效")];
        }
        if (!isEasingCurve(payload.easing)) {
            return [issue(ISSUE_CODE.PAYLOAD, "easing", "关键帧缓动必须为 linear 或 smooth")];
        }
        const track = ctx.timeline.document.track(payload.trackId);
        if (!track) return [issue(ISSUE_CODE.TRACK, "trackId", "轨道不存在")];
        if (track.kind !== TIMELINE_TRACK_KIND.TRANSFORM)
            return [issue(ISSUE_CODE.TRACK, "trackId", "轨道类型不是 transform")];
        const keyframe = track.keyframe(payload.keyframeId);
        if (!keyframe) return [issue(ISSUE_CODE.KEY, "keyframeId", "关键帧不存在")];
        const duplicate = duplicateTimeIssue(track, keyframe.time, keyframe.id, ctx);
        return duplicate ? [duplicate] : [];
    }

    execute(ctx: DirectorContext): void {
        const keyframe = ctx.timeline.document.track(this.payload.trackId)?.keyframe(this.payload.keyframeId);
        if (!keyframe) return;
        ctx.timeline.moveKey(
            this.payload.trackId,
            new TransformKeyframe({
                ...(keyframe as TransformKeyframe).toJSON(),
                time: quantizeSeconds(ctx, keyframe.time),
                easing: this.payload.easing,
            }),
        );
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const keyframe = ctx.timeline.document.track(this.payload.trackId)?.keyframe(this.payload.keyframeId);
        return keyframe
            ? [{ type: SetTimelineKeyEasingCommand.TYPE, payload: { ...this.payload, easing: keyframe.easing } }]
            : null;
    }
}

export class SetTimelineDurationCommand extends DirectorCommand<SetDurationPayload> {
    static readonly TYPE = "timeline.set-duration";
    readonly type = SetTimelineDurationCommand.TYPE;

    constructor(readonly payload: SetDurationPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (!isRecord(this.payload) || !Number.isFinite(this.payload.duration) || this.payload.duration <= 0) {
            return [issue(ISSUE_CODE.DURATION, "duration", "时间轴时长必须是大于零的有限秒数")];
        }
        const duration = quantizeSeconds(ctx, this.payload.duration);
        if (duration <= TIMELINE_START_SECONDS) {
            return [issue(ISSUE_CODE.DURATION, "duration", "时间轴时长必须至少覆盖一帧")];
        }
        const content = TimelineContentSpan.fromDocument(ctx.timeline, ctx.motion);
        const blocker = content.blockers[0];
        return duration < content.endSeconds && blocker
            ? [
                  {
                      code: ISSUE_CODE.DURATION,
                      path: "duration",
                      message: `时间轴最短可用时长为 ${content.endSeconds.toFixed(1)} 秒，受 ${blocker.label} 限制`,
                      options: [
                          { type: FitTimelineDurationCommand.TYPE, label: "贴合内容" },
                          { type: ScaleTimelineCommand.TYPE, label: "整轴缩放" },
                      ],
                  },
              ]
            : [];
    }

    execute(ctx: DirectorContext): void {
        ctx.timeline.setDuration(quantizeSeconds(ctx, this.payload.duration));
        ctx.clock.seek(ctx.clock.time);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetTimelineDurationCommand.TYPE, payload: { duration: ctx.timeline.document.duration } }];
    }
}

function fittedDuration(ctx: DirectorContext): number {
    const contentEnd = TimelineContentSpan.fromDocument(ctx.timeline, ctx.motion).endSeconds;
    return Math.max(quantizeSeconds(ctx, contentEnd), ctx.timeline.document.frameRate.frameDurationSeconds);
}

export class FitTimelineDurationCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "timeline.fit-duration";
    readonly type = FitTimelineDurationCommand.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {
        super();
    }

    validate(): string[] {
        return [];
    }

    execute(ctx: DirectorContext): void {
        ctx.timeline.setDuration(fittedDuration(ctx));
        ctx.clock.seek(ctx.clock.time);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetTimelineDurationCommand.TYPE, payload: { duration: ctx.timeline.document.duration } }];
    }
}

function snapshotFor(ctx: DirectorContext): TimelineScaleSnapshot {
    return {
        document: ctx.timeline.document.toJSON(),
        motionClips: ctx.motion.clips.map((clip) => clip.toJSON()),
        program: ctx.motion.program.toJSON(),
    };
}

function scaledRange(
    ctx: DirectorContext,
    startSeconds: number,
    durationSeconds: number,
    factor: number,
): {
    readonly startSeconds: number;
    readonly durationSeconds: number;
} {
    const start = quantizeSeconds(ctx, startSeconds * factor);
    const end = quantizeSeconds(ctx, (startSeconds + durationSeconds) * factor);
    if (end <= start) throw new Error("scaled time range must cover a frame");
    return { startSeconds: start, durationSeconds: end - start };
}

function scaledDocument(ctx: DirectorContext, factor: number): TimelineDoc {
    const document = ctx.timeline.document;
    const duration = quantizeSeconds(ctx, document.duration * factor);
    if (duration <= TIMELINE_START_SECONDS) throw new Error("scaled duration must cover a frame");
    const playbackRange = scaledRange(
        ctx,
        document.playbackRange.inSeconds,
        document.playbackRange.spanSeconds,
        factor,
    );
    return new TimelineDoc({
        duration,
        frameRate: document.frameRate.fps,
        tracks: document.tracks.map((track) => {
            const keyframes = track.keyframes.map(
                (keyframe) =>
                    new TransformKeyframe({
                        ...keyframe.toJSON(),
                        time: quantizeSeconds(ctx, keyframe.time * factor),
                    }),
            );
            if (new Set(keyframes.map((keyframe) => keyframe.time)).size !== keyframes.length) {
                throw new Error("scaled keyframes must stay on distinct frames");
            }
            return new TimelineTrack({
                id: track.id,
                targetId: track.targetId,
                kind: track.kind,
                policies: track.policies,
                keyframes,
            });
        }),
        playbackRange: {
            inSeconds: playbackRange.startSeconds,
            outSeconds: playbackRange.startSeconds + playbackRange.durationSeconds,
        },
        markers: document.markers.map(
            (marker) =>
                new TimelineMarker({
                    ...marker.toJSON(),
                    timeSeconds: quantizeSeconds(ctx, marker.timeSeconds * factor),
                }),
        ),
    });
}

function scaledMotionClips(ctx: DirectorContext, factor: number): readonly CameraMotionClip[] {
    return ctx.motion.clips.map((clip) => {
        const range = scaledRange(ctx, clip.startTimeSeconds, clip.durationSeconds, factor);
        return new CameraMotionClip({
            ...clip.toJSON(),
            startTimeSeconds: range.startSeconds,
            durationSeconds: range.durationSeconds,
        });
    });
}

function scaledProgram(ctx: DirectorContext, factor: number): CameraProgramTrack {
    return new CameraProgramTrack({
        clips: ctx.motion.program.clips.map((clip) => {
            const range = scaledRange(ctx, clip.startTimeSeconds, clip.durationSeconds, factor);
            return { ...clip.toJSON(), startTimeSeconds: range.startSeconds, durationSeconds: range.durationSeconds };
        }),
    });
}

function scaledSnapshot(ctx: DirectorContext, factor: number): TimelineScaleSnapshot {
    return {
        document: scaledDocument(ctx, factor).toJSON(),
        motionClips: scaledMotionClips(ctx, factor).map((clip) => clip.toJSON()),
        program: scaledProgram(ctx, factor).toJSON(),
    };
}

function applySnapshot(ctx: DirectorContext, snapshot: TimelineScaleSnapshot): void {
    ctx.timeline.replaceDocument(new TimelineDoc(snapshot.document));
    ctx.motion.restore(
        snapshot.motionClips.map((clip) => new CameraMotionClip(clip)),
        new CameraProgramTrack(snapshot.program),
    );
    ctx.clock.seek(ctx.clock.time);
    ctx.playback.sampleCurrent();
}

/** 整轴重定时是聚合写入:任何一个成员落点无效就整条拒绝，不留下半段时间线。 */
export class ScaleTimelineCommand extends DirectorCommand<ScaleTimelinePayload> {
    static readonly TYPE = "timeline.scale";
    readonly type = ScaleTimelineCommand.TYPE;

    constructor(readonly payload: ScaleTimelinePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (!isRecord(this.payload) || !Number.isFinite(this.payload.factor) || this.payload.factor <= 0) {
            return [issue(ISSUE_CODE.DURATION, "factor", "缩放比例必须是大于零的有限数")];
        }
        try {
            scaledSnapshot(ctx, this.payload.factor);
            return [];
        } catch {
            return [issue(ISSUE_CODE.DURATION, "factor", "缩放后每个片段与播放范围都必须至少覆盖一帧")];
        }
    }

    execute(ctx: DirectorContext): void {
        applySnapshot(ctx, scaledSnapshot(ctx, this.payload.factor));
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: RestoreTimelineScaleCommand.TYPE, payload: { snapshot: snapshotFor(ctx) } }];
    }
}

/** 只由缩放撤销使用快照，避免量化后的倒数比例累计误差。 */
class RestoreTimelineScaleCommand extends DirectorCommand<RestoreTimelineScalePayload> {
    static readonly TYPE = "timeline.restore-scale";
    readonly type = RestoreTimelineScaleCommand.TYPE;

    constructor(readonly payload: RestoreTimelineScalePayload) {
        super();
    }

    validate(): string[] {
        try {
            new TimelineDoc(this.payload.snapshot.document);
            this.payload.snapshot.motionClips.map((clip) => new CameraMotionClip(clip));
            new CameraProgramTrack(this.payload.snapshot.program);
            return [];
        } catch {
            return ["缩放撤销快照无效"];
        }
    }

    execute(ctx: DirectorContext): void {
        applySnapshot(ctx, this.payload.snapshot);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: RestoreTimelineScaleCommand.TYPE, payload: { snapshot: snapshotFor(ctx) } }];
    }
}

export class SetTimelinePlaybackRangeCommand extends DirectorCommand<SetPlaybackRangePayload> {
    static readonly TYPE = "timeline.set-playback-range";
    readonly type = SetTimelinePlaybackRangeCommand.TYPE;

    constructor(readonly payload: SetPlaybackRangePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (
            !isRecord(this.payload) ||
            !Number.isFinite(this.payload.inSeconds) ||
            !Number.isFinite(this.payload.outSeconds)
        ) {
            return [issue(ISSUE_CODE.DURATION, "playbackRange", "播放范围必须是有限秒数")];
        }
        const inSeconds = quantizeSeconds(ctx, this.payload.inSeconds);
        const outSeconds = quantizeSeconds(ctx, this.payload.outSeconds);
        const duration = ctx.timeline.document.duration;
        return inSeconds < TIMELINE_START_SECONDS || outSeconds > duration || outSeconds <= inSeconds
            ? [issue(ISSUE_CODE.DURATION, "playbackRange", "播放范围必须落在工程时长内且出点晚于入点")]
            : [];
    }

    execute(ctx: DirectorContext): void {
        ctx.timeline.setPlaybackRange({
            inSeconds: quantizeSeconds(ctx, this.payload.inSeconds),
            outSeconds: quantizeSeconds(ctx, this.payload.outSeconds),
        });
        ctx.clock.seek(ctx.clock.time);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetTimelinePlaybackRangeCommand.TYPE, payload: ctx.timeline.document.playbackRange.toJSON() }];
    }
}

/** 帧率只改变后续落点的栅格；重排既有关键帧会静默改变作者已确认的节奏。 */
export class SetTimelineFrameRateCommand extends DirectorCommand<SetFrameRatePayload> {
    static readonly TYPE = "timeline.set-frame-rate";
    readonly type = SetTimelineFrameRateCommand.TYPE;

    constructor(readonly payload: SetFrameRatePayload) {
        super();
    }

    validate(): string[] {
        return isFrameRateFps(this.payload.fps) ? [] : ["帧率必须是 1 到 240 之间的有限数"];
    }

    execute(ctx: DirectorContext): void {
        ctx.timeline.setFrameRate(this.payload.fps);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetTimelineFrameRateCommand.TYPE, payload: { fps: ctx.timeline.document.frameRate.fps } }];
    }
}

/** 对象删除的逆命令使用；恢复轨道必须在对象恢复之后执行。 */
export class RestoreTimelineTracksCommand extends DirectorCommand<RestoreTracksPayload> {
    static readonly TYPE = "timeline.restore-tracks";
    readonly type = RestoreTimelineTracksCommand.TYPE;

    constructor(readonly payload: RestoreTracksPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (!isRecord(this.payload) || !Array.isArray(this.payload.tracks)) {
            return [issue(ISSUE_CODE.PAYLOAD, "tracks", "时间轴轨道恢复参数无效")];
        }
        const restoreIssue = this.payload.tracks
            .map((track, index) => restoreTrackIssue(track, index, this.payload.tracks, ctx))
            .find((current) => current !== null);
        return restoreIssue ? [restoreIssue] : [];
    }

    execute(ctx: DirectorContext): void {
        ctx.timeline.restoreTracks(
            this.payload.tracks.map(
                (track) =>
                    new TimelineTrack({
                        ...track,
                        keyframes: track.keyframes.map((keyframe) => quantizedKeyframe(ctx, keyframe)),
                    }),
            ),
        );
        ctx.playback.sampleCurrent();
    }
}
/**
 * 整轨替换(走位草绘的落点,也是它自己的逆命令)。
 *
 * 草绘一次产出整条关键帧序列,若拆成 N 条 add-key 会撕碎撤销、半途失败留孤儿轨。
 * payload 携带的是该对象走位轨的**目标完整状态**:空数组即清空走位,因此重画/撤销
 * 都只是再发一次同类型命令,不需要第二个"删除轨道"命令。
 */
export class SetTimelineTrackCommand extends DirectorCommand<SetTrackPayload> {
    static readonly TYPE = "timeline.set-track";
    readonly type = SetTimelineTrackCommand.TYPE;

    constructor(readonly payload: SetTrackPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const payload = this.payload;
        if (!isRecord(payload) || typeof payload.trackId !== "string" || payload.trackId.length === 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "trackId", "轨道 id 格式无效")];
        }
        if (typeof payload.targetId !== "string" || payload.targetId.length === 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "targetId", "目标对象 id 格式无效")];
        }
        if (!Array.isArray(payload.keyframes)) {
            return [issue(ISSUE_CODE.PAYLOAD, "keyframes", "关键帧列表格式无效")];
        }
        if (!ctx.scene.manager.getEntity(payload.targetId)) {
            return [issue(ISSUE_CODE.TARGET, "targetId", "关键帧目标对象不存在")];
        }
        const conflicting = ctx.timeline.document.track(payload.trackId);
        if (conflicting && conflicting.targetId !== payload.targetId) {
            return [issue(ISSUE_CODE.TRACK_CONFLICT, "trackId", "轨道已属于另一个对象")];
        }
        return keyframeListIssues(payload.keyframes, ctx);
    }

    /**
     * 时间轴按内容扩长:走位时长由路径长度决定(画多长走多久),不该被一个固定的默认时长
     * 拦下整条笔迹。扩长收在本命令内,与轨道写入同属一次操作,一次撤销全回滚。
     * 只扩不缩——缩短是作者对成片时长的决策,归 timeline.set-duration。
     */
    execute(ctx: DirectorContext): void {
        const keyframes = this.payload.keyframes.map((keyframe) => quantizedKeyframe(ctx, keyframe));
        const previous = ctx.timeline.document.trackForTarget(this.payload.targetId, TIMELINE_TRACK_KIND.TRANSFORM);
        ctx.timeline.removeObjectTracks(this.payload.targetId);
        if (keyframes.length > 0) {
            ctx.timeline.restoreTracks([
                new TimelineTrack({
                    id: this.payload.trackId,
                    targetId: this.payload.targetId,
                    kind: TIMELINE_TRACK_KIND.TRANSFORM,
                    keyframes,
                    // 重画只换形状:作者调好的朝向/贴地/步幅跟着对象走,不被一次重绘清零
                    policies: this.payload.policies ?? previous?.policies,
                }),
            ]);
            const required = lastKeyframeTime(keyframes);
            if (required > ctx.timeline.document.duration) ctx.timeline.setDuration(quantizeSeconds(ctx, required));
        }
        convergeWalkSelection(ctx, this.payload);
        ctx.playback.sampleCurrent();
    }

    /**
     * 逆命令读的是执行前状态(dispatcher 先 invert 后 execute):原本无轨即回到空数组。
     * 顺序不可换:先把轨道恢复成旧的(变短),再收回时长——反过来会被 set-duration 的
     * 「存在超时长关键帧」校验挡下。
     */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const current = ctx.timeline.document.trackForTarget(this.payload.targetId, TIMELINE_TRACK_KIND.TRANSFORM);
        return [
            {
                type: SetTimelineTrackCommand.TYPE,
                payload: {
                    trackId: current?.id ?? this.payload.trackId,
                    targetId: this.payload.targetId,
                    keyframes: current ? current.keyframes.map((keyframe) => keyframe.toJSON()) : [],
                    ...(current ? { policies: current.policies.toJSON() } : {}),
                },
            },
            { type: SetTimelineDurationCommand.TYPE, payload: { duration: ctx.timeline.document.duration } },
        ];
    }
}

/**
 * 整轨重写后的选中收敛:帧 id 换了一批,旧选中会指向不存在的帧。
 * 轨道还在就降级为整轨选中(检查器不该因为重画一次就关掉),轨道没了才清空。
 */
function convergeWalkSelection(ctx: DirectorContext, payload: SetTrackPayload): void {
    const selection = ctx.timelineSelection.current;
    if (selection.walkTrackId !== payload.trackId) return;
    if (payload.keyframes.length === 0) {
        ctx.timelineSelection.clear();
        return;
    }
    const selectedKeyframeId = selection.walkKeyframeId;
    const isKeyframeGone =
        selectedKeyframeId !== null && !payload.keyframes.some((keyframe) => keyframe.id === selectedKeyframeId);
    if (isKeyframeGone) ctx.timelineSelection.select(TimelineSelection.walkTrack(payload.trackId));
}

/**
 * 整条走位轨保持关键帧相对节奏的仿射重定时。时间轴条只改时域，不改姿态、切线或作者策略。
 */
export class RetimeTimelineTrackCommand extends DirectorCommand<RetimeTrackPayload> {
    static readonly TYPE = "timeline.retime-track";
    readonly type = RetimeTimelineTrackCommand.TYPE;

    constructor(readonly payload: RetimeTrackPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const payload = this.payload;
        const hasValidIdentity = isRecord(payload) && typeof payload.trackId === "string" && payload.trackId.length > 0;
        if (!hasValidIdentity) return [issue(ISSUE_CODE.PAYLOAD, "trackId", "轨道 id 格式无效")];
        const hasValidRange =
            Number.isFinite(payload.startTimeSeconds) &&
            Number.isFinite(payload.durationSeconds) &&
            payload.startTimeSeconds >= TIMELINE_START_SECONDS &&
            payload.durationSeconds > TIMELINE_START_SECONDS;
        if (!hasValidRange) return [issue(ISSUE_CODE.DURATION, "durationSeconds", "重定时范围必须是正的有限秒数")];
        const track = ctx.timeline.document.track(payload.trackId);
        if (!track) return [issue(ISSUE_CODE.TRACK, "trackId", "轨道不存在")];
        const hasEditableRange = track.keyframes.length >= MINIMUM_RETIME_KEYFRAMES;
        const firstKeyframe = track.keyframes[FIRST_KEYFRAME_INDEX];
        const lastKeyframe = track.keyframes.at(-1);
        const hasTemporalSpan =
            hasEditableRange &&
            firstKeyframe !== undefined &&
            lastKeyframe !== undefined &&
            lastKeyframe.time > firstKeyframe.time;
        if (!hasTemporalSpan) return [issue(ISSUE_CODE.KEY, "trackId", "走位轨至少需要两枚不同时间的关键帧才能重定时")];
        const startTimeSeconds = quantizeSeconds(ctx, payload.startTimeSeconds);
        const endTimeSeconds = quantizeSeconds(ctx, payload.startTimeSeconds + payload.durationSeconds);
        if (endTimeSeconds <= startTimeSeconds) {
            return [issue(ISSUE_CODE.DURATION, "durationSeconds", "重定时范围至少覆盖一帧")];
        }
        if (endTimeSeconds > ctx.timeline.document.duration) {
            return [issue(ISSUE_CODE.DURATION, "durationSeconds", "重定时范围不能超出时间轴时长")];
        }
        try {
            retimedTrack(ctx, track, payload);
            return [];
        } catch {
            return [issue(ISSUE_CODE.DUPLICATE_TIME, "durationSeconds", "重定时后关键帧不能落在同一帧")];
        }
    }

    execute(ctx: DirectorContext): void {
        const track = ctx.timeline.document.track(this.payload.trackId);
        if (!track) return;
        ctx.timeline.replaceTrack(retimedTrack(ctx, track, this.payload));
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const track = ctx.timeline.document.track(this.payload.trackId);
        return track
            ? [
                  {
                      type: SetTimelineTrackCommand.TYPE,
                      payload: {
                          trackId: track.id,
                          targetId: track.targetId,
                          keyframes: track.keyframes.map((keyframe) => keyframe.toJSON()),
                          policies: track.policies.toJSON(),
                      },
                  },
              ]
            : [];
    }
}

/** 仿射映射只换时间坐标，保留每枚关键帧承载的姿态与插值意图。 */
function retimedTrack(ctx: DirectorContext, track: TimelineTrack, payload: RetimeTrackPayload): TimelineTrack {
    const firstKeyframe = track.keyframes[FIRST_KEYFRAME_INDEX];
    const lastKeyframe = track.keyframes.at(-1);
    if (!firstKeyframe || !lastKeyframe) return track;
    const sourceDuration = lastKeyframe.time - firstKeyframe.time;
    if (sourceDuration <= TIMELINE_START_SECONDS) return track;
    const lastKeyframeIndex = track.keyframes.length - LAST_KEYFRAME_INDEX_OFFSET;
    const startTimeSeconds = quantizeSeconds(ctx, payload.startTimeSeconds);
    const endTimeSeconds = quantizeSeconds(ctx, payload.startTimeSeconds + payload.durationSeconds);
    const timeScale = (endTimeSeconds - startTimeSeconds) / sourceDuration;
    return new TimelineTrack({
        id: track.id,
        targetId: track.targetId,
        kind: track.kind,
        keyframes: track.keyframes.map((keyframe, index) => ({
            ...keyframe.toJSON(),
            time: quantizeSeconds(
                ctx,
                index === FIRST_KEYFRAME_INDEX
                    ? startTimeSeconds
                    : index === lastKeyframeIndex
                      ? endTimeSeconds
                      : startTimeSeconds + (keyframe.time - firstKeyframe.time) * timeScale,
            ),
        })),
        policies: track.policies,
    });
}

/**
 * 整帧替换(拖 key 小球 / 拖切线手柄的落点,自逆)。
 *
 * 拖拽改的可能是位置、可能是切线、也可能是恢复自动切线——与其为每个字段开一条命令,
 * 不如让 payload 携带整枚关键帧的目标状态:逆命令就是拖拽前的那一枚,一条命令闭合。
 */
export class SetTimelineKeyCommand extends DirectorCommand<SetKeyPayload> {
    static readonly TYPE = "timeline.set-key";
    readonly type = SetTimelineKeyCommand.TYPE;

    constructor(readonly payload: SetKeyPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const payload = this.payload;
        if (!isRecord(payload) || typeof payload.trackId !== "string" || payload.trackId.length === 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "trackId", "轨道 id 格式无效")];
        }
        const keyIssue = keyframePayloadIssue(payload.keyframe);
        if (keyIssue) return [keyIssue];
        const track = ctx.timeline.document.track(payload.trackId);
        if (!track) return [issue(ISSUE_CODE.TRACK, "trackId", "轨道不存在")];
        if (!track.keyframe(payload.keyframe.id)) {
            return [issue(ISSUE_CODE.KEY, "keyframe.id", "关键帧不存在")];
        }
        if (quantizeSeconds(ctx, payload.keyframe.time) > ctx.timeline.document.duration) {
            return [issue(ISSUE_CODE.DURATION, "keyframe.time", "关键帧时间不能超过时间轴时长")];
        }
        const duplicate = duplicateTimeIssue(track, payload.keyframe.time, payload.keyframe.id, ctx);
        return duplicate ? [duplicate] : [];
    }

    execute(ctx: DirectorContext): void {
        ctx.timeline.moveKey(
            this.payload.trackId,
            new TransformKeyframe(quantizedKeyframe(ctx, this.payload.keyframe)),
        );
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const keyframe = ctx.timeline.document.track(this.payload.trackId)?.keyframe(this.payload.keyframe.id);
        return keyframe
            ? [
                  {
                      type: SetTimelineKeyCommand.TYPE,
                      payload: { trackId: this.payload.trackId, keyframe: keyframe.toJSON() },
                  },
              ]
            : [];
    }
}

/** 走位策略替换(朝向/贴地/步频,自逆):策略是整条轨的意图,故不按字段拆命令。 */
export class SetTimelineTrackPoliciesCommand extends DirectorCommand<SetPoliciesPayload> {
    static readonly TYPE = "timeline.set-track-policies";
    readonly type = SetTimelineTrackPoliciesCommand.TYPE;

    constructor(readonly payload: SetPoliciesPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const payload = this.payload;
        if (!isRecord(payload) || typeof payload.trackId !== "string" || payload.trackId.length === 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "trackId", "轨道 id 格式无效")];
        }
        if (!isRecord(payload.policies)) {
            return [issue(ISSUE_CODE.PAYLOAD, "policies", "走位策略参数格式无效")];
        }
        const track = ctx.timeline.document.track(payload.trackId);
        if (!track) return [issue(ISSUE_CODE.TRACK, "trackId", "轨道不存在")];
        const temporalIssues = keyframeListIssues(
            track.keyframes.map((keyframe) => keyframe.toJSON()),
            ctx,
        );
        if (temporalIssues.length > 0) return temporalIssues;
        return policiesIssues(payload.policies);
    }

    execute(ctx: DirectorContext): void {
        const track = ctx.timeline.document.track(this.payload.trackId);
        if (!track) return;
        ctx.timeline.replaceTrack(
            new TimelineTrack({
                ...track.toJSON(),
                keyframes: track.keyframes.map((keyframe) => quantizedKeyframe(ctx, keyframe.toJSON())),
            }).withPolicies(track.policies.with(this.payload.policies)),
        );
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const track = ctx.timeline.document.track(this.payload.trackId);
        return track
            ? [
                  {
                      type: SetTimelineTrackPoliciesCommand.TYPE,
                      payload: { trackId: this.payload.trackId, policies: track.policies.toJSON() },
                  },
              ]
            : [];
    }
}

class TimelineDocumentQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "timeline.get-document";
    readonly type = TimelineDocumentQuery.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {}

    validate(): readonly string[] {
        return isRecord(this.payload) &&
            Object.getPrototypeOf(this.payload) === Object.prototype &&
            Object.keys(this.payload).length === 0
            ? []
            : ["timeline.get-document payload 必须是空对象"];
    }

    execute(ctx: DirectorContext): unknown {
        return ctx.timeline.document.toJSON();
    }
}

const TRANSFORM_TRACK_PREFIX = "transform-";
const TRANSFORM_KEY_PREFIX = "key-";

/**
 * 在当前 playhead 把实体权威变换固化为关键帧的命令信封。
 *
 * 由 Inspector 按钮与 K 快捷键共用(Rule of Two):轨道 id 约定与 keyframe 装配
 * 只在这里出现一次,任何一方改动都不会与另一方分叉。
 */
export function transformKeyCommandFor(ctx: DirectorContext, objectId: string): SerializedCommand | null {
    const entity = ctx.scene.manager.getEntity(objectId);
    if (!entity) return null;
    return {
        type: AddTimelineKeyCommand.TYPE,
        payload: {
            trackId: `${TRANSFORM_TRACK_PREFIX}${entity.id}`,
            targetId: entity.id,
            keyframe: {
                id: `${TRANSFORM_KEY_PREFIX}${createId()}`,
                time: quantizeSeconds(ctx, ctx.clock.time),
                easing: EASING.LINEAR,
            },
        },
    };
}

function capability(
    type: string,
    kind: "command" | "query",
    permissions: readonly string[],
    payload: PayloadContract,
): CommandCapability {
    return {
        type,
        version: TIMELINE_COMMAND_VERSION,
        kind,
        permissions,
        appliesWhen: "director-desk.timeline-v1",
        payload,
    };
}

/** timeline.* 的命令、只读查询与 AI 发现元数据在同一个 Dispatcher 注册表中声明。 */
export function registerTimelineCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        AddTimelineKeyCommand.TYPE,
        (payload: AddKeyPayload) => new AddTimelineKeyCommand(payload),
        capability(AddTimelineKeyCommand.TYPE, "command", [TIMELINE_PERMISSION], AddTimelineKeyContract),
    );
    dispatcher.register(
        MoveTimelineKeyCommand.TYPE,
        (payload: MoveKeyPayload) => new MoveTimelineKeyCommand(payload),
        capability(MoveTimelineKeyCommand.TYPE, "command", [TIMELINE_PERMISSION], MoveTimelineKeyContract),
    );
    dispatcher.register(
        RemoveTimelineKeyCommand.TYPE,
        (payload: RemoveKeyPayload) => new RemoveTimelineKeyCommand(payload),
        capability(RemoveTimelineKeyCommand.TYPE, "command", [TIMELINE_PERMISSION], RemoveTimelineKeyContract),
    );
    dispatcher.register(
        SetTimelineKeyEasingCommand.TYPE,
        (payload: SetEasingPayload) => new SetTimelineKeyEasingCommand(payload),
        capability(SetTimelineKeyEasingCommand.TYPE, "command", [TIMELINE_PERMISSION], SetTimelineKeyEasingContract),
    );
    dispatcher.register(
        SetTimelineDurationCommand.TYPE,
        (payload: SetDurationPayload) => new SetTimelineDurationCommand(payload),
        capability(SetTimelineDurationCommand.TYPE, "command", [TIMELINE_PERMISSION], SetTimelineDurationContract),
    );
    dispatcher.register(
        FitTimelineDurationCommand.TYPE,
        (payload: Record<string, never>) => new FitTimelineDurationCommand(payload),
        capability(FitTimelineDurationCommand.TYPE, "command", [TIMELINE_PERMISSION], FitTimelineDurationContract),
    );
    dispatcher.register(
        ScaleTimelineCommand.TYPE,
        (payload: ScaleTimelinePayload) => new ScaleTimelineCommand(payload),
        capability(ScaleTimelineCommand.TYPE, "command", [TIMELINE_PERMISSION], ScaleTimelineContract),
    );
    dispatcher.register(
        RestoreTimelineScaleCommand.TYPE,
        (payload: RestoreTimelineScalePayload) => new RestoreTimelineScaleCommand(payload),
        capability(RestoreTimelineScaleCommand.TYPE, "command", [TIMELINE_PERMISSION], RestoreTimelineScaleContract),
    );
    dispatcher.register(
        SetTimelinePlaybackRangeCommand.TYPE,
        (payload: SetPlaybackRangePayload) => new SetTimelinePlaybackRangeCommand(payload),
        capability(SetTimelinePlaybackRangeCommand.TYPE, "command", [TIMELINE_PERMISSION], SetPlaybackRangeContract),
    );
    dispatcher.register(
        SetTimelineFrameRateCommand.TYPE,
        (payload: SetFrameRatePayload) => new SetTimelineFrameRateCommand(payload),
        capability(SetTimelineFrameRateCommand.TYPE, "command", [TIMELINE_PERMISSION], SetTimelineFrameRateContract),
    );
    dispatcher.register(
        RestoreTimelineTracksCommand.TYPE,
        (payload: RestoreTracksPayload) => new RestoreTimelineTracksCommand(payload),
        capability(RestoreTimelineTracksCommand.TYPE, "command", [TIMELINE_PERMISSION], RestoreTimelineTracksContract),
    );
    dispatcher.register(
        SetTimelineTrackCommand.TYPE,
        (payload: SetTrackPayload) => new SetTimelineTrackCommand(payload),
        capability(SetTimelineTrackCommand.TYPE, "command", [TIMELINE_PERMISSION], SetTimelineTrackContract),
    );
    dispatcher.register(
        RetimeTimelineTrackCommand.TYPE,
        (payload: RetimeTrackPayload) => new RetimeTimelineTrackCommand(payload),
        capability(RetimeTimelineTrackCommand.TYPE, "command", [TIMELINE_PERMISSION], RetimeTimelineTrackContract),
    );
    dispatcher.register(
        SetTimelineKeyCommand.TYPE,
        (payload: SetKeyPayload) => new SetTimelineKeyCommand(payload),
        capability(SetTimelineKeyCommand.TYPE, "command", [TIMELINE_PERMISSION], SetTimelineKeyContract),
    );
    dispatcher.register(
        SetTimelineTrackPoliciesCommand.TYPE,
        (payload: SetPoliciesPayload) => new SetTimelineTrackPoliciesCommand(payload),
        capability(
            SetTimelineTrackPoliciesCommand.TYPE,
            "command",
            [TIMELINE_PERMISSION],
            SetTimelineTrackPoliciesContract,
        ),
    );
    dispatcher.registerQuery(
        TimelineDocumentQuery.TYPE,
        (payload: Record<string, never>) => new TimelineDocumentQuery(payload),
        capability(TimelineDocumentQuery.TYPE, "query", [TIMELINE_READ_PERMISSION], EMPTY_PAYLOAD_CONTRACT),
    );
}
