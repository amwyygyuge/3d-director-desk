import { makeAutoObservable, observable, values } from "mobx";
import type { Object3D } from "three";

import { DisposeBag } from "@/core/DisposeBag";
import { type SceneObject } from "@/core/SceneObject";

/**
 * 场景管理器:场景对象的身份注册、查询与生命周期编排。
 *
 * 双注册表设计(性能铁律):
 * - entities:纯数据实体,可进 MobX;
 * - runtimes:three Object3D 运行时引用,普通 Map,永不进 observable。
 */
export class SceneManager {
    private readonly entities = observable.map<string, SceneObject>();
    private readonly runtimes = new Map<string, Object3D>();
    private readonly disposeBag = new DisposeBag();
    constructor() {
        // entities 是响应式事实源(列表渲染追踪 key 集);runtimes/disposeBag 永不进 observable(性能铁律)
        makeAutoObservable<SceneManager, "runtimes" | "disposeBag">(this, { runtimes: false, disposeBag: false });
    }

    register(entity: SceneObject): void {
        if (this.entities.has(entity.id)) {
            throw new Error(`SceneManager: duplicate object id "${entity.id}"`);
        }
        this.entities.set(entity.id, entity);
    }

    bindRuntime(id: string, object3d: Object3D): void {
        if (!this.entities.has(id)) {
            throw new Error(`SceneManager: bindRuntime for unknown id "${id}"`);
        }
        this.runtimes.set(id, object3d);
    }

    getEntity(id: string): SceneObject | undefined {
        return this.entities.get(id);
    }

    getRuntime(id: string): Object3D | undefined {
        return this.runtimes.get(id);
    }
    /** 仅解除运行时绑定(React 卸载 ref 回调用);实体仍保留,与 unregister 区分 */
    unbindRuntime(id: string): void {
        this.runtimes.delete(id);
    }

    list(): readonly SceneObject[] {
        return values(this.entities);
    }
    /**
     * 文档替换的提交边界:退场实体的 Three 运行时立即摘除,留任实体只解绑不摘除——
     * 它们的渲染体由 React 持有,新实体实例落到同一 id 上时渲染层会重新绑定;
     * 若在此处一并 removeFromParent,留任模型会被摘出场景树且再也无人挂回。
     */
    replaceEntities(entities: readonly SceneObject[]): void {
        const survivingIds = new Set(entities.map((entity) => entity.id));
        for (const [id, runtime] of this.runtimes) {
            if (!survivingIds.has(id)) runtime.removeFromParent();
        }
        this.runtimes.clear();
        this.entities.replace(entities.map((entity) => [entity.id, entity]));
    }

    unregister(id: string): void {
        const runtime = this.runtimes.get(id);
        if (runtime) {
            runtime.removeFromParent();
            this.runtimes.delete(id);
        }
        this.entities.delete(id);
    }

    dispose(): void {
        for (const id of [...this.runtimes.keys()]) this.unregister(id);
        this.entities.clear();
        this.disposeBag.dispose();
    }
}
