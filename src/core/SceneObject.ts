import type { ModelFormat } from "../assets/ModelAsset";

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

const KIND_LABEL: Record<SceneObjectKind, string> = { model: "模型", primitive: "几何体", camera: "机位对象" };

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
    /** 模型格式(blob URL 无扩展名,必须显式携带);非 model 为 null */
    readonly format: ModelFormat | null;
    /** 显示名(Outliner/Inspector);缺省按 kind + id 尾缀派生(确定性,undo/redo 回放不漂移) */
    readonly name: string;
    private currentTransform: Transform;
    private mountedActionId: string | null = null;

    constructor(init: {
        id: string;
        kind: SceneObjectKind;
        sourceUrl?: string | null;
        format?: ModelFormat | null;
        name?: string;
        transform?: Transform;
    }) {
        this.id = init.id;
        this.kind = init.kind;
        this.sourceUrl = init.sourceUrl ?? null;
        this.format = init.format ?? null;
        this.name = init.name ?? `${KIND_LABEL[init.kind]} ${init.id.slice(-4)}`;
        this.currentTransform = init.transform ?? IDENTITY_TRANSFORM;
    }

    get transform(): Transform {
        return this.currentTransform;
    }

    applyTransform(next: Transform): void {
        this.currentTransform = next;
    }
    /** 已挂载动作(AnimationLibrary 的 action id);可序列化纪律:只存引用 id,不存 clip */
    get actionId(): string | null {
        return this.mountedActionId;
    }

    applyAction(actionId: string | null): void {
        this.mountedActionId = actionId;
    }
}
