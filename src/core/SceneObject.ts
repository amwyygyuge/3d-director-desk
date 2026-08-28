export type Vec3 = readonly [number, number, number];

export interface Transform {
    readonly position: Vec3;
    readonly rotation: Vec3;
    readonly scale: Vec3;
}

export const IDENTITY_TRANSFORM: Transform = {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
};

export type SceneObjectKind = "model" | "primitive" | "camera";

/**
 * 场景对象实体:稳定身份 + 受保护的可变变换。
 * three 运行时对象(Object3D)不进本实体,由 SceneManager 的运行时注册表持有,
 * 避免 three 对象被 observable 包装(性能铁律)。
 */
export class SceneObject {
    readonly id: string;
    readonly kind: SceneObjectKind;
    /** 模型来源 URL;primitive 为 null */
    readonly sourceUrl: string | null;
    private currentTransform: Transform;

    constructor(init: { id: string; kind: SceneObjectKind; sourceUrl?: string | null; transform?: Transform }) {
        this.id = init.id;
        this.kind = init.kind;
        this.sourceUrl = init.sourceUrl ?? null;
        this.currentTransform = init.transform ?? IDENTITY_TRANSFORM;
    }

    get transform(): Transform {
        return this.currentTransform;
    }

    applyTransform(next: Transform): void {
        this.currentTransform = next;
    }
}
