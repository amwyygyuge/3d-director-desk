import { BONE_MATCH_THRESHOLD } from "@/animation/BoneCompatibilityChecker";
import type { BoneCheckResult } from "@/animation/BoneCompatibilityChecker";
import {
    ActionPerformance,
    DEFAULT_ACTION_ATTACK_SECONDS,
    DEFAULT_ACTION_RELEASE_SECONDS,
} from "@/animation/ActionPerformance";
import { ActionAlignment, resolveActionRange } from "@/animation/ActionAlignment";
import { ACTION_FILL_POLICY, isActionFillPolicy } from "@/animation/ActionFillPolicy";
import type { ActionFillPolicy } from "@/animation/ActionFillPolicy";
import type { ActionAsset } from "@/assets/ActionAsset";
import { Bone } from "three";
import type { AnimationClip, Object3D } from "three";
import { createId } from "@/core/createId";
import { quantizeSeconds } from "@/command/timelineCommands";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import { EMPTY_PAYLOAD_CONTRACT } from "@/command/PayloadContract";
import type { PayloadContract } from "@/command/PayloadContract";
/**
 * 骨骼兼容预检缓存。
 *
 * 缓存键除了 root 本身还带「骨骼数」指纹:同一 root 在骨架绑定前后、
 * 或被换掉底下的 SkinnedMesh 时,缓存结果必须作废。只用 root 做键会把
 * 一次错误判定永久固化(表现为该实体此后永远报匹配率 0%)。
 *
 * 注意:这只是缓存自洽,**不是**「骨架是否就绪」的判据。调用方必须先用
 * `entityLoadState` 确认装载完成再来预检 —— 内容加载前的外层组骨骼数为 0,
 * 对它做检查得到的 0% 是无意义的(真实骨架其实 100% 匹配)。
 */
class BoneCompatibilityIndex {
    private readonly nodeNamesByRoot = new WeakMap<
        Object3D,
        { readonly names: ReadonlySet<string>; readonly bones: number }
    >();
    private readonly resultsByRoot = new WeakMap<
        Object3D,
        Map<AnimationClip, { readonly result: BoneCheckResult; readonly bones: number }>
    >();

    check(root: Object3D, clip: AnimationClip): BoneCheckResult {
        const bones = boneCount(root);
        const cached = this.resultsByRoot.get(root)?.get(clip);
        if (cached && cached.bones === bones) return cached.result;

        const nodeNames = this.nodeNames(root, bones);
        const targets = [...new Set(clip.tracks.map((track) => track.name.split(".")[0] ?? ""))].filter(Boolean);
        const missingTargets = targets.filter((name) => !nodeNames.has(name));
        const result = {
            matchedRatio: targets.length === 0 ? 0 : (targets.length - missingTargets.length) / targets.length,
            missingTargets,
            ok: targets.length > 0 && (targets.length - missingTargets.length) / targets.length >= BONE_MATCH_THRESHOLD,
        };
        const results =
            this.resultsByRoot.get(root) ?? new Map<AnimationClip, { result: BoneCheckResult; bones: number }>();
        results.set(clip, { result, bones });
        this.resultsByRoot.set(root, results);
        return result;
    }

    private nodeNames(root: Object3D, bones: number): ReadonlySet<string> {
        const cached = this.nodeNamesByRoot.get(root);
        if (cached && cached.bones === bones) return cached.names;
        const names = new Set<string>();
        root.traverse((node) => {
            if (node.name) names.add(node.name);
        });
        this.nodeNamesByRoot.set(root, { names, bones });
        return names;
    }
}

/** 缓存指纹:骨骼数。骨架绑定完成后由 0 变为实际值,用于判定缓存是否过期。 */
function boneCount(root: Object3D): number {
    let count = 0;
    root.traverse((node) => {
        if (node instanceof Bone) count++;
    });
    return count;
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

interface ActionSchedulePayload {
    /** 缺省 = 当前播放头;排期落点按工程帧率量化 */
    readonly startTimeSeconds?: number;
    /** 缺省 = clip 原始时长;排期时长按工程帧率量化 */
    readonly durationSeconds?: number;
    /** 从常驻姿势进入动作的过渡时长;缺省 0.2s */
    readonly attackSeconds?: number;
    /** once 结束后回常驻姿势的回收时长;缺省 0.25s */
    readonly releaseSeconds?: number;
    /**
     * 时段填充策略:段条比 clip 长时如何铺满。
     * repeat 按原速重复、hold 按原速播一次后钳末帧、stretch 变速铺满。
     * 缺省 = 跟随资产循环语义(loop → repeat,once → hold)。
     */
    readonly fillPolicy?: ActionFillPolicy;
}

interface MountActionPayload extends ActionSchedulePayload {
    objectId: string;
    actionId: string;
    /**
     * 排期段 id。缺省时命令自行生成——但撤销/重做与文档恢复必须显式传入,
     * 否则重放会换一个 id,时间轴选中态与 binder 里的 clip 会指向已消失的段。
     */
    readonly performanceId?: string;
    /**
     * 声明式对齐:把本动作的时段绑到某条走位轨的关键帧区间。
     * 给了它就不用给 startTimeSeconds/durationSeconds——轨道重定时后排期自动跟随。
     */
    readonly alignToTrack?: {
        readonly trackId: string;
        readonly fromKeyframeId?: string | null;
        readonly toKeyframeId?: string | null;
    };
    /** true = 替换该实体的全部动作(旧行为);缺省 false = 追加到动作序列。 */
    readonly replace?: boolean;
}

const ACTION_SCHEDULE_PROPERTIES = {
    startTimeSeconds: { type: "number" },
    durationSeconds: { type: "number" },
    attackSeconds: { type: "number" },
    releaseSeconds: { type: "number" },
    fillPolicy: { type: "string", enum: [...Object.values(ACTION_FILL_POLICY)] },
} as const;

const ALIGN_TO_TRACK_PROPERTY = {
    type: "object",
    properties: {
        trackId: { type: "string" },
        fromKeyframeId: { anyOf: [{ type: "string" }, { type: "null" }] },
        toKeyframeId: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["trackId"],
} as const;

const MOUNT_ACTION_CONTRACT: PayloadContract = {
    properties: {
        objectId: { type: "string" },
        actionId: { type: "string" },
        performanceId: { type: "string" },
        ...ACTION_SCHEDULE_PROPERTIES,
        alignToTrack: ALIGN_TO_TRACK_PROPERTY,
        replace: { type: "boolean" },
    },
    required: ["objectId", "actionId"],
};

interface ActionScheduleValues {
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
}
/**
 * 缺省起点:**播放头处已被占用就接到那一段的演出末端**,空着就落在播放头。
 *
 * 作者的动作是「把播放头停在这儿,连着排下一段」,而不是「排在播放头再自己去解决冲突」。
 * 旧行为直接取播放头,于是在已有段上排第二个动作必被重叠围栏拒——报错正确但没用,
 * 作者要的落点是唯一确定的(紧接末端),命令自己算得出来。
 *
 * 连续占用要一路跳到底(A 接 B 接 C 时停在 A 上排新段应落到 C 之后),故循环推进。
 * 只在**未显式给起点**时生效:显式 startTimeSeconds 是作者的直接指令,不代劳。
 *
 * 不为回收段预留空间:它是演出后的收势,可被下一段抢占、也可被片尾截断
 * (与重叠围栏同口径)。预留会让「动作正好演到片尾」排不进去。
 */
function scheduleValuesFor(
    ctx: DirectorContext,
    payload: ActionSchedulePayload,
    action: ActionAsset,
    existing: readonly ActionPerformance[] = [],
): ActionScheduleValues {
    const durationSeconds = quantizeSeconds(ctx, payload.durationSeconds ?? action.duration);
    const latestStart = Math.max(0, ctx.timeline.document.duration - durationSeconds);
    const requestedStart =
        payload.startTimeSeconds === undefined
            ? Math.min(appendStartFor(existing, ctx.clock.time), latestStart)
            : payload.startTimeSeconds;
    return { startTimeSeconds: quantizeSeconds(ctx, requestedStart), durationSeconds };
}

/** 从 `timeSeconds` 起跳过所有连续占用的演出段,返回第一个空位的起点。 */
function appendStartFor(existing: readonly ActionPerformance[], timeSeconds: number): number {
    let start = timeSeconds;
    // 每轮最多推进一段;段数有限,循环必然收敛
    for (let guard = 0; guard < existing.length; guard += 1) {
        const occupying = existing.find(
            (performance) => start >= performance.startTimeSeconds && start < performance.endTimeSeconds,
        );
        if (!occupying) return start;
        start = occupying.endTimeSeconds;
    }
    return start;
}

/**
 * 对齐 → 排期时段。返回 null 表示对齐解析不出时段(轨道/关键帧不存在,或区间零长),
 * 调用方据此报结构化 issue,而不是悄悄退回一个猜的时段。
 */
function alignedScheduleFor(ctx: DirectorContext, alignment: ActionAlignment): ActionScheduleValues | null {
    const track = ctx.timeline.document.tracks.find((candidate) => candidate.id === alignment.trackId) ?? null;
    const range = resolveActionRange(alignment, track);
    if (!range) return null;
    return {
        startTimeSeconds: quantizeSeconds(ctx, range.startTimeSeconds),
        durationSeconds: quantizeSeconds(ctx, range.durationSeconds),
    };
}

/**
 * 序列重叠检查:同一实体的动作排期不得在**演出段**上交叠。
 *
 * 按 `endTimeSeconds` 而非 `releaseEndTimeSeconds` 计价——回收段**允许被下一段抢占**。
 * 播放层本就是这么裁决的:`SceneObject.actionPerformanceAt` 与
 * `AnimationBinder.applySequenceTime` 都「倒序取最后一个已开始的段」,
 * 下一段一旦开始就赢,前一段的回收过渡自然让位(实测:A 回收至 3.25、B 起于 3.00,
 * t=3.10 生效的是 B)。围栏若按回收末端计价就比播放层更严,
 * 「走完立刻倒地」这种最普通的紧贴排期会被拒,而作者在时间轴上看到的是
 * 「明明贴上了却弹报错」——缝隙无从消除。
 *
 * `selfPerformanceId` 是正在写入的那一段,必须排除:重挂同一段(撤销重放、改时段)
 * 否则会与自己的旧时段判定为交叠而被拒。
 */
function overlappingPerformance(
    existing: readonly ActionPerformance[],
    selfPerformanceId: string | null,
    candidate: { readonly startTimeSeconds: number; readonly endTimeSeconds: number },
): ActionPerformance | null {
    for (const performance of existing) {
        if (performance.id === selfPerformanceId) continue;
        if (
            candidate.startTimeSeconds < performance.endTimeSeconds &&
            performance.startTimeSeconds < candidate.endTimeSeconds
        ) {
            return performance;
        }
    }
    return null;
}

function scheduleIssues(
    ctx: DirectorContext,
    payload: ActionSchedulePayload,
    values: ActionScheduleValues,
): readonly string[] {
    const frameDuration = ctx.timeline.document.frameRate.frameDurationSeconds;
    return [
        ...(payload.startTimeSeconds !== undefined &&
        (!Number.isFinite(payload.startTimeSeconds) || payload.startTimeSeconds < 0)
            ? ["动作开始时间必须是 ≥0 的有限秒数"]
            : []),
        ...(payload.durationSeconds !== undefined && !Number.isFinite(payload.durationSeconds)
            ? ["动作时长必须是有限秒数"]
            : []),
        ...(payload.attackSeconds !== undefined &&
        (!Number.isFinite(payload.attackSeconds) || payload.attackSeconds < 0)
            ? ["动作进入时长必须是 ≥0 的有限秒数"]
            : []),
        ...(payload.releaseSeconds !== undefined &&
        (!Number.isFinite(payload.releaseSeconds) || payload.releaseSeconds < 0)
            ? ["动作回收时长必须是 ≥0 的有限秒数"]
            : []),
        ...(values.durationSeconds < frameDuration ? ["动作时长必须至少覆盖一帧"] : []),
        // 只约束演出段:回收段是收势,越过片尾就截断(与重叠围栏、导入校验同口径)
        ...(values.startTimeSeconds + values.durationSeconds > ctx.timeline.document.duration
            ? ["动作时段不能超出时间轴时长"]
            : []),
    ];
}

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
): { readonly durationSeconds: number; readonly objectId: string; readonly loopMode: ActionAsset["loopMode"] } | null {
    const actionId = ctx.scene.manager.getEntity(objectId)?.actionId;
    const action = actionId ? ctx.animations.actions.find((candidate) => candidate.id === actionId) : undefined;
    return action ? { objectId, durationSeconds: action.duration, loopMode: action.loopMode } : null;
}

/**
 * 动作挂载:骨骼预检不过 → 结构化诊断(匹配率/缺失轨道/可用动作清单),AI 可据此重试。
 *
 * 默认**追加**到该实体的动作序列(`replace: true` 回到整表替换)。
 * 序列让「一次性 → 循环 → 一次性」这类表演可编排;同一实体的排期不得交叠(首尾相接允许)。
 */
export class MountActionCommand extends DirectorCommand<MountActionPayload> {
    static readonly TYPE = "action.mount";
    readonly type = MountActionCommand.TYPE;

    /**
     * 段 id 在构造期定下(而非 execute 内),因为 validate 的重叠围栏也要用它排除自己;
     * payload 显式给了就用它——撤销/重做与文档恢复靠这条保持段身份稳定。
     */
    private readonly performanceId: string;

    constructor(readonly payload: MountActionPayload) {
        super();
        this.performanceId = payload.performanceId ?? `action-performance-${createId()}`;
    }

    /** 重做必须复用同一段 id:换 id 会让选中态与 AI 手上的 performanceId 全部指空。 */
    override replayPayload(): MountActionPayload {
        return { ...this.payload, performanceId: this.performanceId };
    }

    validate(ctx: DirectorContext): string[] {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        if (!entity) return [`对象 "${this.payload.objectId}" 不存在`];
        if (entity.kind !== "model") return [`对象 "${this.payload.objectId}" 不是模型,无法挂动作`];
        const action = ctx.animations.actions.find((candidate) => candidate.id === this.payload.actionId);
        const clip = ctx.animations.getClip(this.payload.actionId);
        if (!action || !clip) return [`动作 "${this.payload.actionId}" 不在动作库`];
        const runtime = ctx.scene.manager.getRuntime(this.payload.objectId);
        if (!runtime) return [`对象 "${this.payload.objectId}" 运行时未就绪(模型加载中?)`];
        if (this.payload.alignToTrack) {
            const alignment = new ActionAlignment(this.payload.alignToTrack);
            if (!alignedScheduleFor(ctx, alignment)) {
                return [
                    `action-alignment-unresolved: 走位轨 "${alignment.trackId}" 不存在、关键帧 id 不匹配,` +
                        `或区间时长为零;先确认 timeline.get-document 里的 trackId 与关键帧 id`,
                ];
            }
        }
        const schedule = this.scheduleFor(ctx, action);
        if (!schedule) return ["action-alignment-unresolved: 对齐解析失败"];
        const scheduleIssuesFound = scheduleIssues(ctx, this.payload, schedule);
        if (scheduleIssuesFound.length > 0) return [...scheduleIssuesFound];
        if (this.payload.replace !== true) {
            const conflict = overlappingPerformance(entity.actionPerformances, this.performanceId, {
                startTimeSeconds: schedule.startTimeSeconds,
                // 只报演出段:本段的回收尾巴可以盖在下一段上,由播放裁决让位
                endTimeSeconds: schedule.startTimeSeconds + schedule.durationSeconds,
            });
            if (conflict) {
                return [
                    `action-overlapping-performance: 该时段与已有动作排期的演出段交叠` +
                        `(已有 ${conflict.startTimeSeconds.toFixed(2)}s → ${conflict.endTimeSeconds.toFixed(2)}s);` +
                        `改时段、或传 replace: true 覆盖全部动作`,
                ];
            }
        }

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
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        const runtime = ctx.scene.manager.getRuntime(this.payload.objectId);
        const action = ctx.animations.actions.find((candidate) => candidate.id === this.payload.actionId);
        const clip = ctx.animations.getClip(this.payload.actionId);
        if (!entity || !runtime || !action || !clip) return;
        const releaseSeconds = this.payload.releaseSeconds ?? DEFAULT_ACTION_RELEASE_SECONDS;
        const schedule = this.scheduleFor(ctx, action);
        if (!schedule) return;
        const performance = new ActionPerformance({
            id: this.performanceId,
            actionId: action.id,
            startTimeSeconds: schedule.startTimeSeconds,
            durationSeconds: schedule.durationSeconds,
            attackSeconds: this.payload.attackSeconds ?? DEFAULT_ACTION_ATTACK_SECONDS,
            releaseSeconds,
            fillPolicy: this.payload.fillPolicy ?? null,
            alignment: this.payload.alignToTrack ? new ActionAlignment(this.payload.alignToTrack) : null,
        });
        const isReplacing = this.payload.replace === true;
        if (isReplacing) ctx.binder.unmount(this.payload.objectId);
        // 同段 id 重放(撤销/重做)即替换那一段,不叠加
        const nextPerformances = isReplacing
            ? [performance]
            : [...entity.actionPerformances.filter((candidate) => candidate.id !== performance.id), performance];
        ctx.binder.mount(this.payload.objectId, runtime, clip, performance, action.loopMode);
        ctx.scene.setObjectActions(this.payload.objectId, nextPerformances);
        ctx.actionPreview.prepare({
            objectId: this.payload.objectId,
            durationSeconds: clip.duration,
            loopMode: action.loopMode,
        });
        ctx.playback.sampleCurrent();
    }

    /**
     * 对齐优先于显式排期:两者都给时以对齐为准(声明式意图更稳)。
     *
     * `replace` 会清空整表,那时缺省起点不该跳过即将被删的段——传空表让它落回播放头。
     */
    private scheduleFor(ctx: DirectorContext, action: ActionAsset): ActionScheduleValues | null {
        if (this.payload.alignToTrack) {
            return alignedScheduleFor(ctx, new ActionAlignment(this.payload.alignToTrack));
        }
        // 排除本段自己:撤销/重做重放同一段 id 时,它还在表里,不排除会被自己顶到末端之后
        const existing =
            this.payload.replace === true
                ? []
                : (ctx.scene.manager.getEntity(this.payload.objectId)?.actionPerformances ?? []).filter(
                      (candidate) => candidate.id !== this.performanceId,
                  );
        return scheduleValuesFor(ctx, this.payload, action, existing);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const previous = ctx.scene.manager.getEntity(this.payload.objectId)?.actionPerformances ?? [];
        // 追加的逆是「整表还原到追加前」:用 replace 重放首个 + 依次追加其余,避免逆命令自身触发重叠校验
        if (previous.length === 0) {
            return [{ type: UnmountActionCommand.TYPE, payload: { objectId: this.payload.objectId } }];
        }
        return previous.map((performance, index) => remountCommandFor(this.payload.objectId, performance, index === 0));
    }
}

/**
 * 重挂命令序列化(撤销/重做共用)。
 * 必须带上 alignment:否则撤销会把「对齐到走位轨」的排期悄悄降级成固定时段,
 * 之后再改轨道就不跟随了——一个只在 undo 之后才显形的静默退化。
 * 必须带上 performanceId:段 id 是时间轴选中态与 binder clip 的定位键,
 * 重放换 id 会让撤销后的段条指向不存在的段。
 */
function remountCommandFor(objectId: string, performance: ActionPerformance, isFirst: boolean): SerializedCommand {
    return {
        type: MountActionCommand.TYPE,
        payload: {
            objectId,
            actionId: performance.actionId,
            performanceId: performance.id,
            startTimeSeconds: performance.startTimeSeconds,
            durationSeconds: performance.durationSeconds,
            attackSeconds: performance.attackSeconds,
            releaseSeconds: performance.releaseSeconds,
            ...(performance.alignment ? { alignToTrack: performance.alignment.toJSON() } : {}),
            ...(isFirst ? { replace: true } : {}),
        },
    };
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
        ctx.scene.setObjectActions(this.payload.objectId, null);
        ctx.timelineSelection.forget(this.payload.objectId);
        if (ctx.binder.isEmpty) ctx.clock.pause();
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const performances = ctx.scene.manager.getEntity(this.payload.objectId)?.actionPerformances ?? [];
        if (performances.length === 0) return null;
        // 整表还原:首条带 replace 清干净,其余依次追加
        return performances.map((performance, index) =>
            remountCommandFor(this.payload.objectId, performance, index === 0),
        );
    }
}

interface UnmountActionPerformancePayload {
    readonly objectId: string;
    readonly performanceId: string;
}

const UNMOUNT_ACTION_PERFORMANCE_CONTRACT: PayloadContract = {
    properties: {
        objectId: { type: "string" },
        performanceId: { type: "string" },
    },
    required: ["objectId", "performanceId"],
};

/**
 * 卸载**一段**动作排期(时间轴上选中某个动作段按 Delete 的落点)。
 *
 * 与 `action.unmount` 的分工:后者清空该实体全部动作。多段序列下按段删除是常态操作,
 * 走整体卸载会把作者其余几段一并抹掉。
 */
export class UnmountActionPerformanceCommand extends DirectorCommand<UnmountActionPerformancePayload> {
    static readonly TYPE = "action.unmount-performance";
    readonly type = UnmountActionPerformanceCommand.TYPE;

    constructor(readonly payload: UnmountActionPerformancePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        if (!entity) return [`对象 "${this.payload.objectId}" 不存在`];
        return entity.actionPerformance(this.payload.performanceId)
            ? []
            : [
                  `action-performance-not-found: 对象 "${this.payload.objectId}" 没有排期段 "${this.payload.performanceId}"`,
              ];
    }

    execute(ctx: DirectorContext): void {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        if (!entity) return;
        const remaining = entity.actionPerformances.filter((candidate) => candidate.id !== this.payload.performanceId);
        ctx.binder.unmountPerformance(this.payload.objectId, this.payload.performanceId);
        ctx.scene.setObjectActions(this.payload.objectId, remaining);
        ctx.timelineSelection.forget(this.payload.performanceId);
        // 预览控制器绑的是「该对象有没有动作」,段全删完才清
        if (remaining.length === 0) ctx.actionPreview.clear(this.payload.objectId);
        if (ctx.binder.isEmpty) ctx.clock.pause();
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const performance = ctx.scene.manager
            .getEntity(this.payload.objectId)
            ?.actionPerformance(this.payload.performanceId);
        // 单段追加即可复原:其余段未被触碰,不需要整表重放
        return performance ? [remountCommandFor(this.payload.objectId, performance, false)] : null;
    }
}

interface SetActionRangePayload {
    readonly objectId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly attackSeconds?: number;
    readonly releaseSeconds?: number;
    /** 多段序列下定位要改的那一段;缺省改首条(单段时即唯一那条)。 */
    readonly performanceId?: string;
}

const SET_ACTION_RANGE_CONTRACT: PayloadContract = {
    properties: {
        objectId: { type: "string" },
        performanceId: { type: "string" },
        ...ACTION_SCHEDULE_PROPERTIES,
    },
    required: ["objectId", "startTimeSeconds", "durationSeconds"],
};
/** 动作排期重定时:时间轴段条拖拽与 AI 共用的唯一写入口。 */
export class SetActionRangeCommand extends DirectorCommand<SetActionRangePayload> {
    static readonly TYPE = "action.set-range";
    readonly type = SetActionRangeCommand.TYPE;

    constructor(readonly payload: SetActionRangePayload) {
        super();
    }
    validate(ctx: DirectorContext): string[] {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        const performance = entity ? this.targetPerformance(entity.actionPerformances) : null;
        const action = performance
            ? ctx.animations.actions.find((candidate) => candidate.id === performance.actionId)
            : undefined;
        if (!performance || !action) {
            return this.payload.performanceId === undefined
                ? [`对象 "${this.payload.objectId}" 没有已挂载动作`]
                : [
                      `action-performance-not-found: 对象 "${this.payload.objectId}" 没有排期段 ` +
                          `"${this.payload.performanceId}";用 scene.describe 的 actionSequence 查段 id`,
                  ];
        }
        const values = scheduleValuesFor(ctx, this.payload, action);
        const issues = scheduleIssues(ctx, this.payload, values);
        if (issues.length > 0) return [...issues];
        // 拖一段压到邻段的**演出段**上必须拒:静默交叠会让骨骼裁决错配。
        // 回收段不计入——它可被抢占,计了就没法紧贴(作者看到的是「贴上了却报错」)。
        const conflict = overlappingPerformance(entity?.actionPerformances ?? [], performance.id, {
            startTimeSeconds: values.startTimeSeconds,
            endTimeSeconds: values.startTimeSeconds + values.durationSeconds,
        });
        return conflict
            ? [
                  `action-overlapping-performance: 该时段与同实体另一段排期的演出段交叠` +
                      `(已有 ${conflict.startTimeSeconds.toFixed(2)}s → ${conflict.endTimeSeconds.toFixed(2)}s)`,
              ]
            : [];
    }

    execute(ctx: DirectorContext): void {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        if (!entity) return;
        const current = this.targetPerformance(entity.actionPerformances);
        if (!current) return;
        const transitioned = current.withTransitionSeconds(
            this.payload.attackSeconds === undefined
                ? current.attackSeconds
                : quantizeSeconds(ctx, this.payload.attackSeconds),
            this.payload.releaseSeconds === undefined
                ? current.releaseSeconds
                : quantizeSeconds(ctx, this.payload.releaseSeconds),
        );
        const next = transitioned.withRange(
            quantizeSeconds(ctx, this.payload.startTimeSeconds),
            quantizeSeconds(ctx, this.payload.durationSeconds),
        );
        ctx.scene.setObjectActions(
            this.payload.objectId,
            entity.actionPerformances.map((candidate) => (candidate.id === current.id ? next : candidate)),
        );
        ctx.binder.setScheduleFor(this.payload.objectId, next);
        ctx.playback.sampleCurrent();
    }

    /** 缺省改首条(单段时即唯一那条);给了 performanceId 就精确定位序列里的那一段。 */
    private targetPerformance(performances: readonly ActionPerformance[]): ActionPerformance | null {
        if (this.payload.performanceId === undefined) return performances[0] ?? null;
        return performances.find((candidate) => candidate.id === this.payload.performanceId) ?? null;
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        const current = entity ? this.targetPerformance(entity.actionPerformances) : null;
        return current
            ? [
                  {
                      type: SetActionRangeCommand.TYPE,
                      payload: {
                          objectId: this.payload.objectId,
                          startTimeSeconds: current.startTimeSeconds,
                          durationSeconds: current.durationSeconds,
                          attackSeconds: current.attackSeconds,
                          releaseSeconds: current.releaseSeconds,
                          ...(this.payload.performanceId === undefined
                              ? {}
                              : { performanceId: this.payload.performanceId }),
                      },
                  },
              ]
            : null;
    }
}

interface SetActionFillPolicyPayload {
    readonly objectId: string;
    /** 多段序列下定位要改的那一段;缺省改首条(单段时即唯一那条)。 */
    readonly performanceId?: string;
    /** null = 交还给资产循环语义决定(loop → repeat,once → hold)。 */
    readonly fillPolicy: ActionFillPolicy | null;
}

const SET_ACTION_FILL_POLICY_CONTRACT: PayloadContract = {
    properties: {
        objectId: { type: "string" },
        performanceId: { type: "string" },
        fillPolicy: {
            anyOf: [{ type: "string", enum: [...Object.values(ACTION_FILL_POLICY)] }, { type: "null" }],
        },
    },
    required: ["objectId", "fillPolicy"],
};

/**
 * 改某段排期的时段填充策略:时间轴选中态操作条与 AI 共用的唯一写入口。
 *
 * 不改时段本身——拉长/缩短走 action.set-range。这里只决定「已定的时段里 clip 怎么铺」,
 * 故不需要重叠围栏与时长校验:段的起止没动。
 */
export class SetActionFillPolicyCommand extends DirectorCommand<SetActionFillPolicyPayload> {
    static readonly TYPE = "action.set-fill-policy";
    readonly type = SetActionFillPolicyCommand.TYPE;

    constructor(readonly payload: SetActionFillPolicyPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        const performance = entity ? this.targetPerformance(entity.actionPerformances) : null;
        if (!performance) {
            return this.payload.performanceId === undefined
                ? [`对象 "${this.payload.objectId}" 没有已挂载动作`]
                : [
                      `action-performance-not-found: 对象 "${this.payload.objectId}" 没有排期段 ` +
                          `"${this.payload.performanceId}";用 scene.describe 的 actionSequence 查段 id`,
                  ];
        }
        return this.payload.fillPolicy === null || isActionFillPolicy(this.payload.fillPolicy)
            ? []
            : [`未知的时段填充策略:${String(this.payload.fillPolicy)}`];
    }

    execute(ctx: DirectorContext): void {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        if (!entity) return;
        const current = this.targetPerformance(entity.actionPerformances);
        if (!current) return;
        const next = current.withFillPolicy(this.payload.fillPolicy);
        ctx.scene.setObjectActions(
            this.payload.objectId,
            entity.actionPerformances.map((candidate) => (candidate.id === current.id ? next : candidate)),
        );
        // binder 按段取帧,策略变了要立刻换表,否则本帧仍按旧策略采样
        ctx.binder.setScheduleFor(this.payload.objectId, next);
        ctx.playback.sampleCurrent();
    }

    /** 缺省改首条(单段时即唯一那条);给了 performanceId 就精确定位序列里的那一段。 */
    private targetPerformance(performances: readonly ActionPerformance[]): ActionPerformance | null {
        if (this.payload.performanceId === undefined) return performances[0] ?? null;
        return performances.find((candidate) => candidate.id === this.payload.performanceId) ?? null;
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const entity = ctx.scene.manager.getEntity(this.payload.objectId);
        const current = entity ? this.targetPerformance(entity.actionPerformances) : null;
        return current
            ? [
                  {
                      type: SetActionFillPolicyCommand.TYPE,
                      payload: {
                          objectId: this.payload.objectId,
                          fillPolicy: current.fillPolicy,
                          ...(this.payload.performanceId === undefined
                              ? {}
                              : { performanceId: this.payload.performanceId }),
                      },
                  },
              ]
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
        UnmountActionPerformanceCommand.TYPE,
        (payload: UnmountActionPerformancePayload) => new UnmountActionPerformanceCommand(payload),
        capability(
            UnmountActionPerformanceCommand.TYPE,
            ACTION_EDIT_PERMISSION,
            ACTION_APPLIES_WHEN,
            UNMOUNT_ACTION_PERFORMANCE_CONTRACT,
        ),
    );
    dispatcher.register(
        SetActionRangeCommand.TYPE,
        (payload: SetActionRangePayload) => new SetActionRangeCommand(payload),
        capability(SetActionRangeCommand.TYPE, ACTION_EDIT_PERMISSION, ACTION_APPLIES_WHEN, SET_ACTION_RANGE_CONTRACT),
    );
    dispatcher.register(
        SetActionFillPolicyCommand.TYPE,
        (payload: SetActionFillPolicyPayload) => new SetActionFillPolicyCommand(payload),
        capability(
            SetActionFillPolicyCommand.TYPE,
            ACTION_EDIT_PERMISSION,
            ACTION_APPLIES_WHEN,
            SET_ACTION_FILL_POLICY_CONTRACT,
        ),
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
