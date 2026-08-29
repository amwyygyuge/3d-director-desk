import { Quaternion } from "three";

import type { PoseSnapshot, QuaternionTuple } from "./PoseSnapshot";
import type { SkeletonRuntimeRegistry } from "./SkeletonRuntimeRegistry";

/** Runtime-only pose blender. It owns reusable scratch quaternions and never touches MobX/history. */
export class PoseLayer {
    private readonly target = new Quaternion();
    private readonly blended = new Quaternion();

    constructor(private readonly skeletons: SkeletonRuntimeRegistry) {}

    apply(objectId: string, snapshot: PoseSnapshot | null, weight: number): void {
        if (!snapshot || weight <= 0) return;
        for (let index = 0; index < snapshot.entries.length; index += 1) {
            const entry = snapshot.entries[index];
            if (entry) this.applyQuaternion(objectId, entry[0], entry[1], weight);
        }
    }

    applyInterpolated(objectId: string, left: PoseSnapshot, right: PoseSnapshot, progress: number, weight: number): void {
        if (weight <= 0) return;
        for (let index = 0; index < left.entries.length; index += 1) {
            const entry = left.entries[index];
            if (!entry) continue;
            const boneKey = entry[0];
            const leftQuaternion = entry[1];
            const rightQuaternion = right.bones[boneKey];
            if (rightQuaternion) {
                this.target.set(leftQuaternion[0], leftQuaternion[1], leftQuaternion[2], leftQuaternion[3]);
                this.blended.set(rightQuaternion[0], rightQuaternion[1], rightQuaternion[2], rightQuaternion[3]);
                this.target.slerp(this.blended, progress);
                this.applyTarget(objectId, boneKey, weight);
            } else {
                this.applyQuaternion(objectId, boneKey, leftQuaternion, weight);
            }
        }
        for (let index = 0; index < right.entries.length; index += 1) {
            const entry = right.entries[index];
            if (entry && !left.bones[entry[0]]) this.applyQuaternion(objectId, entry[0], entry[1], weight);
        }
    }

    private applyQuaternion(objectId: string, boneKey: string, tuple: QuaternionTuple, weight: number): void {
        this.target.set(tuple[0], tuple[1], tuple[2], tuple[3]);
        this.applyTarget(objectId, boneKey, weight);
    }

    private applyTarget(objectId: string, boneKey: string, weight: number): void {
        const bone = this.skeletons.getBone(objectId, boneKey);
        if (!bone) return;
        if (weight >= 1) {
            bone.quaternion.copy(this.target);
        } else {
            this.blended.copy(bone.quaternion).slerp(this.target, weight);
            bone.quaternion.copy(this.blended);
        }
    }
}
