import { makeAutoObservable } from "mobx";

import { SceneManager } from "../core/SceneManager";
import { SceneObject } from "../core/SceneObject";
import type { Transform } from "../core/SceneObject";

/**
 * 场景 Store(MobX 类):只放可观察的纯数据实体。
 * three 运行时对象永远在 SceneManager 的普通 Map 里,不进本 store(性能铁律)。
 */
export class SceneStore {
    readonly manager = new SceneManager();
    /** 实体版本号:transform 变更时递增,驱动 UI 细粒度刷新 */
    revision = 0;

    constructor() {
        makeAutoObservable(this, { manager: false });
    }

    addObject(init: { id: string; kind: SceneObject["kind"]; sourceUrl?: string }): SceneObject {
        const object = new SceneObject(init);
        this.manager.register(object);
        this.revision += 1;
        return object;
    }

    removeObject(id: string): void {
        this.manager.unregister(id);
        this.revision += 1;
    }

    updateTransform(id: string, transform: Transform): void {
        const entity = this.manager.getEntity(id);
        if (!entity) return;
        entity.applyTransform(transform);
        this.revision += 1;
    }

    get objectCount(): number {
        return this.manager.list().length;
    }
}

export const sceneStore = new SceneStore();
