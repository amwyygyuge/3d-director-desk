import type { AnimationClip, Object3D } from "three";
import { AnimationMixer } from "three";

/**
 * 动作挂载协调器(领域服务):把动作 clip 绑定到场景对象的骨骼上。
 *
 * 游戏模型骨骼结构各异(人形/四足/机械),重定向策略属阶段一难点,
 * 此处仅承载「同构骨骼直接挂载」;重定向配置表由 RetargetStrategy 扩展点接入。
 *
 * 性能铁律:mixer 的逐帧驱动走渲染循环(delta),不走 React state。
 */
export class AnimationBinder {
    private readonly mixers = new Map<string, AnimationMixer>();

    mount(objectId: string, root: Object3D, clip: AnimationClip): void {
        this.unmount(objectId);
        const mixer = new AnimationMixer(root);
        const action = mixer.clipAction(clip);
        action.play();
        this.mixers.set(objectId, mixer);
    }

    unmount(objectId: string): void {
        const mixer = this.mixers.get(objectId);
        if (!mixer) return;
        mixer.stopAllAction();
        this.mixers.delete(objectId);
    }

    /** 由渲染循环每帧调用;零分配,delta 外部传入 */
    update(deltaSeconds: number): void {
        for (const mixer of this.mixers.values()) mixer.update(deltaSeconds);
    }

    has(objectId: string): boolean {
        return this.mixers.has(objectId);
    }

    dispose(): void {
        for (const id of [...this.mixers.keys()]) this.unmount(id);
    }
}
