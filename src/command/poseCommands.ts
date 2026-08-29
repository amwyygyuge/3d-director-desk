import { PoseKeyframe } from "../pose/PoseKeyframe";
import { PoseSnapshot, isQuaternionTuple } from "../pose/PoseSnapshot";
import type { PoseSnapshotInit, QuaternionTuple } from "../pose/PoseSnapshot";
import { TIMELINE_TRACK_KIND } from "../timeline/TimelineTrack";
import { TIMELINE_EASING } from "../timeline/TransformKeyframe";
import type { TimelineEasing } from "../timeline/TransformKeyframe";
import { DirectorCommand } from "./DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "./DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "./CommandDispatcher";

const POSE_VERSION = "1" as const;
const EDIT_PERMISSION = "pose:edit";
const READ_PERMISSION = "pose:read";
interface SetBonePayload { readonly objectId: string; readonly boneKey: string; readonly quaternion: QuaternionTuple; }
interface ReplacePosePayload { readonly objectId: string; readonly pose: PoseSnapshotInit | null; }
interface ClearPosePayload { readonly objectId: string; }
interface SetWeightPayload { readonly objectId: string; readonly weight: number; }
interface AddPoseKeyPayload { readonly trackId: string; readonly targetId: string; readonly keyframe: { readonly id: string; readonly time: number; readonly value: PoseSnapshotInit; readonly easing: TimelineEasing; }; }
interface MovePoseKeyPayload { readonly trackId: string; readonly keyframeId: string; readonly time: number; }
interface RemovePoseKeyPayload { readonly trackId: string; readonly keyframeId: string; }
interface SetPoseKeyEasingPayload { readonly trackId: string; readonly keyframeId: string; readonly easing: TimelineEasing; }
interface ObjectPayload { readonly objectId: string; }

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(code: string, path: string, message: string, options?: CommandIssue["options"]): CommandIssue {
    return options ? { code, path, message, options } : { code, path, message };
}

function messages(issues: readonly CommandIssue[]): string[] {
    return issues.map((current) => current.message);
}

function objectIssue(ctx: DirectorContext, objectId: unknown): CommandIssue | null {
    if (typeof objectId !== "string" || objectId.length === 0) return issue("pose-invalid-object", "objectId", "对象 id 格式无效");
    const entity = ctx.scene.manager.getEntity(objectId);
    if (!entity || entity.kind !== "model") return issue("pose-model-not-found", "objectId", "姿态只能应用到存在的模型对象");
    return null;
}

function editingIssue(ctx: DirectorContext): CommandIssue | null {
    return ctx.clock.isPlaying ? issue("pose-playback-active", "", "播放期间不能编辑姿态，请先暂停", [{ type: "transport.pause", label: "暂停播放" }]) : null;
}

function parsePoseSnapshot(value: unknown): PoseSnapshot | null {
    if (!isRecord(value) || !isRecord(value.bones)) return null;
    const bones: Record<string, QuaternionTuple> = {};
    for (const [boneKey, quaternion] of Object.entries(value.bones)) {
        if (!boneKey || !isQuaternionTuple(quaternion)) return null;
        bones[boneKey] = quaternion;
    }
    try {
        return new PoseSnapshot({ bones });
    } catch {
        return null;
    }
}

function snapshotIssue(value: unknown, path: string): CommandIssue | null {
    return parsePoseSnapshot(value) ? null : issue("pose-invalid-snapshot", path, "姿态快照包含无效的骨骼四元数");
}

function snapshotBoneIssue(ctx: DirectorContext, objectId: string, snapshot: PoseSnapshot): CommandIssue | null {
    if (snapshot.entries.length === 0) return null;
    if (!ctx.skeletons.discover(objectId).ready) {
        return issue("runtime-not-ready", "objectId", "模型骨骼尚未就绪", [{ type: "wait-for-model", label: "等待模型加载" }]);
    }
    const missing = snapshot.entries.find(([boneKey]) => !ctx.skeletons.getBone(objectId, boneKey));
    return missing
        ? issue("bone-not-found", "pose.bones", "姿态快照包含未发现的 BoneKey", [{ type: DiscoverPoseBonesQuery.TYPE, label: "重新发现骨骼" }])
        : null;
}

function timelineKeyIssue(ctx: DirectorContext, trackId: unknown, keyframeId: unknown): CommandIssue | null {
    if (typeof trackId !== "string" || trackId.length === 0) return issue("pose-invalid-track", "trackId", "姿态轨道 id 格式无效");
    if (typeof keyframeId !== "string" || keyframeId.length === 0) return issue("pose-invalid-key", "keyframeId", "姿态关键帧 id 格式无效");
    const track = ctx.timeline.document.track(trackId);
    if (!track || track.kind !== TIMELINE_TRACK_KIND.POSE) return issue("pose-track-not-found", "trackId", "姿态轨道不存在");
    return track.keyframe(keyframeId) ? null : issue("pose-key-not-found", "keyframeId", "姿态关键帧不存在");
}

/** Writes one absolute local bone rotation after runtime discovery supplied its stable BoneKey. */
export class SetPoseBoneCommand extends DirectorCommand<SetBonePayload> {
    static readonly TYPE = "pose.set-bone";
    readonly type = SetPoseBoneCommand.TYPE;
    constructor(readonly payload: SetBonePayload) { super(); }
    validate(ctx: DirectorContext): string[] { return messages(this.validateIssues(ctx)); }
    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const editing = editingIssue(ctx);
        if (editing) return [editing];
        if (!isRecord(this.payload)) return [issue("pose-invalid-payload", "", "姿态骨骼参数无效")];
        const target = objectIssue(ctx, this.payload.objectId);
        if (target) return [target];
        if (typeof this.payload.boneKey !== "string" || this.payload.boneKey.length === 0) return [issue("pose-invalid-bone", "boneKey", "必须使用 discover 返回的 BoneKey")];
        if (!isQuaternionTuple(this.payload.quaternion)) return [issue("pose-invalid-quaternion", "quaternion", "四元数必须是四个有限且非零的数字")];
        const discovery = ctx.skeletons.discover(this.payload.objectId);
        if (!discovery.ready) return [issue("runtime-not-ready", "objectId", "模型骨骼尚未就绪", [{ type: "wait-for-model", label: "等待模型加载" }])];
        return ctx.skeletons.getBone(this.payload.objectId, this.payload.boneKey)
            ? []
            : [issue("bone-not-found", "boneKey", "骨骼不存在或不属于该模型", [{ type: DiscoverPoseBonesQuery.TYPE, label: "重新发现骨骼" }])];
    }
    execute(ctx: DirectorContext): void {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        if (!entity) return;
        ctx.scene.setObjectPose(this.payload.objectId, (entity.pose ?? new PoseSnapshot({ bones: {} })).withBone(this.payload.boneKey, this.payload.quaternion));
        ctx.playback.sampleCurrent();
    }
    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        return entity ? [{ type: ReplacePoseCommand.TYPE, payload: { objectId: entity.id, pose: entity.pose?.toJSON() ?? null } }] : null;
    }
}

/** Replaces the full serializable snapshot; used by undo and host/AI bulk authoring. */
export class ReplacePoseCommand extends DirectorCommand<ReplacePosePayload> {
    static readonly TYPE = "pose.replace";
    readonly type = ReplacePoseCommand.TYPE;
    constructor(readonly payload: ReplacePosePayload) { super(); }
    validate(ctx: DirectorContext): string[] { return messages(this.validateIssues(ctx)); }
    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const editing = editingIssue(ctx);
        if (editing) return [editing];
        if (!isRecord(this.payload)) return [issue("pose-invalid-payload", "", "姿态替换参数无效")];
        const target = objectIssue(ctx, this.payload.objectId);
        if (target) return [target];
        const invalid = this.payload.pose === null ? null : snapshotIssue(this.payload.pose, "pose");
        if (invalid) return [invalid];
        const snapshot = this.payload.pose ? new PoseSnapshot(this.payload.pose) : null;
        const boneIssue = snapshot ? snapshotBoneIssue(ctx, this.payload.objectId, snapshot) : null;
        return boneIssue ? [boneIssue] : [];
    }
    execute(ctx: DirectorContext): void {
        ctx.scene.setObjectPose(this.payload.objectId, this.payload.pose ? new PoseSnapshot(this.payload.pose) : null);
        ctx.playback.sampleCurrent();
    }
    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        return entity ? [{ type: ReplacePoseCommand.TYPE, payload: { objectId: entity.id, pose: entity.pose?.toJSON() ?? null } }] : null;
    }
}

export class ClearPoseCommand extends DirectorCommand<ClearPosePayload> {
    static readonly TYPE = "pose.clear";
    readonly type = ClearPoseCommand.TYPE;
    constructor(readonly payload: ClearPosePayload) { super(); }
    validate(ctx: DirectorContext): string[] { return messages(this.validateIssues(ctx)); }
    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (!isRecord(this.payload)) return [issue("pose-invalid-payload", "", "清除姿态参数无效")];
        const editing = editingIssue(ctx);
        const target = objectIssue(ctx, this.payload.objectId);
        return editing ? [editing] : target ? [target] : [];
    }
    execute(ctx: DirectorContext): void { ctx.scene.setObjectPose(this.payload.objectId, null); ctx.playback.sampleCurrent(); }
    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        return entity ? [{ type: ReplacePoseCommand.TYPE, payload: { objectId: entity.id, pose: entity.pose?.toJSON() ?? null } }] : null;
    }
}

export class SetPoseWeightCommand extends DirectorCommand<SetWeightPayload> {
    static readonly TYPE = "pose.set-weight";
    readonly type = SetPoseWeightCommand.TYPE;
    constructor(readonly payload: SetWeightPayload) { super(); }
    validate(ctx: DirectorContext): string[] { return messages(this.validateIssues(ctx)); }
    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (!isRecord(this.payload)) return [issue("pose-invalid-payload", "", "姿态权重参数无效")];
        const editing = editingIssue(ctx);
        const target = objectIssue(ctx, this.payload.objectId);
        if (editing) return [editing];
        if (target) return [target];
        return Number.isFinite(this.payload.weight) && this.payload.weight >= 0 && this.payload.weight <= 1
            ? [] : [issue("pose-invalid-weight", "weight", "姿态权重必须是 0 到 1 的有限数")];
    }
    execute(ctx: DirectorContext): void { ctx.scene.setObjectPoseWeight(this.payload.objectId, this.payload.weight); ctx.playback.sampleCurrent(); }
    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        return entity ? [{ type: SetPoseWeightCommand.TYPE, payload: { objectId: entity.id, weight: entity.poseWeight } }] : null;
    }
}

export class AddPoseKeyCommand extends DirectorCommand<AddPoseKeyPayload> {
    static readonly TYPE = "pose.add-key";
    readonly type = AddPoseKeyCommand.TYPE;
    constructor(readonly payload: AddPoseKeyPayload) { super(); }
    validate(ctx: DirectorContext): string[] { return messages(this.validateIssues(ctx)); }
    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const editing = editingIssue(ctx);
        if (!isRecord(this.payload) || !isRecord(this.payload.keyframe)) return [issue("pose-invalid-payload", "", "姿态关键帧参数无效")];
        if (editing) return [editing];
        const target = objectIssue(ctx, this.payload.targetId);
        if (target) return [target];
        if (typeof this.payload.trackId !== "string" || this.payload.trackId.length === 0) return [issue("pose-invalid-track", "trackId", "姿态轨道 id 格式无效")];
        const key = this.payload.keyframe;
        if (!key || typeof key.id !== "string" || key.id.length === 0 || !Number.isFinite(key.time) || key.time < 0 || key.time > ctx.timeline.document.duration) return [issue("pose-invalid-key", "keyframe", "姿态关键帧格式或时间无效")];
        if (key.easing !== TIMELINE_EASING.LINEAR && key.easing !== TIMELINE_EASING.SMOOTH) return [issue("pose-invalid-key", "keyframe.easing", "姿态关键帧缓动无效")];
        const invalidSnapshot = snapshotIssue(key.value, "keyframe.value");
        if (invalidSnapshot) return [invalidSnapshot];
        const boneIssue = snapshotBoneIssue(ctx, this.payload.targetId, new PoseSnapshot(key.value));
        if (boneIssue) return [boneIssue];
        const track = ctx.timeline.document.track(this.payload.trackId);
        if (track && (track.kind !== TIMELINE_TRACK_KIND.POSE || track.targetId !== this.payload.targetId)) return [issue("pose-track-conflict", "trackId", "姿态轨道已属于其他目标或类型")];
        if (track?.keyframe(key.id) || track?.keyframes.some((current) => current.time === key.time)) return [issue("pose-duplicate-key", "keyframe", "姿态轨道中的关键帧 id 和时间必须唯一")];
        return ctx.timeline.document.trackForTarget(this.payload.targetId, TIMELINE_TRACK_KIND.POSE) && !track ? [issue("pose-track-conflict", "targetId", "对象已有姿态轨道")] : [];
    }
    execute(ctx: DirectorContext): void { ctx.timeline.addPoseKey(this.payload.trackId, this.payload.targetId, new PoseKeyframe(this.payload.keyframe)); ctx.playback.sampleCurrent(); }
    override invert(): readonly SerializedCommand[] { return [{ type: RemovePoseKeyCommand.TYPE, payload: { trackId: this.payload.trackId, keyframeId: this.payload.keyframe.id } }]; }
}

export class MovePoseKeyCommand extends DirectorCommand<MovePoseKeyPayload> {
    static readonly TYPE = "pose.move-key";
    readonly type = MovePoseKeyCommand.TYPE;
    constructor(readonly payload: MovePoseKeyPayload) { super(); }
    validate(ctx: DirectorContext): string[] { return messages(this.validateIssues(ctx)); }
    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const editing = editingIssue(ctx);
        if (!isRecord(this.payload)) return [issue("pose-invalid-payload", "", "移动姿态关键帧参数无效")];
        if (editing) return [editing];
        const key = timelineKeyIssue(ctx, this.payload.trackId, this.payload.keyframeId);
        if (key) return [key];
        if (!Number.isFinite(this.payload.time) || this.payload.time < 0 || this.payload.time > ctx.timeline.document.duration) return [issue("pose-invalid-time", "time", "姿态关键帧时间超出时间轴")];
        const track = ctx.timeline.document.track(this.payload.trackId)!;
        return track.keyframes.some((current) => current.id !== this.payload.keyframeId && current.time === this.payload.time) ? [issue("pose-duplicate-time", "time", "姿态关键帧时间必须唯一")] : [];
    }
    execute(ctx: DirectorContext): void { const key = ctx.timeline.document.track(this.payload.trackId)?.keyframe(this.payload.keyframeId) as PoseKeyframe | undefined; if (key) ctx.timeline.moveKey(this.payload.trackId, new PoseKeyframe({ ...key.toJSON(), time: this.payload.time })); ctx.playback.sampleCurrent(); }
    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null { const key = ctx.timeline.document.track(this.payload.trackId)?.keyframe(this.payload.keyframeId); return key ? [{ type: MovePoseKeyCommand.TYPE, payload: { ...this.payload, time: key.time } }] : null; }
}

export class RemovePoseKeyCommand extends DirectorCommand<RemovePoseKeyPayload> {
    static readonly TYPE = "pose.remove-key";
    readonly type = RemovePoseKeyCommand.TYPE;
    constructor(readonly payload: RemovePoseKeyPayload) { super(); }
    validate(ctx: DirectorContext): string[] { return messages(this.validateIssues(ctx)); }
    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (!isRecord(this.payload)) return [issue("pose-invalid-payload", "", "删除姿态关键帧参数无效")];
        const editing = editingIssue(ctx);
        const key = timelineKeyIssue(ctx, this.payload.trackId, this.payload.keyframeId);
        return editing ? [editing] : key ? [key] : [];
    }
    execute(ctx: DirectorContext): void { const targetId = ctx.timeline.document.track(this.payload.trackId)?.targetId; ctx.timeline.removeKey(this.payload.trackId, this.payload.keyframeId); if (targetId) ctx.playback.sampleCurrent(); }
    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null { const track = ctx.timeline.document.track(this.payload.trackId); const key = track?.keyframe(this.payload.keyframeId); return track && key ? [{ type: AddPoseKeyCommand.TYPE, payload: { trackId: track.id, targetId: track.targetId, keyframe: (key as PoseKeyframe).toJSON() } }] : null; }
}

export class SetPoseKeyEasingCommand extends DirectorCommand<SetPoseKeyEasingPayload> {
    static readonly TYPE = "pose.set-key-easing";
    readonly type = SetPoseKeyEasingCommand.TYPE;
    constructor(readonly payload: SetPoseKeyEasingPayload) { super(); }
    validate(ctx: DirectorContext): string[] { return messages(this.validateIssues(ctx)); }
    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (!isRecord(this.payload)) return [issue("pose-invalid-payload", "", "姿态缓动参数无效")];
        const editing = editingIssue(ctx);
        const key = timelineKeyIssue(ctx, this.payload.trackId, this.payload.keyframeId);
        if (editing) return [editing];
        if (key) return [key];
        return this.payload.easing === TIMELINE_EASING.LINEAR || this.payload.easing === TIMELINE_EASING.SMOOTH ? [] : [issue("pose-invalid-easing", "easing", "姿态关键帧缓动无效")];
    }
    execute(ctx: DirectorContext): void { const key = ctx.timeline.document.track(this.payload.trackId)?.keyframe(this.payload.keyframeId) as PoseKeyframe | undefined; if (key) ctx.timeline.moveKey(this.payload.trackId, new PoseKeyframe({ ...key.toJSON(), easing: this.payload.easing })); ctx.playback.sampleCurrent(); }
    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null { const key = ctx.timeline.document.track(this.payload.trackId)?.keyframe(this.payload.keyframeId); return key ? [{ type: SetPoseKeyEasingCommand.TYPE, payload: { ...this.payload, easing: key.easing } }] : null; }
}

export class DiscoverPoseBonesQuery implements DirectorQuery<ObjectPayload> {
    static readonly TYPE = "pose.bones.discover";
    readonly type = DiscoverPoseBonesQuery.TYPE;
    constructor(readonly payload: ObjectPayload) {}
    validate(ctx: DirectorContext): readonly string[] { return messages(this.validateIssues(ctx)); }
    validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (!isRecord(this.payload)) return [issue("pose-invalid-payload", "", "骨骼发现参数无效")];
        const invalid = objectIssue(ctx, this.payload.objectId);
        return invalid ? [invalid] : [];
    }
    execute(ctx: DirectorContext): unknown { return ctx.skeletons.discover(this.payload.objectId); }
}

export class GetPoseQuery implements DirectorQuery<ObjectPayload> {
    static readonly TYPE = "pose.get";
    readonly type = GetPoseQuery.TYPE;
    constructor(readonly payload: ObjectPayload) {}
    validate(ctx: DirectorContext): readonly string[] { return messages(this.validateIssues(ctx)); }
    validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (!isRecord(this.payload)) return [issue("pose-invalid-payload", "", "姿态查询参数无效")];
        const invalid = objectIssue(ctx, this.payload.objectId);
        return invalid ? [invalid] : [];
    }
    execute(ctx: DirectorContext): unknown { const entity = ctx.scene.manager.getEntity(this.payload.objectId)!; return { objectId: entity.id, pose: entity.pose?.toJSON() ?? null, poseWeight: entity.poseWeight }; }
}

function capability(type: string, kind: "command" | "query", permissions: readonly string[]): CommandCapability {
    return { type, version: POSE_VERSION, kind, permissions, appliesWhen: "director-desk.pose-v1" };
}

/** Dispatcher registration is the single serializable boundary for UI, AI and host pose authoring. */
export function registerPoseCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(SetPoseBoneCommand.TYPE, (payload: SetBonePayload) => new SetPoseBoneCommand(payload), capability(SetPoseBoneCommand.TYPE, "command", [EDIT_PERMISSION]));
    dispatcher.register(ReplacePoseCommand.TYPE, (payload: ReplacePosePayload) => new ReplacePoseCommand(payload), capability(ReplacePoseCommand.TYPE, "command", [EDIT_PERMISSION]));
    dispatcher.register(ClearPoseCommand.TYPE, (payload: ClearPosePayload) => new ClearPoseCommand(payload), capability(ClearPoseCommand.TYPE, "command", [EDIT_PERMISSION]));
    dispatcher.register(SetPoseWeightCommand.TYPE, (payload: SetWeightPayload) => new SetPoseWeightCommand(payload), capability(SetPoseWeightCommand.TYPE, "command", [EDIT_PERMISSION]));
    dispatcher.register(AddPoseKeyCommand.TYPE, (payload: AddPoseKeyPayload) => new AddPoseKeyCommand(payload), capability(AddPoseKeyCommand.TYPE, "command", [EDIT_PERMISSION]));
    dispatcher.register(MovePoseKeyCommand.TYPE, (payload: MovePoseKeyPayload) => new MovePoseKeyCommand(payload), capability(MovePoseKeyCommand.TYPE, "command", [EDIT_PERMISSION]));
    dispatcher.register(RemovePoseKeyCommand.TYPE, (payload: RemovePoseKeyPayload) => new RemovePoseKeyCommand(payload), capability(RemovePoseKeyCommand.TYPE, "command", [EDIT_PERMISSION]));
    dispatcher.register(SetPoseKeyEasingCommand.TYPE, (payload: SetPoseKeyEasingPayload) => new SetPoseKeyEasingCommand(payload), capability(SetPoseKeyEasingCommand.TYPE, "command", [EDIT_PERMISSION]));
    dispatcher.registerQuery(DiscoverPoseBonesQuery.TYPE, (payload: ObjectPayload) => new DiscoverPoseBonesQuery(payload), capability(DiscoverPoseBonesQuery.TYPE, "query", [READ_PERMISSION]));
    dispatcher.registerQuery(GetPoseQuery.TYPE, (payload: ObjectPayload) => new GetPoseQuery(payload), capability(GetPoseQuery.TYPE, "query", [READ_PERMISSION]));
}
