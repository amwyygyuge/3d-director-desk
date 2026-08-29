import { BONE_MATCH_THRESHOLD } from "../animation/BoneCompatibilityChecker";
import type { BoneCheckResult } from "../animation/BoneCompatibilityChecker";
import type { AnimationClip, Object3D } from "three";
import { DirectorCommand } from "./DirectorCommand";
import type { DirectorContext, SerializedCommand } from "./DirectorCommand";
import type { CommandDispatcher } from "./CommandDispatcher";

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

interface MountActionPayload {
    objectId: string;
    actionId: string;
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
        ctx.scene.setObjectAction(this.payload.objectId, null);
        // 最后一个动作卸下后仍空转 always 渲染是浪费——回收时钟
        if (ctx.binder.isEmpty) ctx.clock.pause();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const actionId = ctx.scene.manager.getEntity(this.payload.objectId)?.actionId;
        return actionId
            ? [{ type: MountActionCommand.TYPE, payload: { objectId: this.payload.objectId, actionId } }]
            : null;
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

interface TransportSeekPayload {
    time: number;
}

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
        ctx.clock.seek(this.payload.time);
    }
}

export function registerActionCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(MountActionCommand.TYPE, (payload: MountActionPayload) => new MountActionCommand(payload));
    dispatcher.register(
        UnmountActionCommand.TYPE,
        (payload: UnmountActionPayload) => new UnmountActionCommand(payload),
    );
    dispatcher.register(TransportPlayCommand.TYPE, () => new TransportPlayCommand());
    dispatcher.register(TransportPauseCommand.TYPE, () => new TransportPauseCommand());
    dispatcher.register(
        TransportSeekCommand.TYPE,
        (payload: TransportSeekPayload) => new TransportSeekCommand(payload),
    );
}
