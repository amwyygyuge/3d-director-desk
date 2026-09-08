import { AnimationMixer, LoopOnce, LoopRepeat, Quaternion } from "three";
import type { AnimationAction, AnimationClip, Object3D } from "three";

import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import type { ActionLoopMode } from "@/assets/ActionAsset";
import type { ActionPerformance } from "@/animation/ActionPerformance";
import type { PoseSnapshot } from "@/pose/PoseSnapshot";
import type { SkeletonRuntimeRegistry } from "@/pose/SkeletonRuntimeRegistry";
import type { TimeTransport } from "@/time/TimeTransport";

interface MountedClip {
    readonly actionId: string;
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
    /** 上一帧生效的 clip,用于切换时把旧 clip 停到零权重(避免两个 mixer 同时写骨骼)。 */
    activeActionId: string | null;
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

    /** 追加一个 clip 到对象的动作序列;同 actionId 且同排期起点的重复挂载会被替换而不是叠加。 */
    mount(
        objectId: string,
        root: Object3D,
        clip: AnimationClip,
        performance: ActionPerformance,
        loopMode: ActionLoopMode,
    ): void {
        const mixer = new AnimationMixer(root);
        const action = mixer.clipAction(clip);
        action.setLoop(
            loopMode === ACTION_LOOP_MODE.LOOP ? LoopRepeat : LoopOnce,
            loopMode === ACTION_LOOP_MODE.LOOP ? Infinity : 1,
        );
        action.clampWhenFinished = true;
        action.play();
        const mountedClip: MountedClip = {
            actionId: performance.actionId,
            mixer,
            action,
            clipDurationSeconds: clip.duration,
            loopMode,
            boneKeys: [...new Set(clip.tracks.map((track) => track.name.split(".")[0] ?? ""))].filter(Boolean),
            performance,
            isActive: false,
        };
        const sequence = this.mounted.get(objectId) ?? { clips: [], activeActionId: null };
        const existingIndex = sequence.clips.findIndex(
            (candidate) =>
                candidate.actionId === performance.actionId &&
                candidate.performance.startTimeSeconds === performance.startTimeSeconds,
        );
        if (existingIndex >= 0) {
            sequence.clips[existingIndex]?.mixer.stopAllAction();
            sequence.clips[existingIndex] = mountedClip;
        } else {
            sequence.clips.push(mountedClip);
        }
        sequence.clips.sort(
            (left, right) => left.performance.startTimeSeconds - right.performance.startTimeSeconds,
        );
        this.mounted.set(objectId, sequence);
        this.applySequenceTime(sequence, this.transport?.time ?? 0);
    }

    /** 卸载对象的全部动作。 */
    unmount(objectId: string): void {
        const sequence = this.mounted.get(objectId);
        if (!sequence) return;
        for (const clip of sequence.clips) clip.mixer.stopAllAction();
        this.mounted.delete(objectId);
    }

    /** 卸载序列中的一个动作(按 actionId + 排期起点定位);序列空了即整体卸载。 */
    unmountPerformance(objectId: string, actionId: string, startTimeSeconds: number): void {
        const sequence = this.mounted.get(objectId);
        if (!sequence) return;
        const index = sequence.clips.findIndex(
            (candidate) =>
                candidate.actionId === actionId && candidate.performance.startTimeSeconds === startTimeSeconds,
        );
        if (index < 0) return;
        sequence.clips[index]?.mixer.stopAllAction();
        sequence.clips.splice(index, 1);
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

    /** 排期拖动/重定时后立即换表;下一次全局采样按新时段取值。 */
    setScheduleFor(objectId: string, performance: ActionPerformance): void {
        const sequence = this.mounted.get(objectId);
        if (!sequence) return;
        const clip =
            sequence.clips.find((candidate) => candidate.actionId === performance.actionId) ?? sequence.clips[0];
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

    /** 某时刻生效动作的循环语义;PlaybackCoordinator 按采样时刻判 release 段用它。 */
    loopModeAt(objectId: string, actionId: string): ActionLoopMode | null {
        const sequence = this.mounted.get(objectId);
        return sequence?.clips.find((candidate) => candidate.actionId === actionId)?.loopMode ?? null;
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

    private activeClipFor(objectId: string): MountedClip | null {
        const sequence = this.mounted.get(objectId);
        if (!sequence) return null;
        const activeId = sequence.activeActionId;
        if (activeId === null) return null;
        return sequence.clips.find((candidate) => candidate.actionId === activeId) ?? null;
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
        sequence.activeActionId = active?.actionId ?? null;
        if (!active) return;
        const clipTime = active.performance.clipTimeAt(timeSeconds, active.clipDurationSeconds, active.loopMode);
        if (clipTime === null) {
            active.isActive = false;
            sequence.activeActionId = null;
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
