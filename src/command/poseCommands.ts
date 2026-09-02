import { BODY_PART, isBodyPart } from "@/actor/mixamoSkeleton";
import type { BodyPart } from "@/actor/mixamoSkeleton";
import { BoneKeyIndex } from "@/pose/BoneKeyIndex";
import { PoseComposer } from "@/pose/PoseComposer";
import { PosePreset, parsePosePreset } from "@/pose/PosePreset";
import type { PosePresetJSON } from "@/pose/PosePreset";
import { PoseSnapshot, isQuaternionTuple } from "@/pose/PoseSnapshot";
import type { PoseSnapshotInit, QuaternionTuple } from "@/pose/PoseSnapshot";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";

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

const APPLY_MODE = {
    REPLACE: "replace",
    MERGE: "merge",
} as const;
type ApplyMode = (typeof APPLY_MODE)[keyof typeof APPLY_MODE];

interface ApplyPosePresetPayload {
    readonly objectId: string;
    readonly presetId: string;
    readonly mode?: ApplyMode;
}

interface SavePosePresetPayload {
    readonly objectId: string;
    readonly labelZh: string;
    readonly part: BodyPart;
}

interface RemovePosePresetPayload {
    readonly presetId: string;
}

interface RestorePosePresetPayload {
    readonly preset: PosePresetJSON;
}

interface PosePresetsPayload {
    readonly part?: BodyPart;
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

function isApplyMode(value: unknown): value is ApplyMode {
    return value === APPLY_MODE.REPLACE || value === APPLY_MODE.MERGE;
}

function resolvedApplyMode(preset: PosePreset, mode: ApplyMode | undefined): ApplyMode {
    return mode ?? (preset.part === BODY_PART.FULL ? APPLY_MODE.REPLACE : APPLY_MODE.MERGE);
}

function actorIssue(ctx: DirectorContext, objectId: string): CommandIssue | null {
    return ctx.scene.manager.getEntity(objectId)?.actor
        ? null
        : issue("not-an-actor", "objectId", "姿势预设只能应用到具有人偶画像的对象");
}

function runtimeNotReadyIssue(): CommandIssue {
    return issue("runtime-not-ready", "objectId", "模型骨骼尚未就绪", [
        { type: "wait-for-model", label: "等待模型加载" },
    ]);
}

function skeletonFamilyIssue(ctx: DirectorContext, objectId: string, preset: PosePreset): CommandIssue | null {
    const actor = ctx.scene.manager.getEntity(objectId)?.actor;
    return actor?.skeletonFamily === preset.skeletonFamily
        ? null
        : issue("skeleton-family-mismatch", "presetId", "姿势预设与人偶骨架家族不兼容");
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

/** Applies a named portable preset and grounds its visual bounds in one undoable command. */
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
        if (typeof this.payload.presetId !== "string" || this.payload.presetId.length === 0) {
            return [issue("pose-invalid-preset", "presetId", "预设姿势 id 无效")];
        }
        if (this.payload.mode !== undefined && !isApplyMode(this.payload.mode)) {
            return [issue("pose-invalid-mode", "mode", "姿势应用模式必须是 replace 或 merge")];
        }
        const preset = ctx.posePresets.get(this.payload.presetId);
        if (!preset) {
            return [
                issue("pose-preset-not-found", "presetId", "未找到指定姿势预设", [
                    { type: PosePresetsQuery.TYPE, label: "列出可用姿势" },
                ]),
            ];
        }
        const actor = actorIssue(ctx, this.payload.objectId);
        if (actor) return [actor];
        const compatible = skeletonFamilyIssue(ctx, this.payload.objectId, preset);
        if (compatible) return [compatible];
        const index = BoneKeyIndex.from(ctx.skeletons.discover(this.payload.objectId));
        if (!index.isReady) return [runtimeNotReadyIssue()];
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        const mode = resolvedApplyMode(preset, this.payload.mode);
        const snapshot = PoseComposer.composeSnapshot({
            base: mode === APPLY_MODE.MERGE ? (entity?.pose ?? null) : null,
            preset,
            index,
        });
        return snapshot ? [] : [issue("pose-preset-bones-not-found", "presetId", "预设姿势没有匹配当前骨骼")];
    }

    execute(ctx: DirectorContext): void {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        const preset = ctx.posePresets.get(this.payload.presetId);
        if (!entity || !preset) return;
        const index = BoneKeyIndex.from(ctx.skeletons.discover(this.payload.objectId));
        const mode = resolvedApplyMode(preset, this.payload.mode);
        const snapshot = PoseComposer.composeSnapshot({
            base: mode === APPLY_MODE.MERGE ? entity.pose : null,
            preset,
            index,
        });
        if (!snapshot) return;
        ctx.binder.unmount(this.payload.objectId);
        ctx.actionPreview.clear(this.payload.objectId);
        ctx.scene.setObjectAction(this.payload.objectId, null);
        ctx.scene.setObjectPose(this.payload.objectId, snapshot);
        ctx.playback.sampleCurrent();
        const groundedTransform = ctx.poseGrounding.alignObjectToGround(this.payload.objectId);
        if (groundedTransform) ctx.scene.updateTransform(this.payload.objectId, groundedTransform);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        if (!entity) return null;
        const restore: SerializedCommand[] = [
            { type: ReplacePoseCommand.TYPE, payload: { objectId: entity.id, pose: entity.pose?.toJSON() ?? null } },
            { type: "object.move", payload: { id: entity.id, transform: entity.transform } },
        ];
        if (entity.actionId) {
            restore.push({ type: "action.mount", payload: { objectId: entity.id, actionId: entity.actionId } });
        }
        return restore;
    }
}

/** Saves the current actor pose as a portable, document-owned preset. */
export class SavePosePresetCommand extends DirectorCommand<SavePosePresetPayload> {
    static readonly TYPE = "pose.preset.save";
    readonly type = SavePosePresetCommand.TYPE;
    private readonly presetId = `custom-${crypto.randomUUID()}`;

    constructor(readonly payload: SavePosePresetPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return messages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const editing = editingIssue(ctx);
        if (editing) return [editing];
        if (!isRecord(this.payload)) return [issue("pose-invalid-save", "", "保存姿势参数无效")];
        const target = objectIssue(ctx, this.payload.objectId);
        if (target) return [target];
        if (typeof this.payload.labelZh !== "string" || this.payload.labelZh.trim().length === 0) {
            return [issue("pose-invalid-label", "labelZh", "姿势名称不能为空")];
        }
        if (!isBodyPart(this.payload.part)) return [issue("pose-invalid-part", "part", "姿势部位无效")];
        const actor = actorIssue(ctx, this.payload.objectId);
        if (actor) return [actor];
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        if (!entity?.pose) return [issue("pose-missing", "objectId", "当前对象没有可保存的姿势")];
        const index = BoneKeyIndex.from(ctx.skeletons.discover(this.payload.objectId));
        if (!index.isReady) return [runtimeNotReadyIssue()];
        const bones = PoseComposer.extractPresetBones({ snapshot: entity.pose, index, part: this.payload.part });
        return Object.keys(bones).length > 0
            ? []
            : [issue("pose-preset-empty", "part", "当前姿势不包含所选部位的可识别骨骼")];
    }

    execute(ctx: DirectorContext): void {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        if (!entity?.actor || !entity.pose) return;
        const index = BoneKeyIndex.from(ctx.skeletons.discover(this.payload.objectId));
        const bones = PoseComposer.extractPresetBones({ snapshot: entity.pose, index, part: this.payload.part });
        ctx.posePresets.registerCustom(
            new PosePreset({
                id: this.presetId,
                labelZh: this.payload.labelZh.trim(),
                part: this.payload.part,
                skeletonFamily: entity.actor.skeletonFamily,
                bones,
                custom: true,
            }),
        );
    }

    override invert(): readonly SerializedCommand[] {
        return [{ type: RemovePosePresetCommand.TYPE, payload: { presetId: this.presetId } }];
    }
}

/** Removes a document-owned preset while preserving the full payload for undo. */
export class RemovePosePresetCommand extends DirectorCommand<RemovePosePresetPayload> {
    static readonly TYPE = "pose.preset.remove";
    readonly type = RemovePosePresetCommand.TYPE;

    constructor(readonly payload: RemovePosePresetPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return messages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (
            !isRecord(this.payload) ||
            typeof this.payload.presetId !== "string" ||
            this.payload.presetId.length === 0
        ) {
            return [issue("pose-invalid-preset", "presetId", "预设姿势 id 无效")];
        }
        const preset = ctx.posePresets.get(this.payload.presetId);
        if (!preset) return [issue("pose-preset-not-found", "presetId", "未找到指定姿势预设")];
        return preset.custom ? [] : [issue("pose-preset-builtin", "presetId", "内置姿势预设不能删除")];
    }

    execute(ctx: DirectorContext): void {
        ctx.posePresets.removeCustom(this.payload.presetId);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const preset = ctx.posePresets.get(this.payload.presetId);
        return preset?.custom ? [{ type: RestorePosePresetCommand.TYPE, payload: { preset: preset.toJSON() } }] : null;
    }
}

/** Internal undo companion for restoring a removed document-owned preset. */
export class RestorePosePresetCommand extends DirectorCommand<RestorePosePresetPayload> {
    static readonly TYPE = "pose.preset.restore";
    readonly type = RestorePosePresetCommand.TYPE;

    constructor(readonly payload: RestorePosePresetPayload) {
        super();
    }

    validate(): string[] {
        return messages(this.validateIssues());
    }

    override validateIssues(): readonly CommandIssue[] {
        const preset = isRecord(this.payload) ? parsePosePreset(this.payload.preset) : null;
        return preset?.custom ? [] : [issue("pose-invalid-preset", "preset", "恢复姿势预设参数无效")];
    }

    execute(ctx: DirectorContext): void {
        const preset = parsePosePreset(this.payload.preset);
        if (preset?.custom) ctx.posePresets.registerCustom(preset);
    }

    override invert(): readonly SerializedCommand[] {
        return [{ type: RemovePosePresetCommand.TYPE, payload: { presetId: this.payload.preset.id } }];
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

    /** 清除姿势后必须重新贴地:坐/卧姿的贴地位移是命令写进 transform 的,不撤掉人偶会留在半空或地下。 */
    execute(ctx: DirectorContext): void {
        ctx.scene.setObjectPose(this.payload.objectId, null);
        ctx.playback.sampleCurrent();
        const grounded = ctx.poseGrounding.alignObjectToGround(this.payload.objectId);
        if (grounded) ctx.scene.updateTransform(this.payload.objectId, grounded);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        return entity
            ? [
                  {
                      type: ReplacePoseCommand.TYPE,
                      payload: { objectId: entity.id, pose: entity.pose?.toJSON() ?? null },
                  },
                  { type: "object.move", payload: { id: entity.id, transform: entity.transform } },
              ]
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

/** Lists preset metadata without exposing the full quaternion payload to command callers. */
export class PosePresetsQuery implements DirectorQuery<PosePresetsPayload> {
    static readonly TYPE = "pose.presets.list";
    readonly type = PosePresetsQuery.TYPE;

    constructor(readonly payload: PosePresetsPayload) {}

    validate(): readonly string[] {
        return !isRecord(this.payload) || (this.payload.part !== undefined && !isBodyPart(this.payload.part))
            ? ["姿势列表参数无效"]
            : [];
    }

    execute(
        ctx: DirectorContext,
    ): readonly { readonly id: string; readonly labelZh: string; readonly part: BodyPart; readonly custom: boolean }[] {
        return ctx.posePresets
            .list(this.payload.part)
            .map((preset) => ({ id: preset.id, labelZh: preset.labelZh, part: preset.part, custom: preset.custom }));
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
        SavePosePresetCommand.TYPE,
        (payload: SavePosePresetPayload) => new SavePosePresetCommand(payload),
        capability(SavePosePresetCommand.TYPE, "command", [EDIT_PERMISSION]),
    );
    dispatcher.register(
        RemovePosePresetCommand.TYPE,
        (payload: RemovePosePresetPayload) => new RemovePosePresetCommand(payload),
        capability(RemovePosePresetCommand.TYPE, "command", [EDIT_PERMISSION]),
    );
    dispatcher.register(
        RestorePosePresetCommand.TYPE,
        (payload: RestorePosePresetPayload) => new RestorePosePresetCommand(payload),
        capability(RestorePosePresetCommand.TYPE, "command", [EDIT_PERMISSION]),
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
    dispatcher.registerQuery(
        PosePresetsQuery.TYPE,
        (payload: PosePresetsPayload) => new PosePresetsQuery(payload),
        capability(PosePresetsQuery.TYPE, "query", [READ_PERMISSION]),
    );
}
