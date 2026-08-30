import { finiteTransform } from "../core/SceneObject";
import { PoseSnapshot, isQuaternionTuple } from "../pose/PoseSnapshot";
import { TimelineTrack, TIMELINE_TRACK_KIND } from "../timeline/TimelineTrack";
import type { TimelineTrackInit } from "../timeline/TimelineTrack";
import { TransformKeyframe, TIMELINE_EASING } from "../timeline/TransformKeyframe";
import type { TimelineEasing, TransformKeyframeInit } from "../timeline/TransformKeyframe";
import type { CommandCapability, DirectorQuery } from "./CommandDispatcher";
import type { CommandDispatcher } from "./CommandDispatcher";
import { DirectorCommand } from "./DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "./DirectorCommand";

const TIMELINE_COMMAND_VERSION = "1" as const;
const TIMELINE_PERMISSION = "timeline:edit";
const TIMELINE_READ_PERMISSION = "timeline:read";
const EMPTY_PAYLOAD: Record<string, never> = {};

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
    readonly easing: TimelineEasing;
}

interface SetDurationPayload {
    readonly duration: number;
}

interface RestoreTracksPayload {
    readonly tracks: readonly TimelineTrackInit[];
}

function issue(code: string, path: string, message: string): CommandIssue {
    return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimelineEasing(value: unknown): value is TimelineEasing {
    return value === TIMELINE_EASING.LINEAR || value === TIMELINE_EASING.SMOOTH;
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
    return isTimelineEasing(value.easing)
        ? null
        : issue(ISSUE_CODE.PAYLOAD, "keyframe.easing", "关键帧缓动必须为 linear 或 smooth");
}

function poseKeyframePayloadIssue(value: unknown): CommandIssue | null {
    if (
        !isRecord(value) ||
        typeof value.id !== "string" ||
        value.id.length === 0 ||
        typeof value.time !== "number" ||
        !Number.isFinite(value.time) ||
        value.time < 0
    ) {
        return issue(ISSUE_CODE.PAYLOAD, "keyframe", "姿态关键帧 id 或时间无效");
    }
    if (!isTimelineEasing(value.easing)) return issue(ISSUE_CODE.PAYLOAD, "keyframe.easing", "姿态关键帧缓动无效");
    if (!isRecord(value.value) || !isRecord(value.value.bones))
        return issue(ISSUE_CODE.PAYLOAD, "keyframe.value", "姿态关键帧快照无效");
    const bones: Record<string, readonly [number, number, number, number]> = {};
    for (const [boneKey, quaternion] of Object.entries(value.value.bones)) {
        if (!boneKey || !isQuaternionTuple(quaternion))
            return issue(ISSUE_CODE.PAYLOAD, "keyframe.value", "姿态关键帧快照无效");
        bones[boneKey] = quaternion;
    }
    try {
        new PoseSnapshot({ bones });
        return null;
    } catch {
        return issue(ISSUE_CODE.PAYLOAD, "keyframe.value", "姿态关键帧快照无效");
    }
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
    if (value.kind !== TIMELINE_TRACK_KIND.TRANSFORM && value.kind !== TIMELINE_TRACK_KIND.POSE) {
        return issue(ISSUE_CODE.PAYLOAD, `${path}.kind`, "恢复轨道类型无效");
    }
    if (!Array.isArray(value.keyframes) || value.keyframes.length === 0) {
        return issue(ISSUE_CODE.PAYLOAD, `${path}.keyframes`, "恢复轨道必须包含关键帧");
    }
    const keyframes: readonly unknown[] = value.keyframes;
    if (!ctx.scene.manager.getEntity(value.targetId)) {
        return issue(ISSUE_CODE.TARGET, `${path}.targetId`, "恢复轨道目标不存在");
    }
    if (ctx.timeline.document.track(value.id) || ctx.timeline.document.trackForTarget(value.targetId, value.kind)) {
        return issue(ISSUE_CODE.TRACK_CONFLICT, path, "恢复轨道与当前文档冲突");
    }
    const duplicateTrack = tracks.some(
        (candidate, candidateIndex) =>
            candidateIndex !== index &&
            isRecord(candidate) &&
            (candidate.id === value.id || (candidate.targetId === value.targetId && candidate.kind === value.kind)),
    );
    if (duplicateTrack) return issue(ISSUE_CODE.TRACK_CONFLICT, path, "恢复轨道 id 或同类型目标重复");
    const invalidKeyIndex = keyframes.findIndex((keyframe) =>
        value.kind === TIMELINE_TRACK_KIND.POSE
            ? poseKeyframePayloadIssue(keyframe) !== null
            : keyframePayloadIssue(keyframe) !== null,
    );
    if (invalidKeyIndex >= 0) {
        return issue(ISSUE_CODE.PAYLOAD, `${path}.keyframes.${invalidKeyIndex}`, "恢复关键帧参数无效");
    }
    const outOfDurationIndex = keyframes.findIndex(
        (keyframe) =>
            isRecord(keyframe) && typeof keyframe.time === "number" && keyframe.time > ctx.timeline.document.duration,
    );
    if (outOfDurationIndex >= 0) {
        return issue(
            ISSUE_CODE.DURATION,
            `${path}.keyframes.${outOfDurationIndex}.time`,
            "恢复关键帧时间超过时间轴时长",
        );
    }
    const duplicateKey = keyframes.some(
        (keyframe, keyframeIndex) =>
            isRecord(keyframe) &&
            keyframes.some(
                (candidate, candidateIndex) =>
                    candidateIndex !== keyframeIndex &&
                    isRecord(candidate) &&
                    (candidate.id === keyframe.id || candidate.time === keyframe.time),
            ),
    );
    return duplicateKey
        ? issue(ISSUE_CODE.DUPLICATE_TIME, `${path}.keyframes`, "恢复轨道的关键帧 id 或时间重复")
        : null;
}

function duplicateTimeIssue(track: TimelineTrack, time: number, excludedKeyId: string | null): CommandIssue | null {
    const duplicate = track.keyframes.find((keyframe) => keyframe.id !== excludedKeyId && keyframe.time === time);
    return duplicate ? issue(ISSUE_CODE.DUPLICATE_TIME, "keyframe.time", "同一轨道不能有重复时间的关键帧") : null;
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
        const durationIssue =
            payload.keyframe.time > ctx.timeline.document.duration
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
            const duplicate = duplicateTimeIssue(track, payload.keyframe.time, null);
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
        ctx.timeline.addKey(this.payload.trackId, this.payload.targetId, new TransformKeyframe(this.payload.keyframe));
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
        if (payload.time > ctx.timeline.document.duration) {
            return [issue(ISSUE_CODE.DURATION, "time", "关键帧时间不能超过时间轴时长")];
        }
        const track = ctx.timeline.document.track(payload.trackId);
        if (!track) return [issue(ISSUE_CODE.TRACK, "trackId", "轨道不存在")];
        if (track.kind !== TIMELINE_TRACK_KIND.TRANSFORM)
            return [issue(ISSUE_CODE.TRACK, "trackId", "轨道类型不是 transform")];
        if (!track.keyframe(payload.keyframeId)) return [issue(ISSUE_CODE.KEY, "keyframeId", "关键帧不存在")];
        const duplicate = duplicateTimeIssue(track, payload.time, payload.keyframeId);
        return duplicate ? [duplicate] : [];
    }

    execute(ctx: DirectorContext): void {
        const keyframe = ctx.timeline.document.track(this.payload.trackId)?.keyframe(this.payload.keyframeId);
        if (!keyframe) return;
        ctx.timeline.moveKey(
            this.payload.trackId,
            new TransformKeyframe({ ...(keyframe as TransformKeyframe).toJSON(), time: this.payload.time }),
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
        if (!isTimelineEasing(payload.easing)) {
            return [issue(ISSUE_CODE.PAYLOAD, "easing", "关键帧缓动必须为 linear 或 smooth")];
        }
        const track = ctx.timeline.document.track(payload.trackId);
        if (!track) return [issue(ISSUE_CODE.TRACK, "trackId", "轨道不存在")];
        if (track.kind !== TIMELINE_TRACK_KIND.TRANSFORM)
            return [issue(ISSUE_CODE.TRACK, "trackId", "轨道类型不是 transform")];
        return track.keyframe(payload.keyframeId) ? [] : [issue(ISSUE_CODE.KEY, "keyframeId", "关键帧不存在")];
    }

    execute(ctx: DirectorContext): void {
        const keyframe = ctx.timeline.document.track(this.payload.trackId)?.keyframe(this.payload.keyframeId);
        if (!keyframe) return;
        ctx.timeline.moveKey(
            this.payload.trackId,
            new TransformKeyframe({ ...(keyframe as TransformKeyframe).toJSON(), easing: this.payload.easing }),
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
        const payload = this.payload;
        if (!isRecord(payload) || !Number.isFinite(payload.duration) || payload.duration <= 0) {
            return [issue(ISSUE_CODE.DURATION, "duration", "时间轴时长必须是大于零的有限秒数")];
        }
        const oversizedTrack = ctx.timeline.document.tracks.find((track) =>
            track.keyframes.some((keyframe) => keyframe.time > payload.duration),
        );
        const oversizedMotionKey = ctx.motion.path?.keys.find((key) => key.timeSeconds > payload.duration);
        return oversizedTrack || oversizedMotionKey
            ? [issue(ISSUE_CODE.DURATION, "duration", "时间轴时长不能截断已有关键帧")]
            : [];
    }

    execute(ctx: DirectorContext): void {
        ctx.timeline.setDuration(this.payload.duration);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetTimelineDurationCommand.TYPE, payload: { duration: ctx.timeline.document.duration } }];
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
        ctx.timeline.restoreTracks(this.payload.tracks.map((track) => new TimelineTrack(track)));
        ctx.playback.sampleCurrent();
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

function capability(type: string, kind: "command" | "query", permissions: readonly string[]): CommandCapability {
    return { type, version: TIMELINE_COMMAND_VERSION, kind, permissions, appliesWhen: "director-desk.timeline-v1" };
}

/** timeline.* 的命令、只读查询与 AI 发现元数据在同一个 Dispatcher 注册表中声明。 */
export function registerTimelineCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        AddTimelineKeyCommand.TYPE,
        (payload: AddKeyPayload) => new AddTimelineKeyCommand(payload),
        capability(AddTimelineKeyCommand.TYPE, "command", [TIMELINE_PERMISSION]),
    );
    dispatcher.register(
        MoveTimelineKeyCommand.TYPE,
        (payload: MoveKeyPayload) => new MoveTimelineKeyCommand(payload),
        capability(MoveTimelineKeyCommand.TYPE, "command", [TIMELINE_PERMISSION]),
    );
    dispatcher.register(
        RemoveTimelineKeyCommand.TYPE,
        (payload: RemoveKeyPayload) => new RemoveTimelineKeyCommand(payload),
        capability(RemoveTimelineKeyCommand.TYPE, "command", [TIMELINE_PERMISSION]),
    );
    dispatcher.register(
        SetTimelineKeyEasingCommand.TYPE,
        (payload: SetEasingPayload) => new SetTimelineKeyEasingCommand(payload),
        capability(SetTimelineKeyEasingCommand.TYPE, "command", [TIMELINE_PERMISSION]),
    );
    dispatcher.register(
        SetTimelineDurationCommand.TYPE,
        (payload: SetDurationPayload) => new SetTimelineDurationCommand(payload),
        capability(SetTimelineDurationCommand.TYPE, "command", [TIMELINE_PERMISSION]),
    );
    dispatcher.register(
        RestoreTimelineTracksCommand.TYPE,
        (payload: RestoreTracksPayload) => new RestoreTimelineTracksCommand(payload),
        capability(RestoreTimelineTracksCommand.TYPE, "command", [TIMELINE_PERMISSION]),
    );
    dispatcher.registerQuery(
        TimelineDocumentQuery.TYPE,
        (payload: Record<string, never>) => new TimelineDocumentQuery(payload),
        capability(TimelineDocumentQuery.TYPE, "query", [TIMELINE_READ_PERMISSION]),
    );
}
