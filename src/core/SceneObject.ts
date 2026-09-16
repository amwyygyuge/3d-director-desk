import { makeAutoObservable, observableRef } from "mobx";

import { ActorProfile } from "@/actor/ActorProfile";
import type { ActorProfileInit } from "@/actor/ActorProfile";
import type { ActionPerformance } from "@/animation/ActionPerformance";
import type { ModelFormat } from "@/assets/ModelAsset";
import { normalizeLightParams } from "@/core/LightParams";
import type { LightParams } from "@/core/LightParams";
import {
    ACTOR_METERS_SCALE,
    RELATIVE_SPATIAL_SCALE,
    SCENE_SPATIAL_SCALE_KIND,
    SceneNarrativeIdentity,
    SceneSpatialScale,
} from "@/core/SceneSemantics";
import type { SceneNarrativeIdentityInit, SceneSpatialScaleInit } from "@/core/SceneSemantics";
import { PoseSnapshot } from "@/pose/PoseSnapshot";
import type { PoseSnapshotInit } from "@/pose/PoseSnapshot";

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

function narrativeIdentityFor(
    identity: SceneNarrativeIdentity | SceneNarrativeIdentityInit | null | undefined,
): SceneNarrativeIdentity | null {
    if (identity === null || identity === undefined) return null;
    return identity instanceof SceneNarrativeIdentity ? identity : new SceneNarrativeIdentity(identity);
}

function spatialScaleFor(
    scale: SceneSpatialScale | SceneSpatialScaleInit | null | undefined,
    actor: ActorProfile | null,
): SceneSpatialScale {
    if (scale instanceof SceneSpatialScale) return scale;
    if (scale) return new SceneSpatialScale(scale);
    return actor ? ACTOR_METERS_SCALE : RELATIVE_SPATIAL_SCALE;
}
export type SceneObjectKind = "model" | "camera" | "light";
export const SCENE_OBJECT_KINDS: readonly SceneObjectKind[] = ["model", "camera", "light"];

/** 空间幻觉围栏:一切来自外部(AI/宿主)的数值先过有限性检查(命令层共用,Rule of Two) */
export function finiteVec3(value: unknown): value is Vec3 {
    return Array.isArray(value) && value.length === 3 && value.every((v) => Number.isFinite(v));
}

export function finiteTransform(value: unknown): value is Transform {
    if (typeof value !== "object" || value === null) return false;
    if (!("position" in value) || !("rotation" in value) || !("scale" in value)) return false;
    return finiteVec3(value.position) && finiteVec3(value.rotation) && finiteVec3(value.scale);
}

/** 类型中文标签:派生显示名与⌘K 面板条目共用,禁两处各写一份 */
export const KIND_LABEL: Record<SceneObjectKind, string> = {
    model: "模型",
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
    /** 常驻基础姿势(骨骼根相对的局部绝对旋转);仅模型可用,动作采样前写入。 */
    readonly pose?: PoseSnapshot | PoseSnapshotInit | null;
    /** 人偶画像；仅模型可用，纯数据(骨架家族 + 外观 + 体型)，是「这是个人偶」的显式凭据。 */
    readonly actor?: ActorProfile | ActorProfileInit | null;
    /** AI/导演共用的稳定叙事引用；不以模型文件名推断主角或道具。 */
    readonly narrativeIdentity?: SceneNarrativeIdentity | SceneNarrativeIdentityInit | null;
    /** 长度量纲：演员与标定资产可解释为米，未知来源保持相对单位。 */
    readonly spatialScale?: SceneSpatialScale | SceneSpatialScaleInit | null;
    /** 交互锁：true = 布景类固定背景；只挡视口点选/gizmo/Inspector 编辑，命令层写入不受限。 */
    readonly locked?: boolean;
}

export class SceneObject {
    readonly id: string;
    readonly kind: SceneObjectKind;
    /** 模型来源 URL；非模型为 null */
    readonly sourceUrl: string | null;
    /** 模型格式(blob URL 无扩展名,必须显式携带);非 model 为 null */
    readonly format: ModelFormat | null;
    /** 显示名(Outliner/Inspector);缺省按 kind + id 尾缀派生(确定性,undo/redo 回放不漂移) */
    readonly name: string;
    private currentTransform: Transform;
    /** 动作排期序列(按 startTimeSeconds 升序);同一时刻至多一个动作生效,重叠由命令层拦截。 */
    private mountedActions: readonly ActionPerformance[] = [];
    /** 灯光参数值对象；仅 light 实体有值，Three 光源仍由运行时树拥有。 */
    private currentLight: LightParams | null;
    private currentPose: PoseSnapshot | null;
    private currentActor: ActorProfile | null;
    private currentNarrativeIdentity: SceneNarrativeIdentity | null;
    private currentSpatialScale: SceneSpatialScale;
    private currentLocked: boolean;

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
        this.currentActor =
            init.actor instanceof ActorProfile ? init.actor : init.actor ? new ActorProfile(init.actor) : null;
        this.currentNarrativeIdentity = narrativeIdentityFor(init.narrativeIdentity);
        this.currentSpatialScale = spatialScaleFor(init.spatialScale, this.currentActor);
        if (this.currentActor && this.currentSpatialScale.kind !== SCENE_SPATIAL_SCALE_KIND.ACTOR_METERS) {
            throw new Error("SceneObject: 人偶必须使用 actor-meters 量纲");
        }
        if (this.currentActor && init.kind !== "model") {
            throw new Error("SceneObject: 只有模型实体可以持有人偶画像");
        }
        this.currentLocked = init.locked ?? false;
        makeAutoObservable<
            SceneObject,
            "currentLight" | "currentPose" | "currentActor" | "currentNarrativeIdentity" | "mountedActions"
        >(this, {
            currentLight: observableRef,
            currentPose: observableRef,
            currentActor: observableRef,
            currentNarrativeIdentity: observableRef,
            mountedActions: observableRef,
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

    /** 常驻基础姿势:动作未开始、动作未覆盖的骨骼与 once 回收终点都从这里来。 */
    get pose(): PoseSnapshot | null {
        return this.currentPose;
    }

    applyPose(next: PoseSnapshot | null): void {
        this.currentPose = next;
    }

    get actor(): ActorProfile | null {
        return this.currentActor;
    }

    applyActor(next: ActorProfile | null): void {
        if (next && this.kind !== "model") throw new Error("SceneObject: 只有模型实体可以持有人偶画像");
        this.currentActor = next;
    }

    get narrativeIdentity(): SceneNarrativeIdentity | null {
        return this.currentNarrativeIdentity;
    }

    applyNarrativeIdentity(next: SceneNarrativeIdentity | null): void {
        this.currentNarrativeIdentity = next;
    }

    get spatialScale(): SceneSpatialScale {
        return this.currentSpatialScale;
    }

    get locked(): boolean {
        return this.currentLocked;
    }

    applyLocked(next: boolean): void {
        this.currentLocked = next;
    }

    /** 量纲重标定；人偶实体锁死 actor-meters（与构造期同一不变量），拒绝改走。 */
    applySpatialScale(next: SceneSpatialScale | SceneSpatialScaleInit): void {
        const resolved = spatialScaleFor(next, this.currentActor);
        if (this.currentActor && resolved.kind !== SCENE_SPATIAL_SCALE_KIND.ACTOR_METERS) {
            throw new Error("SceneObject: 人偶必须使用 actor-meters 量纲");
        }
        this.currentSpatialScale = resolved;
    }

    /** JSON 往返保留领域值对象，且不泄露 Three 运行时。 */
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
            actor: this.currentActor?.toJSON() ?? null,
            narrativeIdentity: this.currentNarrativeIdentity?.toJSON() ?? null,
            spatialScale: this.currentSpatialScale.toJSON(),
            locked: this.currentLocked,
        };
    }

    /**
     * 动作排期序列(按 startTimeSeconds 升序,只读)。
     * 一个实体可以在一条时间线上依次表演多个动作(一次性 → 循环 → 一次性),
     * 这是走位与表演能对齐的前提;同一时刻至多一个动作生效。
     */
    get actionPerformances(): readonly ActionPerformance[] {
        return this.mountedActions;
    }

    /** 命中某时刻的动作排期(含 release 回收段);无命中返回 null。 */
    actionPerformanceAt(timeSeconds: number): ActionPerformance | null {
        // 倒序扫:排期按起始升序,最后一个「已开始」的才是当前生效的那个
        for (let index = this.mountedActions.length - 1; index >= 0; index -= 1) {
            const performance = this.mountedActions[index];
            if (!performance) continue;
            if (timeSeconds >= performance.startTimeSeconds && timeSeconds <= performance.releaseEndTimeSeconds) {
                return performance;
            }
        }
        return null;
    }

    /** 按段 id 取排期:时间轴段条、选中态与 action.* 命令的唯一定位口。 */
    actionPerformance(performanceId: string): ActionPerformance | null {
        return this.mountedActions.find((performance) => performance.id === performanceId) ?? null;
    }

    /**
     * 已挂载动作(AnimationLibrary 的 action id)。
     * 多段序列下这只是「首段演的是哪个动作」,不代表当前生效者——
     * 生效者随时刻变化,读 actionPerformanceAt。
     */
    get actionId(): string | null {
        return this.mountedActions[0]?.actionId ?? null;
    }

    /** 整表替换(命令层已排序去重);null / 空数组 = 清空全部动作。 */
    applyActions(actions: readonly ActionPerformance[] | null): void {
        this.mountedActions = actions
            ? [...actions].sort((left, right) => left.startTimeSeconds - right.startTimeSeconds)
            : [];
    }
}
