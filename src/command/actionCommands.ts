import { BONE_MATCH_THRESHOLD } from "@/animation/BoneCompatibilityChecker";
import type { BoneCheckResult } from "@/animation/BoneCompatibilityChecker";
import type { AnimationClip, Object3D } from "three";
import { quantizeSeconds } from "@/command/timelineCommands";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import { EMPTY_PAYLOAD_CONTRACT } from "@/command/PayloadContract";
import type { PayloadContract } from "@/command/PayloadContract";
class BoneCompatibilityIndex {
    private readonly nodeNamesByRoot = new WeakMap<Object3D, ReadonlySet<string>>();
    private readonly resultsByRoot = new WeakMap<Object3D, Map<AnimationClip, BoneCheckResult>>();

    check(root: Object3D, clip: AnimationClip): BoneCheckResult {
        const cached = this.resultsByRoot.get(root)?.get(clip);
        if (cached) return cached;

        const nodeNames = this.nodeNamesByRoot.get(root) ?? this.indexNodeNames(root);
        const targets = [...new Set(clip.tracks.map((track) => track.name.split(".")[0] ?? ""))].filter(Boolean);
        const missingTargets = targets.filter((name) => !nodeNames.has(name));
        const result = {
            matchedRatio: targets.length === 0 ? 0 : (targets.length - missingTargets.length) / targets.length,
            missingTargets,
            ok: targets.length > 0 && (targets.length - missingTargets.length) / targets.length >= BONE_MATCH_THRESHOLD,
        };
        const results = this.resultsByRoot.get(root) ?? new Map<AnimationClip, BoneCheckResult>();
        results.set(clip, result);
        this.resultsByRoot.set(root, results);
        return result;
    }

    private indexNodeNames(root: Object3D): ReadonlySet<string> {
        const nodeNames = new Set<string>();
        root.traverse((node) => {
            if (node.name) nodeNames.add(node.name);
        });
        this.nodeNamesByRoot.set(root, nodeNames);
        return nodeNames;
    }
}

const boneCompatibilityIndex = new BoneCompatibilityIndex();
const ACTION_EDIT_PERMISSION = "action:edit";
const TRANSPORT_CONTROL_PERMISSION = "transport:control";
const TRANSPORT_READ_PERMISSION = "transport:read";
const ACTION_APPLIES_WHEN = "director-desk.action-v1";
const TRANSPORT_APPLIES_WHEN = "director-desk.transport-v1";

function capability(
    type: string,
    permission: string,
    appliesWhen: string,
    payload: PayloadContract,
): CommandCapability {
    return { type, version: "1", kind: "command", permissions: [permission], appliesWhen, payload };
}

interface MountActionPayload {
    objectId: string;
    actionId: string;
}

const MOUNT_ACTION_CONTRACT: PayloadContract = {
    properties: {
        objectId: { type: "string" },
        actionId: { type: "string" },
    },
    required: ["objectId", "actionId"],
};

interface PreviewActionPayload {
    readonly objectId: string;
}

const ACTION_PREVIEW_PLAY_CONTRACT: PayloadContract = {
    properties: { objectId: { type: "string" } },
    required: ["objectId"],
};

interface PreviewSeekPayload extends PreviewActionPayload {
    readonly timeSeconds: number;
}

const ACTION_PREVIEW_SEEK_CONTRACT: PayloadContract = {
    properties: {
        objectId: { type: "string" },
        timeSeconds: { type: "number" },
    },
    required: ["objectId", "timeSeconds"],
};

function previewTargetFor(
    ctx: DirectorContext,
    objectId: string,
): { readonly durationSeconds: number; readonly objectId: string } | null {
    const actionId = ctx.scene.manager.getEntity(objectId)?.actionId;
    const action = actionId ? ctx.animations.actions.find((candidate) => candidate.id === actionId) : undefined;
    return action ? { objectId, durationSeconds: action.duration } : null;
}

/** 动作挂载:骨骼预检不过 → 结构化诊断(匹配率/缺失轨道/可用动作清单),AI 可据此重试 */
export class MountActionCommand extends DirectorCommand<MountActionPayload> {
    static readonly TYPE = "action.mount";
    readonly type = MountActionCommand.TYPE;

    constructor(readonly payload: MountActionPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        if (!entity) return [`对象 "${this.payload.objectId}" 不存在`];
        if (entity.kind !== "model") return [`对象 "${this.payload.objectId}" 不是模型,无法挂动作`];
        const clip = ctx.animations.getClip(this.payload.actionId);
        if (!clip) return [`动作 "${this.payload.actionId}" 不在动作库`];
        const runtime = ctx.scene.manager.getRuntime(this.payload.objectId);
        if (!runtime) return [`对象 "${this.payload.objectId}" 运行时未就绪(模型加载中?)`];

        const check = boneCompatibilityIndex.check(runtime, clip);
        if (check.ok) return [];
        const compatible = ctx.animations.actions
            .filter((action) => {
                const actionClip = ctx.animations.getClip(action.id);
                return actionClip ? boneCompatibilityIndex.check(runtime, actionClip).ok : false;
            })
            .map((action) => action.name);
        return [
            `bone-incompatible: 轨道匹配率 ${(check.matchedRatio * 100).toFixed(0)}%(阈值 ${BONE_MATCH_THRESHOLD * 100}%);` +
                `缺失目标 ${check.missingTargets.length} 个(如 ${check.missingTargets.slice(0, 3).join(", ")});` +
                `当前库中可用动作: [${compatible.join(", ")}]`,
        ];
    }

    execute(ctx: DirectorContext): void {
        const runtime = ctx.scene.manager.getRuntime(this.payload.objectId);
        const clip = ctx.animations.getClip(this.payload.actionId);
        if (!runtime || !clip) return;
        ctx.binder.mount(this.payload.objectId, runtime, clip);
        ctx.scene.setObjectAction(this.payload.objectId, this.payload.actionId);
        ctx.actionPreview.prepare({ objectId: this.payload.objectId, durationSeconds: clip.duration });
        ctx.playback.requestRender();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const previousActionId = ctx.scene.manager.getEntity(this.payload.objectId)?.actionId;
        return previousActionId
            ? [
                  {
                      type: MountActionCommand.TYPE,
                      payload: { objectId: this.payload.objectId, actionId: previousActionId },
                  },
              ]
            : [{ type: UnmountActionCommand.TYPE, payload: { objectId: this.payload.objectId } }];
    }
}

interface UnmountActionPayload {
    objectId: string;
}

const UNMOUNT_ACTION_CONTRACT: PayloadContract = {
    properties: { objectId: { type: "string" } },
    required: ["objectId"],
};

export class UnmountActionCommand extends DirectorCommand<UnmountActionPayload> {
    static readonly TYPE = "action.unmount";
    readonly type = UnmountActionCommand.TYPE;

    constructor(readonly payload: UnmountActionPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return ctx.scene.manager.getEntity(this.payload.objectId) ? [] : [`对象 "${this.payload.objectId}" 不存在`];
    }

    execute(ctx: DirectorContext): void {
        ctx.binder.unmount(this.payload.objectId);
        ctx.actionPreview.clear(this.payload.objectId);
        ctx.scene.setObjectAction(this.payload.objectId, null);
        if (ctx.binder.isEmpty) ctx.clock.pause();
        ctx.playback.requestRender();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const actionId = ctx.scene.manager.getEntity(this.payload.objectId)?.actionId;
        return actionId
            ? [{ type: MountActionCommand.TYPE, payload: { objectId: this.payload.objectId, actionId } }]
            : null;
    }
}

/** Plays only the selected model's mounted action; global Timeline playback is intentionally untouched. */
export class ActionPreviewPlayCommand extends DirectorCommand<PreviewActionPayload> {
    static readonly TYPE = "action.preview.play";
    readonly type = ActionPreviewPlayCommand.TYPE;

    constructor(readonly payload: PreviewActionPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return previewTargetFor(ctx, this.payload.objectId) ? [] : ["对象没有可播放的已挂载动作"];
    }

    execute(ctx: DirectorContext): void {
        const target = previewTargetFor(ctx, this.payload.objectId);
        if (!target) return;
        ctx.actionPreview.play(target);
        ctx.playback.requestRender();
    }
}

/** Pauses the local action preview without stopping Timeline playback. */
export class ActionPreviewPauseCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "action.preview.pause";
    readonly type = ActionPreviewPauseCommand.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {
        super();
    }

    validate(): string[] {
        return [];
    }

    execute(ctx: DirectorContext): void {
        ctx.actionPreview.pause();
        ctx.playback.requestRender();
    }
}

/** Seeks only the selected model's mounted action. */
export class ActionPreviewSeekCommand extends DirectorCommand<PreviewSeekPayload> {
    static readonly TYPE = "action.preview.seek";
    readonly type = ActionPreviewSeekCommand.TYPE;

    constructor(readonly payload: PreviewSeekPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        if (!Number.isFinite(this.payload.timeSeconds) || this.payload.timeSeconds < 0)
            return ["预览时间必须是非负有限秒数"];
        return previewTargetFor(ctx, this.payload.objectId) ? [] : ["对象没有可定位的已挂载动作"];
    }

    execute(ctx: DirectorContext): void {
        const target = previewTargetFor(ctx, this.payload.objectId);
        if (!target) return;
        ctx.actionPreview.seek(target, this.payload.timeSeconds);
        ctx.playback.requestRender();
    }
}

/** 时钟三命令:播放/暂停/定位;payload 纯数据,AI 可直接调 */
export class TransportPlayCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "transport.play";
    readonly type = TransportPlayCommand.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {
        super();
    }

    validate(): string[] {
        return [];
    }

    execute(ctx: DirectorContext): void {
        ctx.clock.play();
    }
}

export class TransportPauseCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "transport.pause";
    readonly type = TransportPauseCommand.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {
        super();
    }

    validate(): string[] {
        return [];
    }

    execute(ctx: DirectorContext): void {
        ctx.clock.pause();
    }
}

/** 停止不同于暂停：清除时间轴运行时采样，并把对象恢复到实体权威变换。 */
export class TransportStopCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "transport.stop";
    readonly type = TransportStopCommand.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {
        super();
    }

    validate(): string[] {
        return [];
    }

    execute(ctx: DirectorContext): void {
        ctx.clock.stop();
    }
}

interface TransportSeekPayload {
    time: number;
}

const TRANSPORT_SEEK_CONTRACT: PayloadContract = {
    properties: { time: { type: "number" } },
    required: ["time"],
};

export class TransportSeekCommand extends DirectorCommand<TransportSeekPayload> {
    static readonly TYPE = "transport.seek";
    readonly type = TransportSeekCommand.TYPE;

    constructor(readonly payload: TransportSeekPayload) {
        super();
    }

    validate(): string[] {
        return Number.isFinite(this.payload.time) && this.payload.time >= 0 ? [] : ["seek 时间必须是 ≥0 的有限数"];
    }

    execute(ctx: DirectorContext): void {
        ctx.clock.seek(quantizeSeconds(ctx, this.payload.time));
    }
}

interface TransportLoopPayload {
    readonly loop: boolean;
}

const TRANSPORT_SET_LOOP_CONTRACT: PayloadContract = {
    properties: { loop: { type: "boolean" } },
    required: ["loop"],
};

/** 循环开关(瞬态,不入撤销栈):反复看同一段是评估运镜节奏的唯一手段。 */
export class TransportSetLoopCommand extends DirectorCommand<TransportLoopPayload> {
    static readonly TYPE = "transport.set-loop";
    readonly type = TransportSetLoopCommand.TYPE;

    constructor(readonly payload: TransportLoopPayload) {
        super();
    }

    validate(): string[] {
        return typeof this.payload.loop === "boolean" ? [] : ["loop 必须是布尔值"];
    }

    execute(ctx: DirectorContext): void {
        ctx.clock.setLooping(this.payload.loop);
    }
}

/** 播放态此前只能直读 observable；跨 iframe/工具面需经注册查询返回稳定 DTO。 */
export class TransportGetStateQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "transport.get-state";
    readonly type = TransportGetStateQuery.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {}

    validate(): readonly string[] {
        return [];
    }

    execute(ctx: DirectorContext): {
        readonly time: number;
        readonly isPlaying: boolean;
        readonly isLooping: boolean;
        readonly durationSeconds: number;
    } {
        return {
            time: ctx.clock.time,
            isPlaying: ctx.clock.isPlaying,
            isLooping: ctx.clock.isLooping,
            durationSeconds: ctx.clock.durationSeconds,
        };
    }
}

const TRANSPORT_GET_STATE_CAPABILITY: CommandCapability = {
    type: TransportGetStateQuery.TYPE,
    version: "1",
    kind: "query",
    permissions: [TRANSPORT_READ_PERMISSION],
    appliesWhen: TRANSPORT_APPLIES_WHEN,
    payload: EMPTY_PAYLOAD_CONTRACT,
};

export function registerActionCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        MountActionCommand.TYPE,
        (payload: MountActionPayload) => new MountActionCommand(payload),
        capability(MountActionCommand.TYPE, ACTION_EDIT_PERMISSION, ACTION_APPLIES_WHEN, MOUNT_ACTION_CONTRACT),
    );
    dispatcher.register(
        UnmountActionCommand.TYPE,
        (payload: UnmountActionPayload) => new UnmountActionCommand(payload),
        capability(UnmountActionCommand.TYPE, ACTION_EDIT_PERMISSION, ACTION_APPLIES_WHEN, UNMOUNT_ACTION_CONTRACT),
    );
    dispatcher.register(
        ActionPreviewPlayCommand.TYPE,
        (payload: PreviewActionPayload) => new ActionPreviewPlayCommand(payload),
        capability(
            ActionPreviewPlayCommand.TYPE,
            ACTION_EDIT_PERMISSION,
            ACTION_APPLIES_WHEN,
            ACTION_PREVIEW_PLAY_CONTRACT,
        ),
    );
    dispatcher.register(
        ActionPreviewPauseCommand.TYPE,
        () => new ActionPreviewPauseCommand(),
        capability(ActionPreviewPauseCommand.TYPE, ACTION_EDIT_PERMISSION, ACTION_APPLIES_WHEN, EMPTY_PAYLOAD_CONTRACT),
    );
    dispatcher.register(
        ActionPreviewSeekCommand.TYPE,
        (payload: PreviewSeekPayload) => new ActionPreviewSeekCommand(payload),
        capability(
            ActionPreviewSeekCommand.TYPE,
            ACTION_EDIT_PERMISSION,
            ACTION_APPLIES_WHEN,
            ACTION_PREVIEW_SEEK_CONTRACT,
        ),
    );
    dispatcher.register(
        TransportSetLoopCommand.TYPE,
        (payload: TransportLoopPayload) => new TransportSetLoopCommand(payload),
        capability(
            TransportSetLoopCommand.TYPE,
            TRANSPORT_CONTROL_PERMISSION,
            TRANSPORT_APPLIES_WHEN,
            TRANSPORT_SET_LOOP_CONTRACT,
        ),
    );
    dispatcher.register(
        TransportPlayCommand.TYPE,
        () => new TransportPlayCommand(),
        capability(
            TransportPlayCommand.TYPE,
            TRANSPORT_CONTROL_PERMISSION,
            TRANSPORT_APPLIES_WHEN,
            EMPTY_PAYLOAD_CONTRACT,
        ),
    );
    dispatcher.register(
        TransportPauseCommand.TYPE,
        () => new TransportPauseCommand(),
        capability(
            TransportPauseCommand.TYPE,
            TRANSPORT_CONTROL_PERMISSION,
            TRANSPORT_APPLIES_WHEN,
            EMPTY_PAYLOAD_CONTRACT,
        ),
    );
    dispatcher.register(
        TransportSeekCommand.TYPE,
        (payload: TransportSeekPayload) => new TransportSeekCommand(payload),
        capability(
            TransportSeekCommand.TYPE,
            TRANSPORT_CONTROL_PERMISSION,
            TRANSPORT_APPLIES_WHEN,
            TRANSPORT_SEEK_CONTRACT,
        ),
    );
    dispatcher.register(
        TransportStopCommand.TYPE,
        () => new TransportStopCommand(),
        capability(
            TransportStopCommand.TYPE,
            TRANSPORT_CONTROL_PERMISSION,
            TRANSPORT_APPLIES_WHEN,
            EMPTY_PAYLOAD_CONTRACT,
        ),
    );
    dispatcher.registerQuery(
        TransportGetStateQuery.TYPE,
        () => new TransportGetStateQuery(),
        TRANSPORT_GET_STATE_CAPABILITY,
    );
}
