import { BODY_PART, MIXAMO_PART_BONES } from "@/actor/mixamoSkeleton";
import type { BodyPart, BoneRotationsByName } from "@/actor/mixamoSkeleton";
import type { BoneKeyIndex } from "@/pose/BoneKeyIndex";
import type { PosePreset } from "@/pose/PosePreset";
import { PoseSnapshot } from "@/pose/PoseSnapshot";
import type { BoneKey, QuaternionTuple } from "@/pose/PoseSnapshot";

export interface ComposeSnapshotRequest {
    readonly base: PoseSnapshot | null;
    readonly preset: PosePreset;
    readonly index: BoneKeyIndex;
}

export interface ExtractPresetBonesRequest {
    readonly snapshot: PoseSnapshot;
    readonly index: BoneKeyIndex;
    readonly part: BodyPart;
}

/** Stateless conversion between portable name-based presets and runtime BoneKey snapshots. */
export class PoseComposer {
    static composeSnapshot({ base, preset, index }: ComposeSnapshotRequest): PoseSnapshot | null {
        if (!index.isReady) return null;
        const bones: Record<BoneKey, QuaternionTuple> = preset.part === BODY_PART.FULL ? {} : { ...base?.bones };
        const matched = Object.entries(preset.bones).reduce((count, [boneName, quaternion]) => {
            const key = index.keyOf(boneName);
            if (!key) return count;
            bones[key] = quaternion;
            return count + 1;
        }, 0);
        return matched === 0 ? null : new PoseSnapshot({ bones });
    }

    static extractPresetBones({ snapshot, index, part }: ExtractPresetBonesRequest): BoneRotationsByName {
        const eligibleNames = MIXAMO_PART_BONES[part];
        const bones: Record<string, QuaternionTuple> = {};
        for (const [key, quaternion] of snapshot.entries) {
            const name = index.nameOf(key);
            if (name && eligibleNames.includes(name)) bones[name] = quaternion;
        }
        return bones;
    }
}
