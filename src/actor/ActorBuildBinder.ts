import type { Bone, Object3D } from "three";

import type { BoneScalePlan } from "@/actor/BoneScalePlan";
import type { Vec3 } from "@/core/SceneObject";

interface BoneRuntime {
    readonly bone: Bone;
    /** rest 缩放:体型是它的倍率而不是绝对值,资产若自带非单位缩放也不会被抹掉。 */
    readonly restScale: Vec3;
}

const BONE_TYPE = "Bone";

/**
 * 人偶体型的 Three 写方(运行时适配器,每桌一套,永不进 MobX)。
 *
 * 只写 bone.scale——实测内置人形的 14 段 clip 只有 rotation 与 Hips 的 translation 通道,
 * 缩放通道完全空闲,因此体型与动作/姿势层零冲突,也**不需要进帧循环**:
 * 只在挂载与体型提交时各写一次。
 */
export class ActorBuildBinder {
    private readonly bonesByObject = new Map<string, ReadonlyMap<string, BoneRuntime>>();

    attach(objectId: string, root: Object3D): void {
        const bones = new Map<string, BoneRuntime>();
        root.traverse((node) => {
            if (node.type !== BONE_TYPE || bones.has(node.name)) return;
            const bone = node as Bone;
            bones.set(bone.name, { bone, restScale: [bone.scale.x, bone.scale.y, bone.scale.z] });
        });
        this.bonesByObject.set(objectId, bones);
    }

    detach(objectId: string): void {
        this.bonesByObject.delete(objectId);
    }

    /** 先整体复位再落计划:体型是全量重写而非增量,撤销与连续拖拽都不会累积漂移。 */
    shape(objectId: string, plan: BoneScalePlan): void {
        const bones = this.bonesByObject.get(objectId);
        if (!bones) return;
        for (const { bone, restScale } of bones.values()) bone.scale.set(restScale[0], restScale[1], restScale[2]);
        for (const entry of plan.entries) {
            const runtime = bones.get(entry.boneName);
            if (!runtime) continue;
            runtime.bone.scale.set(
                runtime.restScale[0] * entry.scale[0],
                runtime.restScale[1] * entry.scale[1],
                runtime.restScale[2] * entry.scale[2],
            );
        }
    }

    dispose(): void {
        this.bonesByObject.clear();
    }
}
