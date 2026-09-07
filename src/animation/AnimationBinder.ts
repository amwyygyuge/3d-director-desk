import { AnimationMixer, LoopOnce, LoopRepeat, Quaternion } from "three";
import type { AnimationClip, Object3D } from "three";

import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import type { ActionLoopMode } from "@/assets/ActionAsset";
import type { ActionPerformance } from "@/animation/ActionPerformance";
import type { PoseSnapshot } from "@/pose/PoseSnapshot";
import type { SkeletonRuntimeRegistry } from "@/pose/SkeletonRuntimeRegistry";
import type { TimeTransport } from "@/time/TimeTransport";

interface MountedAction {
    readonly mixer: AnimationMixer;
    readonly clipDurationSeconds: number;
    readonly loopMode: ActionLoopMode;
    readonly boneKeys: readonly string[];
    performance: ActionPerformance;
}

const RELEASE_TARGET_QUATERNION = new Quaternion();

/**
 * 动作挂载协调器(领域服务):把动作 clip 绑定到场景对象的骨骼上。
 *
 * 时钟纪律:PlaybackCoordinator 按统一时钟调用 setTime，随后再执行时间轴、机位和姿态层；
 * bindTransport 仅为挂载时读取当前 playhead，不保留 update(delta) 自由播放路径。
 * 排期纪律:ActionPerformance 决定「全局时刻 → clip 局部时刻」;once 到尾钳住末帧，绝不 modulo 回首帧。
 */
export class AnimationBinder {
    private readonly mounted = new Map<string, MountedAction>();
    private transport: TimeTransport | null = null;

    constructor(private readonly skeletons: SkeletonRuntimeRegistry) {}

    /** PlaybackCoordinator owns the frame pipeline; this keeps current time for mount-time alignment only. */
    bindTransport(transport: TimeTransport): void {
        this.transport = transport;
    }

    mount(
        objectId: string,
        root: Object3D,
        clip: AnimationClip,
        performance: ActionPerformance,
        loopMode: ActionLoopMode,
    ): void {
        this.unmount(objectId);
        const mixer = new AnimationMixer(root);
        const action = mixer.clipAction(clip);
        action.setLoop(
            loopMode === ACTION_LOOP_MODE.LOOP ? LoopRepeat : LoopOnce,
            loopMode === ACTION_LOOP_MODE.LOOP ? Infinity : 1,
        );
        action.clampWhenFinished = true;
        action.play();
        const mounted: MountedAction = {
            mixer,
            clipDurationSeconds: clip.duration,
            loopMode,
            boneKeys: [...new Set(clip.tracks.map((track) => track.name.split(".")[0] ?? ""))].filter(Boolean),
            performance,
        };
        this.mounted.set(objectId, mounted);
        this.applyTimelineTime(mounted, this.transport?.time ?? 0);
    }

    unmount(objectId: string): void {
        const mounted = this.mounted.get(objectId);
        if (!mounted) return;
        mounted.mixer.stopAllAction();
        this.mounted.delete(objectId);
    }

    /** 切换工程时释放全部 mixer，但保留每桌共享时钟绑定。 */
    clear(): void {
        for (const id of [...this.mounted.keys()]) this.unmount(id);
    }

    /** 时间轴定位:把所有已挂载动作钉到绝对时间(订阅回调,逐帧调用须零分配) */
    setTime(timeSeconds: number): void {
        for (const mounted of this.mounted.values()) this.applyTimelineTime(mounted, timeSeconds);
    }

    /** 局部动作预览只推进目标 clip 的局部时间,不经过时间轴排期。 */
    setClipTimeFor(objectId: string, timeSeconds: number): void {
        this.mounted.get(objectId)?.mixer.setTime(timeSeconds);
    }

    /** once 回收段:先钉住动作末帧,再把动作写过的骨骼确定性混回常驻姿势。 */
    blendToBasePose(objectId: string, basePose: PoseSnapshot | null, progress: number): void {
        const mounted = this.mounted.get(objectId);
        if (!mounted || mounted.loopMode !== ACTION_LOOP_MODE.ONCE) return;
        mounted.mixer.setTime(mounted.clipDurationSeconds);
        const alpha = Math.min(Math.max(progress, 0), 1);
        for (const boneKey of mounted.boneKeys) {
            const bone = this.skeletons.getBone(objectId, boneKey);
            const target = basePose?.bones[boneKey] ?? this.skeletons.baselineRotationFor(objectId, boneKey);
            if (!bone || !target) continue;
            RELEASE_TARGET_QUATERNION.set(target[0], target[1], target[2], target[3]);
            bone.quaternion.slerp(RELEASE_TARGET_QUATERNION, alpha);
        }
    }

    /** 排期拖动/重定时后立即换表;下一次全局采样按新时段取值。 */
    setScheduleFor(objectId: string, performance: ActionPerformance): void {
        const mounted = this.mounted.get(objectId);
        if (!mounted) return;
        mounted.performance = performance;
        this.applyTimelineTime(mounted, this.transport?.time ?? 0);
    }

    /**
     * 步幅相位定位:phase = 已走弧长 ÷ 步幅,即「走了几步」。
     *
     * 它是位移的纯函数,不积累状态——scrub、倒放、跳帧都精确复现同一条腿的同一格,
     * 这正是不用 timeScale 逐帧缩放的原因(那会把动作相位变成播放历史的函数)。
     */
    setStridePhaseFor(objectId: string, phase: number): void {
        const mounted = this.mounted.get(objectId);
        if (!mounted || !Number.isFinite(phase)) return;
        mounted.mixer.setTime(phase * mounted.clipDurationSeconds);
    }

    has(objectId: string): boolean {
        return this.mounted.has(objectId);
    }

    get isEmpty(): boolean {
        return this.mounted.size === 0;
    }

    dispose(): void {
        this.clear();
        this.transport = null;
    }

    private applyTimelineTime(mounted: MountedAction, timeSeconds: number): void {
        const clipTime = mounted.performance.clipTimeAt(timeSeconds, mounted.clipDurationSeconds, mounted.loopMode);
        if (clipTime === null) return;
        mounted.mixer.setTime(clipTime);
    }
}
