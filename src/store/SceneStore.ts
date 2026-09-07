import { makeAutoObservable } from "mobx";

import type { ActorProfile } from "@/actor/ActorProfile";
import type { ActionPerformance } from "@/animation/ActionPerformance";
import { SceneManager } from "@/core/SceneManager";
import { SceneObject } from "@/core/SceneObject";
import type { LightParams } from "@/core/LightParams";
import type { PoseSnapshot } from "@/pose/PoseSnapshot";
import type { SceneObjectInit, Transform } from "@/core/SceneObject";

export const LIGHTING_MODE = {
    STUDIO: "studio",
    CUSTOM: "custom",
} as const;
export type LightingMode = (typeof LIGHTING_MODE)[keyof typeof LIGHTING_MODE];

export function isLightingMode(value: unknown): value is LightingMode {
    return value === LIGHTING_MODE.STUDIO || value === LIGHTING_MODE.CUSTOM;
}

const INITIAL_SCENE_REVISION = 0;

/**
 * 场景 Store(MobX 类):只放可观察的纯数据实体。
 * three 运行时对象永远在 SceneManager 的普通 Map 里,不进本 store(性能铁律)。
 *
 * 实例化纪律:不导出单例——Monet 画布可同时存在多个导演台节点,
 * 每个 DirectorDesk 实例持有一套自己的 stores(见 ui/DirectorDeskContext)。
 */
export class SceneStore {
    readonly manager = new SceneManager();
    /** 场景照明策略只保存可序列化模式；实际 Three 灯由 StudioRig 或 LightContent 创建。 */
    lightingMode: LightingMode = LIGHTING_MODE.STUDIO;
    /** 模式变化的响应式锚点；Canvas demand 模式由 StudioRig 显式补帧。 */
    revision = INITIAL_SCENE_REVISION;

    constructor() {
        makeAutoObservable(this, { manager: false });
    }

    addObject(init: SceneObjectInit): SceneObject {
        const object = new SceneObject(init);
        this.manager.register(object);
        return object;
    }
    /** 文档导入专用：候选实体已在应用服务中构造并校验，此处只作单次替换提交。 */
    replaceObjects(entities: readonly SceneObject[]): void {
        this.manager.replaceEntities(entities);
    }

    removeObject(id: string): void {
        this.manager.unregister(id);
    }

    updateTransform(id: string, transform: Transform): void {
        const entity = this.manager.getEntity(id);
        if (!entity) return;
        entity.applyTransform(transform);
        this.manager.syncRuntimeTransform(id, transform);
    }

    setLightParams(id: string, light: LightParams): void {
        const entity = this.manager.getEntity(id);
        if (!entity) return;
        entity.applyLight(light);
    }

    setLightingMode(mode: LightingMode): void {
        if (this.lightingMode === mode) return;
        this.lightingMode = mode;
        this.revision += 1;
    }

    setObjectAction(id: string, action: ActionPerformance | null): void {
        const entity = this.manager.getEntity(id);
        if (!entity) return;
        entity.applyAction(action);
    }

    setObjectPose(id: string, pose: PoseSnapshot | null): void {
        const entity = this.manager.getEntity(id);
        if (!entity) return;
        entity.applyPose(pose);
    }

    setObjectActor(id: string, actor: ActorProfile | null): void {
        const entity = this.manager.getEntity(id);
        if (!entity) return;
        entity.applyActor(actor);
    }

    get objectCount(): number {
        return this.manager.list().length;
    }
}
