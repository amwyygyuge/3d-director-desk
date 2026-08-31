import { PoseSnapshot, isQuaternionTuple } from "../pose/PoseSnapshot";
import type { PoseSnapshotInit, QuaternionTuple } from "../pose/PoseSnapshot";
import { DirectorCommand } from "./DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "./DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "./CommandDispatcher";

const POSE_VERSION = "1" as const;
const EDIT_PERMISSION = "pose:edit";
const READ_PERMISSION = "pose:read";

interface SetBonePayload {
    readonly objectId: string;
    readonly boneKey: string;
    readonly quaternion: QuaternionTuple;
}

interface ReplacePosePayload {
    readonly objectId: string;
    readonly pose: PoseSnapshotInit | null;
}

interface ApplyPosePresetPayload {
    readonly objectId: string;
    readonly pose: PoseSnapshotInit;
}

interface ClearPosePayload {
    readonly objectId: string;
}

interface ObjectPayload {
    readonly objectId: string;
}

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
    if (typeof objectId !== "string" || objectId.length === 0)
        return issue("pose-invalid-object", "objectId", "对象 id 格式无效");
    const entity = ctx.scene.manager.getEntity(objectId);
    return !entity || entity.kind !== "model"
        ? issue("pose-model-not-found", "objectId", "姿态只能应用到存在的模型对象")
        : null;
}

function editingIssue(ctx: DirectorContext): CommandIssue | null {
    return ctx.clock.isPlaying
        ? issue("pose-playback-active", "", "时间线播放期间不能编辑姿态，请先暂停", [
              { type: "transport.pause", label: "暂停播放" },
          ])
        : null;
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
        return issue("runtime-not-ready", "objectId", "模型骨骼尚未就绪", [
            { type: "wait-for-model", label: "等待模型加载" },
        ]);
    }
    const missing = snapshot.entries.find(([boneKey]) => !ctx.skeletons.getBone(objectId, boneKey));
    return missing
        ? issue("bone-not-found", "pose.bones", "姿态快照包含未发现的 BoneKey", [
              { type: DiscoverPoseBonesQuery.TYPE, label: "重新发现骨骼" },
          ])
        : null;
}

/** Writes one absolute local bone rotation after runtime discovery supplied its stable BoneKey. */
export class SetPoseBoneCommand extends DirectorCommand<SetBonePayload> {
    static readonly TYPE = "pose.set-bone";
    readonly type = SetPoseBoneCommand.TYPE;

    constructor(readonly payload: SetBonePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return messages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const editing = editingIssue(ctx);
        if (editing) return [editing];
        if (!isRecord(this.payload)) return [issue("pose-invalid-payload", "", "姿态骨骼参数无效")];
        const target = objectIssue(ctx, this.payload.objectId);
        if (target) return [target];
        if (typeof this.payload.boneKey !== "string" || this.payload.boneKey.length === 0)
            return [issue("pose-invalid-bone", "boneKey", "必须使用 discover 返回的 BoneKey")];
        if (!isQuaternionTuple(this.payload.quaternion))
            return [issue("pose-invalid-quaternion", "quaternion", "四元数必须是四个有限且非零的数字")];
        if (!ctx.skeletons.discover(this.payload.objectId).ready)
            return [
                issue("runtime-not-ready", "objectId", "模型骨骼尚未就绪", [
                    { type: "wait-for-model", label: "等待模型加载" },
                ]),
            ];
        return ctx.skeletons.getBone(this.payload.objectId, this.payload.boneKey)
            ? []
            : [issue("bone-not-found", "boneKey", "骨骼不存在或不属于该模型")];
    }

    execute(ctx: DirectorContext): void {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        if (!entity) return;
        ctx.scene.setObjectPose(
            this.payload.objectId,
            (entity.pose ?? new PoseSnapshot({ bones: {} })).withBone(this.payload.boneKey, this.payload.quaternion),
        );
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        return entity
            ? [{ type: ReplacePoseCommand.TYPE, payload: { objectId: entity.id, pose: entity.pose?.toJSON() ?? null } }]
            : null;
    }
}

/** Replaces the full serializable snapshot; used by undo and host/AI bulk authoring. */
export class ReplacePoseCommand extends DirectorCommand<ReplacePosePayload> {
    static readonly TYPE = "pose.replace";
    readonly type = ReplacePoseCommand.TYPE;

    constructor(readonly payload: ReplacePosePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return messages(this.validateIssues(ctx));
    }

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
        return entity
            ? [{ type: ReplacePoseCommand.TYPE, payload: { objectId: entity.id, pose: entity.pose?.toJSON() ?? null } }]
            : null;
    }
}

/** Applies a static preset as a serializable pose and grounds its visual bounds in one undoable command. */
export class ApplyPosePresetCommand extends DirectorCommand<ApplyPosePresetPayload> {
    static readonly TYPE = "pose.apply-preset";
    readonly type = ApplyPosePresetCommand.TYPE;

    constructor(readonly payload: ApplyPosePresetPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return messages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const editing = editingIssue(ctx);
        if (editing) return [editing];
        if (!isRecord(this.payload)) return [issue("pose-invalid-preset", "", "预设姿势参数无效")];
        const target = objectIssue(ctx, this.payload.objectId);
        if (target) return [target];
        const invalid = snapshotIssue(this.payload.pose, "pose");
        if (invalid) return [invalid];
        const boneIssue = snapshotBoneIssue(ctx, this.payload.objectId, new PoseSnapshot(this.payload.pose));
        return boneIssue ? [boneIssue] : [];
    }

    execute(ctx: DirectorContext): void {
        const snapshot = new PoseSnapshot(this.payload.pose);
        ctx.scene.setObjectPose(this.payload.objectId, snapshot);
        const groundedTransform = ctx.poseGrounding.alignObjectToGround(this.payload.objectId);
        if (groundedTransform) ctx.scene.updateTransform(this.payload.objectId, groundedTransform);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        if (!entity) return null;
        return [
            { type: ReplacePoseCommand.TYPE, payload: { objectId: entity.id, pose: entity.pose?.toJSON() ?? null } },
            { type: "object.move", payload: { id: entity.id, transform: entity.transform } },
        ];
    }
}

export class ClearPoseCommand extends DirectorCommand<ClearPosePayload> {
    static readonly TYPE = "pose.clear";
    readonly type = ClearPoseCommand.TYPE;

    constructor(readonly payload: ClearPosePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        const editing = editingIssue(ctx);
        const target = objectIssue(ctx, this.payload.objectId);
        return editing ? [editing.message] : target ? [target.message] : [];
    }

    execute(ctx: DirectorContext): void {
        ctx.scene.setObjectPose(this.payload.objectId, null);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        return entity
            ? [{ type: ReplacePoseCommand.TYPE, payload: { objectId: entity.id, pose: entity.pose?.toJSON() ?? null } }]
            : null;
    }
}

export class DiscoverPoseBonesQuery implements DirectorQuery<ObjectPayload> {
    static readonly TYPE = "pose.bones.discover";
    readonly type = DiscoverPoseBonesQuery.TYPE;

    constructor(readonly payload: ObjectPayload) {}

    validate(ctx: DirectorContext): readonly string[] {
        if (!isRecord(this.payload)) return ["骨骼发现参数无效"];
        const invalid = objectIssue(ctx, this.payload.objectId);
        return invalid ? [invalid.message] : [];
    }

    execute(ctx: DirectorContext): unknown {
        return ctx.skeletons.discover(this.payload.objectId);
    }
}

export class GetPoseQuery implements DirectorQuery<ObjectPayload> {
    static readonly TYPE = "pose.get";
    readonly type = GetPoseQuery.TYPE;

    constructor(readonly payload: ObjectPayload) {}

    validate(ctx: DirectorContext): readonly string[] {
        if (!isRecord(this.payload)) return ["姿态查询参数无效"];
        const invalid = objectIssue(ctx, this.payload.objectId);
        return invalid ? [invalid.message] : [];
    }

    execute(ctx: DirectorContext): unknown {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId)!;
        return { objectId: entity.id, pose: entity.pose?.toJSON() ?? null };
    }
}

function capability(type: string, kind: "command" | "query", permissions: readonly string[]): CommandCapability {
    return { type, version: POSE_VERSION, kind, permissions, appliesWhen: "director-desk.pose-v1" };
}

/** Dispatcher registration is the serializable boundary for preset pose authoring. */
export function registerPoseCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        SetPoseBoneCommand.TYPE,
        (payload: SetBonePayload) => new SetPoseBoneCommand(payload),
        capability(SetPoseBoneCommand.TYPE, "command", [EDIT_PERMISSION]),
    );
    dispatcher.register(
        ReplacePoseCommand.TYPE,
        (payload: ReplacePosePayload) => new ReplacePoseCommand(payload),
        capability(ReplacePoseCommand.TYPE, "command", [EDIT_PERMISSION]),
    );
    dispatcher.register(
        ApplyPosePresetCommand.TYPE,
        (payload: ApplyPosePresetPayload) => new ApplyPosePresetCommand(payload),
        capability(ApplyPosePresetCommand.TYPE, "command", [EDIT_PERMISSION]),
    );
    dispatcher.register(
        ClearPoseCommand.TYPE,
        (payload: ClearPosePayload) => new ClearPoseCommand(payload),
        capability(ClearPoseCommand.TYPE, "command", [EDIT_PERMISSION]),
    );
    dispatcher.registerQuery(
        DiscoverPoseBonesQuery.TYPE,
        (payload: ObjectPayload) => new DiscoverPoseBonesQuery(payload),
        capability(DiscoverPoseBonesQuery.TYPE, "query", [READ_PERMISSION]),
    );
    dispatcher.registerQuery(
        GetPoseQuery.TYPE,
        (payload: ObjectPayload) => new GetPoseQuery(payload),
        capability(GetPoseQuery.TYPE, "query", [READ_PERMISSION]),
    );
}
