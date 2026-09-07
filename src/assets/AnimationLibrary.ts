import { makeAutoObservable } from "mobx";
import type { AnimationClip } from "three";

import { ActionAsset } from "@/assets/ActionAsset";
import type { ActionLoopMode } from "@/assets/ActionAsset";
import { createId } from "@/core/createId";

/**
 * 动作库(仓储):已导入动作的注册表。
 * 双表设计(同 SceneManager 先例):actions 是可观察纯数据;clips 是 three 运行时引用,不进 observable。
 * clip 是纯数据轨道(无 GL 资源),缓存于库内,生命周期随库。
 */
export class AnimationLibrary {
    readonly actions: ActionAsset[] = [];
    private readonly clips = new Map<string, AnimationClip>();

    constructor() {
        makeAutoObservable<AnimationLibrary, "clips">(this, { clips: false });
    }

    register(init: { name: string; url: string; clip: AnimationClip; loopMode: ActionLoopMode }): {
        action: ActionAsset;
        duplicate: boolean;
    } {
        const existing = this.actions.find((a) => a.name === init.name);
        if (existing) return { action: existing, duplicate: true };

        const action = new ActionAsset({
            id: `action-${createId()}`,
            name: init.name,
            url: init.url,
            duration: init.clip.duration,
            loopMode: init.loopMode,
            trackNames: init.clip.tracks.map((track) => track.name),
        });
        this.actions.push(action);
        this.clips.set(action.id, init.clip);
        return { action, duplicate: false };
    }

    getClip(actionId: string): AnimationClip | undefined {
        return this.clips.get(actionId);
    }
    /** 切换工程时释放当前动作仓储，避免旧动作条目与运行时 clip 残留。 */
    clear(): void {
        for (const action of this.actions) URL.revokeObjectURL(action.url);
        this.actions.length = 0;
        this.clips.clear();
    }

    /** 卸载时回收动作文件创建的 blob URL */
    dispose(): void {
        this.clear();
    }
}
