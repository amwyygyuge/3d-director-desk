import type { PoseSnapshot } from "@/pose/PoseSnapshot";
import type { SkeletonRuntimeRegistry } from "@/pose/SkeletonRuntimeRegistry";

/** 常驻基础姿势层:在动作采样前写入,动作只覆盖自己拥有的骨骼轨道。 */
export class PoseLayer {
    constructor(private readonly skeletons: SkeletonRuntimeRegistry) {}

    apply(objectId: string, snapshot: PoseSnapshot | null): void {
        if (!snapshot) return;
        for (let index = 0; index < snapshot.entries.length; index += 1) {
            const entry = snapshot.entries[index];
            if (!entry) continue;
            const bone = this.skeletons.getBone(objectId, entry[0]);
            if (bone) bone.quaternion.set(entry[1][0], entry[1][1], entry[1][2], entry[1][3]);
        }
    }
}
