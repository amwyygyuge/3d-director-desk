import { AnimationMixer, LoopOnce, LoopRepeat, Quaternion } from "three";
import type { AnimationAction, AnimationClip, Object3D } from "three";

import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import type { ActionLoopMode } from "@/assets/ActionAsset";
import type { ActionPerformance } from "@/animation/ActionPerformance";
import type { PoseSnapshot } from "@/pose/PoseSnapshot";
import type { SkeletonRuntimeRegistry } from "@/pose/SkeletonRuntimeRegistry";
import type { TimeTransport } from "@/time/TimeTransport";

interface MountedClip {
    /** 排期段身份;同一 actionId 可有多段,故 clip 按段 id 索引而非 actionId。 */
    readonly performanceId: string;
    readonly actionId: string;
    /**
     * 建立 mixer 时的运行时根。画质档切换会重建 Canvas,模型壳整体换成新克隆体,
     * 旧 mixer 绑的是已脱离场景树的骨骼——据此判断是否需要重绑。
     */
    readonly root: Object3D;
    readonly mixer: AnimationMixer;
    readonly action: AnimationAction;
    readonly clipDurationSeconds: number;
    readonly loopMode: ActionLoopMode;
    readonly boneKeys: readonly string[];
    performance: ActionPerformance;
    isActive: boolean;
}

/** 每个对象的动作序列:按 startTimeSeconds 升序,同一时刻至多一个 clip 生效。 */
interface MountedSequence {
    clips: MountedClip[];
    /** 上一帧生效的段 id,用于切换时把旧 clip 停到零权重(避免两个 mixer 同时写骨骼)。 */
    activePerformanceId: string | null;
}

const RELEASE_TARGET_QUATERNION = new Quaternion();

/**
 * 动作挂载协调器(领域服务):把动作 clip 绑定到场景对象的骨骼上。
 *
 * 时钟纪律:PlaybackCoordinator 按统一时钟调用 setTime，随后再执行时间轴、机位和姿态层；
 * bindTransport 仅为挂载时读取当前 playhead，不保留 update(delta) 自由播放路径。
 * 排期纪律:ActionPerformance 决定「全局时刻 → clip 局部时刻」;once 到尾钳住末帧，绝不 modulo 回首帧。
 * 序列纪律:一个对象可挂多个 clip(一次性 → 循环 → 一次性),按排期在同一时刻只让一个生效——
 * 两个 mixer 同时写同一根骨头会打架,故切换时显式把旧 clip 停掉。
 */
export class AnimationBinder {
    private readonly mounted = new Map<string, MountedSequence>();
    private transport: TimeTransport | null = null;

    constructor(private readonly skeletons: SkeletonRuntimeRegistry) {}

    /** PlaybackCoordinator owns the frame pipeline; this keeps current time for mount-time alignment only. */
    bindTransport(transport: TimeTransport): void {
        this.transport = transport;
    }

    /** 追加一个 clip 到对象的动作序列;同一段 id 的重复挂载会被替换而不是叠加。 */
    mount(
        objectId: string,
        root: Object3D,
        clip: AnimationClip,
        performance: ActionPerformance,
        loopMode: ActionLoopMode,
    ): void {
        const mountedClip = this.createClip(root, clip, performance, loopMode);
        const sequence = this.mounted.get(objectId) ?? { clips: [], activePerformanceId: null };
        const existingIndex = sequence.clips.findIndex((candidate) => candidate.performanceId === performance.id);
        if (existingIndex >= 0) {
            sequence.clips[existingIndex]?.mixer.stopAllAction();
            sequence.clips[existingIndex] = mountedClip;
        } else {
            sequence.clips.push(mountedClip);
        }
        sequence.clips.sort((left, right) => left.performance.startTimeSeconds - right.performance.startTimeSeconds);
        this.mounted.set(objectId, sequence);
        this.applySequenceTime(sequence, this.transport?.time ?? 0);
    }

    /**
     * 运行时换体后的重绑:画质档切换会重建 WebGL 上下文,R3F 整棵场景树重挂载,
     * 模型壳是新克隆体,而排期落账在实体上(不会重放 action.mount)。
     * 旧 mixer 仍绑着已弃用的骨骼节点,于是「时间轴有段条、播放无动作」。
     * 已绑同一根时直接返回:每帧/每次采样调用都必须是零分配空操作。
     */
    rebindRuntime(objectId: string, root: Object3D): void {
        const sequence = this.mounted.get(objectId);
        if (!sequence) return;
        if (sequence.clips.every((candidate) => candidate.root === root)) return;
        sequence.clips = sequence.clips.map((stale) => {
            if (stale.root === root) return stale;
            stale.mixer.stopAllAction();
            return this.createClip(root, stale.action.getClip(), stale.performance, stale.loopMode);
        });
        sequence.activePerformanceId = null;
        this.applySequenceTime(sequence, this.transport?.time ?? 0);
    }

    /** 卸载对象的全部动作。 */
    unmount(objectId: string): void {
        const sequence = this.mounted.get(objectId);
        if (!sequence) return;
        for (const clip of sequence.clips) clip.mixer.stopAllAction();
        this.mounted.delete(objectId);
    }

    /** 卸载序列中的一段排期(按段 id 定位);序列空了即整体卸载。 */
    unmountPerformance(objectId: string, performanceId: string): void {
        const sequence = this.mounted.get(objectId);
        if (!sequence) return;
        const index = sequence.clips.findIndex((candidate) => candidate.performanceId === performanceId);
        if (index < 0) return;
        sequence.clips[index]?.mixer.stopAllAction();
        sequence.clips.splice(index, 1);
        if (sequence.activePerformanceId === performanceId) sequence.activePerformanceId = null;
        if (sequence.clips.length === 0) this.mounted.delete(objectId);
    }

    /** 切换工程时释放全部 mixer，但保留每桌共享时钟绑定。 */
    clear(): void {
        for (const id of [...this.mounted.keys()]) this.unmount(id);
    }

    /** 时间轴定位:把所有已挂载动作钉到绝对时间(订阅回调,逐帧调用须零分配) */
    setTime(timeSeconds: number): void {
        for (const sequence of this.mounted.values()) this.applySequenceTime(sequence, timeSeconds);
    }

    /** 局部动作预览只推进目标 clip 的局部时间,不经过时间轴排期。 */
    setClipTimeFor(objectId: string, timeSeconds: number): void {
        const clip = this.firstClipFor(objectId);
        if (!clip) return;
        this.ensureActive(clip);
        clip.mixer.setTime(timeSeconds);
    }

    /** 动作进入/回收共用:baseWeight=0 完全按动作,1 完全回常驻姿势。作用于当前生效的 clip。 */
    blendActionWithBasePose(objectId: string, basePose: PoseSnapshot | null, baseWeight: number): void {
        const clip = this.activeClipFor(objectId);
        if (!clip) return;
        const alpha = Math.min(Math.max(baseWeight, 0), 1);
        for (const boneName of clip.boneKeys) {
            const boneKey = this.skeletons.boneKeyForName(objectId, boneName);
            if (!boneKey) continue;
            const bone = this.skeletons.getBone(objectId, boneKey);
            const target = basePose?.bones[boneKey] ?? this.skeletons.baselineRotationFor(objectId, boneKey);
            if (!bone || !target) continue;
            RELEASE_TARGET_QUATERNION.set(target[0], target[1], target[2], target[3]);
            bone.quaternion.slerp(RELEASE_TARGET_QUATERNION, alpha);
        }
    }

    /** 排期拖动/重定时后立即换表;下一次全局采样按新时段取值。按段 id 定位,不再猜首条。 */
    setScheduleFor(objectId: string, performance: ActionPerformance): void {
        const sequence = this.mounted.get(objectId);
        if (!sequence) return;
        const clip = sequence.clips.find((candidate) => candidate.performanceId === performance.id);
        if (!clip) return;
        clip.performance = performance;
        sequence.clips.sort((left, right) => left.performance.startTimeSeconds - right.performance.startTimeSeconds);
        this.applySequenceTime(sequence, this.transport?.time ?? 0);
    }

    /**
     * 步幅相位定位:phase = 已走弧长 ÷ 步幅,即「走了几步」。
     *
     * 它是位移的纯函数,不积累状态——scrub、倒放、跳帧都精确复现同一条腿的同一格,
     * 这正是不用 timeScale 逐帧缩放的原因(那会把动作相位变成播放历史的函数)。
     * 只驱动当前生效的 clip:走位区间外(如倒地段)不该被步频改写。
     */
    setStridePhaseFor(objectId: string, phase: number): void {
        const clip = this.activeClipFor(objectId);
        if (!clip || !Number.isFinite(phase)) return;
        this.ensureActive(clip);
        clip.mixer.setTime(phase * clip.clipDurationSeconds);
    }

    has(objectId: string): boolean {
        return this.mounted.has(objectId);
    }

    /** 当前生效 clip 的循环语义;无生效 clip 时回退到序列首个(排期外的 release 判定仍需它)。 */
    loopModeFor(objectId: string): ActionLoopMode | null {
        return (this.activeClipFor(objectId) ?? this.firstClipFor(objectId))?.loopMode ?? null;
    }

    /** 某段排期的循环语义;PlaybackCoordinator 按采样时刻选出段后用它判 release。 */
    loopModeAt(objectId: string, performanceId: string): ActionLoopMode | null {
        const sequence = this.mounted.get(objectId);
        return sequence?.clips.find((candidate) => candidate.performanceId === performanceId)?.loopMode ?? null;
    }

    get isEmpty(): boolean {
        return this.mounted.size === 0;
    }

    dispose(): void {
        this.clear();
        this.transport = null;
    }

    private firstClipFor(objectId: string): MountedClip | null {
        return this.mounted.get(objectId)?.clips[0] ?? null;
    }

    /** mixer/action 的唯一建立处:首次挂载与运行时换体后的重绑共用同一套循环与钳制语义。 */
    private createClip(
        root: Object3D,
        clip: AnimationClip,
        performance: ActionPerformance,
        loopMode: ActionLoopMode,
    ): MountedClip {
        const mixer = new AnimationMixer(root);
        const action = mixer.clipAction(clip);
        action.setLoop(
            loopMode === ACTION_LOOP_MODE.LOOP ? LoopRepeat : LoopOnce,
            loopMode === ACTION_LOOP_MODE.LOOP ? Infinity : 1,
        );
        action.clampWhenFinished = true;
        action.play();
        return {
            performanceId: performance.id,
            actionId: performance.actionId,
            root,
            mixer,
            action,
            clipDurationSeconds: clip.duration,
            loopMode,
            boneKeys: [...new Set(clip.tracks.map((track) => track.name.split(".")[0] ?? ""))].filter(Boolean),
            performance,
            isActive: false,
        };
    }

    private activeClipFor(objectId: string): MountedClip | null {
        const sequence = this.mounted.get(objectId);
        if (!sequence) return null;
        const activeId = sequence.activePerformanceId;
        if (activeId === null) return null;
        return sequence.clips.find((candidate) => candidate.performanceId === activeId) ?? null;
    }

    /**
     * 序列定位:选出该时刻生效的 clip 并只驱动它。
     *
     * 「生效」= 时刻落在 [start, releaseEnd] 内;多个区间重叠时取最后一个已开始的
     * (与 SceneObject.actionPerformanceAt 同一裁决,两处必须一致,否则骨骼与混合权重会错配)。
     */
    private applySequenceTime(sequence: MountedSequence, timeSeconds: number): void {
        let active: MountedClip | null = null;
        for (let index = sequence.clips.length - 1; index >= 0; index -= 1) {
            const candidate = sequence.clips[index];
            if (!candidate) continue;
            const performance = candidate.performance;
            if (timeSeconds >= performance.startTimeSeconds && timeSeconds <= performance.releaseEndTimeSeconds) {
                active = candidate;
                break;
            }
        }
        for (const clip of sequence.clips) {
            if (clip === active) continue;
            // 非生效 clip 必须停权重:两个 mixer 同时写骨骼会互相覆盖
            if (clip.isActive) {
                clip.action.stop();
                clip.isActive = false;
            }
        }
        sequence.activePerformanceId = active?.performanceId ?? null;
        if (!active) return;
        const clipTime = active.performance.clipTimeAt(timeSeconds, active.clipDurationSeconds, active.loopMode);
        if (clipTime === null) {
            active.isActive = false;
            sequence.activePerformanceId = null;
            return;
        }
        this.ensureActive(active);
        active.mixer.setTime(clipTime);
    }

    /** LoopOnce 播完后会停在 paused 态;绝对采样前必须 reset，才能稳定重放/保持末帧。 */
    private ensureActive(clip: MountedClip): void {
        if (clip.isActive && !clip.action.paused) return;
        clip.action.reset();
        clip.action.play();
        clip.mixer.setTime(0);
        clip.isActive = true;
    }
}
