import type { AnimationClip, Object3D } from "three";
import { AnimationMixer } from "three";

import type { TimeTransport } from "../time/TimeTransport";

/**
 * 动作挂载协调器(领域服务):把动作 clip 绑定到场景对象的骨骼上。
 *
 * 时钟纪律:mixer 由统一时钟驱动——bindTransport 订阅 playhead,
 * tick(播放逐帧)与 seek(scrub)统一收敛为绝对时间 setTime,语义不分叉;
 * 不再保留 update(delta) 自由播放路径。
 *
 * 游戏模型骨骼结构各异(人形/四足/机械),此处仅承载「同构骨骼直接挂载」;
 * 重定向配置表由 RetargetStrategy 扩展点接入(专项)。
 */
export class AnimationBinder {
    private readonly mixers = new Map<string, AnimationMixer>();
    private transport: TimeTransport | null = null;
    private unsubscribeTransport: (() => void) | null = null;

    /** 接入统一时钟;重复调用先解旧订阅 */
    bindTransport(transport: TimeTransport): void {
        this.unsubscribeTransport?.();
        this.transport = transport;
        this.unsubscribeTransport = transport.subscribe((timeSeconds) => this.setTime(timeSeconds));
    }

    mount(objectId: string, root: Object3D, clip: AnimationClip): void {
        this.unmount(objectId);
        const mixer = new AnimationMixer(root);
        const action = mixer.clipAction(clip);
        action.play();
        this.mixers.set(objectId, mixer);
        // 挂上即对齐当前 playhead:暂停态挂载也能立刻呈现正确帧,不必等下一次 tick
        mixer.setTime(this.transport?.time ?? 0);
    }

    unmount(objectId: string): void {
        const mixer = this.mixers.get(objectId);
        if (!mixer) return;
        mixer.stopAllAction();
        this.mixers.delete(objectId);
    }

    /** 时间轴定位:把所有已挂载动作钉到绝对时间(订阅回调,逐帧调用须零分配) */
    setTime(timeSeconds: number): void {
        for (const mixer of this.mixers.values()) mixer.setTime(timeSeconds);
    }

    has(objectId: string): boolean {
        return this.mixers.has(objectId);
    }

    get isEmpty(): boolean {
        return this.mixers.size === 0;
    }

    dispose(): void {
        this.unsubscribeTransport?.();
        this.unsubscribeTransport = null;
        this.transport = null;
        for (const id of [...this.mixers.keys()]) this.unmount(id);
    }
}
