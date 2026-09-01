import type { PoseSnapshot } from "@/pose/PoseSnapshot";
import type { SkeletonRuntimeRegistry } from "@/pose/SkeletonRuntimeRegistry";

/** Applies an absolute serialized pose snapshot after animation sampling. */
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
