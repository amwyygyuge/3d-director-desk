import { makeAutoObservable, observableRef } from "mobx";

import type { ModelFormat } from "../assets/ModelAsset";
import { normalizeLightParams } from "./LightParams";
import type { LightParams } from "./LightParams";
import { PoseSnapshot } from "../pose/PoseSnapshot";
import type { PoseSnapshotInit } from "../pose/PoseSnapshot";

export type Vec3 = readonly [number, number, number];

export interface Transform {
    readonly position: Vec3;
    readonly rotation: Vec3;
    readonly scale: Vec3;
}

function copyVec3([x, y, z]: Vec3): Vec3 {
    return [x, y, z];
}

function copyTransform(transform: Transform): Transform {
    return {
        position: copyVec3(transform.position),
        rotation: copyVec3(transform.rotation),
        scale: copyVec3(transform.scale),
    };
}

export const IDENTITY_TRANSFORM: Transform = Object.freeze({
    position: Object.freeze([0, 0, 0] as const),
    rotation: Object.freeze([0, 0, 0] as const),
    scale: Object.freeze([1, 1, 1] as const),
});

export type SceneObjectKind = "model" | "primitive" | "camera" | "light";
export const SCENE_OBJECT_KINDS: readonly SceneObjectKind[] = ["model", "primitive", "camera", "light"];

/** 空间幻觉围栏:一切来自外部(AI/宿主)的数值先过有限性检查(命令层共用,Rule of Two) */
export function finiteVec3(value: unknown): value is Vec3 {
    return Array.isArray(value) && value.length === 3 && value.every((v) => Number.isFinite(v));
}

export function finiteTransform(value: unknown): value is Transform {
    if (typeof value !== "object" || value === null) return false;
    if (!("position" in value) || !("rotation" in value) || !("scale" in value)) return false;
    return finiteVec3(value.position) && finiteVec3(value.rotation) && finiteVec3(value.scale);
}

const KIND_LABEL: Record<SceneObjectKind, string> = {
    model: "模型",
    primitive: "几何体",
    camera: "机位对象",
    light: "灯光",
};

/**
 * 场景对象实体:稳定身份 + 受保护的可变变换。
 * three 运行时对象(Object3D)不进本实体,由 SceneManager 的运行时注册表持有,
 * 避免 three 对象被 observable 包装(性能铁律)。
 */
export interface SceneObjectInit {
    readonly id: string;
    readonly kind: SceneObjectKind;
    readonly sourceUrl?: string | null;
    readonly format?: ModelFormat | null;
    readonly name?: string;
    readonly transform?: Transform;
    /** kind="light" 必须有值；其他 kind 必须为 null/undefined。 */
    readonly light?: LightParams | null;
    /** 骨骼根相对的局部绝对旋转快照；仅模型可用，且始终是纯数据。 */
    readonly pose?: PoseSnapshot | PoseSnapshotInit | null;
}

export class SceneObject {
    readonly id: string;
    readonly kind: SceneObjectKind;
    /** 模型来源 URL;primitive 为 null */
    readonly sourceUrl: string | null;
    /** 模型格式(blob URL 无扩展名,必须显式携带);非 model 为 null */
    readonly format: ModelFormat | null;
    /** 显示名(Outliner/Inspector);缺省按 kind + id 尾缀派生(确定性,undo/redo 回放不漂移) */
    readonly name: string;
    private currentTransform: Transform;
    private mountedActionId: string | null = null;
    /** 灯光参数值对象；仅 light 实体有值，Three 光源仍由运行时树拥有。 */
    private currentLight: LightParams | null;
    private currentPose: PoseSnapshot | null;

    constructor(init: SceneObjectInit) {
        this.id = init.id;
        this.kind = init.kind;
        this.sourceUrl = init.sourceUrl ?? null;
        this.format = init.format ?? null;
        this.name = init.name ?? `${KIND_LABEL[init.kind]} ${init.id.slice(-4)}`;
        const hasLight = init.light !== undefined && init.light !== null;
        if ((init.kind === "light") !== hasLight) {
            throw new Error('SceneObject: kind="light" iff light params exist');
        }
        this.currentTransform = copyTransform(init.transform ?? IDENTITY_TRANSFORM);
        this.currentLight = hasLight ? normalizeLightParams(init.light as LightParams) : null;
        this.currentPose =
            init.pose instanceof PoseSnapshot ? init.pose : init.pose ? new PoseSnapshot(init.pose) : null;
        makeAutoObservable<SceneObject, "currentLight" | "currentPose">(this, {
            currentLight: observableRef,
            currentPose: observableRef,
        });
    }

    get transform(): Transform {
        return this.currentTransform;
    }

    applyTransform(next: Transform): void {
        this.currentTransform = copyTransform(next);
    }

    get light(): LightParams | null {
        return this.currentLight;
    }

    applyLight(next: LightParams): void {
        if (this.kind !== "light") throw new Error("SceneObject: only light entities accept LightParams");
        this.currentLight = normalizeLightParams(next);
    }

    get pose(): PoseSnapshot | null {
        return this.currentPose;
    }

    applyPose(next: PoseSnapshot | null): void {
        this.currentPose = next;
    }

    /** JSON 往返保留 kind/light 的双向不变量，且不泄露 Three 运行时。 */
    toJSON(): SceneObjectInit {
        return {
            id: this.id,
            kind: this.kind,
            sourceUrl: this.sourceUrl,
            format: this.format,
            name: this.name,
            transform: copyTransform(this.currentTransform),
            light: this.currentLight,
            pose: this.currentPose?.toJSON() ?? null,
        };
    }

    /** 已挂载动作(AnimationLibrary 的 action id);可序列化纪律:只存引用 id,不存 clip */
    get actionId(): string | null {
        return this.mountedActionId;
    }

    applyAction(actionId: string | null): void {
        this.mountedActionId = actionId;
    }
}
