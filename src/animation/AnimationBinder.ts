import type { AnimationClip, Object3D } from "three";
import { AnimationMixer } from "three";

import type { TimeTransport } from "@/time/TimeTransport";

/**
 * 动作挂载协调器(领域服务):把动作 clip 绑定到场景对象的骨骼上。
 *
 * 时钟纪律:PlaybackCoordinator 按统一时钟调用 setTime，随后再执行时间轴、机位和姿态层；
 * bindTransport 仅为挂载时读取当前 playhead，不保留 update(delta) 自由播放路径。
 *
 * 游戏模型骨骼结构各异(人形/四足/机械)，此处只承载同构 clip 挂载。
 */
export class AnimationBinder {
    private readonly mixers = new Map<string, AnimationMixer>();
    /** 循环时长按对象缓存:相位换算要用它,不必每帧回问 mixer 的 action 表 */
    private readonly clipDurations = new Map<string, number>();
    private transport: TimeTransport | null = null;

    /** PlaybackCoordinator owns the frame pipeline; this keeps current time for mount-time alignment only. */
    bindTransport(transport: TimeTransport): void {
        this.transport = transport;
    }

    mount(objectId: string, root: Object3D, clip: AnimationClip): void {
        this.unmount(objectId);
        const mixer = new AnimationMixer(root);
        const action = mixer.clipAction(clip);
        action.play();
        this.mixers.set(objectId, mixer);
        this.clipDurations.set(objectId, clip.duration);
        // 挂上即对齐当前 playhead:暂停态挂载也能立刻呈现正确帧,不必等下一次 tick
        mixer.setTime(this.transport?.time ?? 0);
    }

    unmount(objectId: string): void {
        const mixer = this.mixers.get(objectId);
        if (!mixer) return;
        mixer.stopAllAction();
        this.mixers.delete(objectId);
        this.clipDurations.delete(objectId);
    }
    /** 切换工程时释放全部 mixer，但保留每桌共享时钟绑定。 */
    clear(): void {
        for (const id of [...this.mixers.keys()]) this.unmount(id);
    }

    /** 时间轴定位:把所有已挂载动作钉到绝对时间(订阅回调,逐帧调用须零分配) */
    setTime(timeSeconds: number): void {
        for (const mixer of this.mixers.values()) mixer.setTime(timeSeconds);
    }

    /** 模型级动作预览只推进目标 mixer，避免多个模型被同一预览按钮联动。 */
    setTimeFor(objectId: string, timeSeconds: number): void {
        this.mixers.get(objectId)?.setTime(timeSeconds);
    }

    /**
     * 步幅相位定位:phase = 已走弧长 ÷ 步幅,即「走了几步」。
     *
     * 它是位移的纯函数,不积累状态——scrub、倒放、跳帧都精确复现同一条腿的同一格,
     * 这正是不用 timeScale 逐帧缩放的原因(那会把动作相位变成播放历史的函数)。
     */
    setStridePhaseFor(objectId: string, phase: number): void {
        const duration = this.clipDurations.get(objectId);
        if (duration === undefined || !Number.isFinite(phase)) return;
        this.mixers.get(objectId)?.setTime(phase * duration);
    }

    has(objectId: string): boolean {
        return this.mixers.has(objectId);
    }

    get isEmpty(): boolean {
        return this.mixers.size === 0;
    }
    dispose(): void {
        this.clear();
        this.transport = null;
    }
}
