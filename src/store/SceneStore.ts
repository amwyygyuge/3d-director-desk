import { makeAutoObservable } from "mobx";

import type { ModelFormat } from "../assets/ModelAsset";
import { SceneManager } from "../core/SceneManager";
import { SceneObject } from "../core/SceneObject";
import type { Transform } from "../core/SceneObject";

/**
 * 场景 Store(MobX 类):只放可观察的纯数据实体。
 * three 运行时对象永远在 SceneManager 的普通 Map 里,不进本 store(性能铁律)。
 *
 * 实例化纪律:不导出单例——Monet 画布可同时存在多个导演台节点,
 * 每个 DirectorDesk 实例持有一套自己的 stores(见 ui/DirectorDeskContext)。
 */
export class SceneStore {
    readonly manager = new SceneManager();

    constructor() {
        makeAutoObservable(this, { manager: false });
    }

    addObject(init: {
        id: string;
        kind: SceneObject["kind"];
        sourceUrl?: string;
        format?: ModelFormat | null;
        name?: string;
        transform?: Transform;
    }): SceneObject {
        const object = new SceneObject(init);
        this.manager.register(object);
        return object;
    }

    removeObject(id: string): void {
        this.manager.unregister(id);
    }

    updateTransform(id: string, transform: Transform): void {
        const entity = this.manager.getEntity(id);
        if (!entity) return;
        entity.applyTransform(transform);
    }
    setObjectAction(id: string, actionId: string | null): void {
        const entity = this.manager.getEntity(id);
        if (!entity) return;
        entity.applyAction(actionId);
    }

    get objectCount(): number {
        return this.manager.list().length;
    }
}
