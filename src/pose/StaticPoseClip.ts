import type { AnimationClip } from "three";

import { BoneKeyIndex } from "@/pose/BoneKeyIndex";
import { PoseSnapshot } from "@/pose/PoseSnapshot";
import type { BoneKey, QuaternionTuple } from "@/pose/PoseSnapshot";
import type { SkeletonDiscoveryDto } from "@/pose/SkeletonRuntimeRegistry";

const QUATERNION_COMPONENT_COUNT = 4;
const QUATERNION_TRACK_SUFFIX = ".quaternion";
const STATIC_POSE_METADATA_KEY = "tapnowActorAnimation";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseQuaternion(values: ArrayLike<number>): QuaternionTuple | null {
    if (values.length < QUATERNION_COMPONENT_COUNT) return null;
    const quaternion: QuaternionTuple = [values[0]!, values[1]!, values[2]!, values[3]!];
    return quaternion.every(Number.isFinite) ? quaternion : null;
}

/** GLB extras 标识的静态姿势由 pose 层承载，不伪装成可播放动作。 */
export function isStaticPoseClip(clip: AnimationClip): boolean {
    const metadata = clip.userData[STATIC_POSE_METADATA_KEY];
    return isRecord(metadata) && metadata.staticPose === true;
}

/** 将命名骨骼的常量 quaternion tracks 转成可 JSON 往返的 PoseSnapshot。 */
export function createStaticPoseSnapshot(clip: AnimationClip, discovery: SkeletonDiscoveryDto): PoseSnapshot | null {
    if (!isStaticPoseClip(clip)) return null;
    const index = BoneKeyIndex.from(discovery);
    if (!index.isReady) return null;
    const bones: Record<BoneKey, QuaternionTuple> = {};
    for (const track of clip.tracks) {
        if (!track.name.endsWith(QUATERNION_TRACK_SUFFIX)) continue;
        const boneName = track.name.slice(0, -QUATERNION_TRACK_SUFFIX.length);
        const boneKey = index.keyOf(boneName);
        const quaternion = boneKey ? parseQuaternion(track.values) : null;
        if (boneKey && quaternion) bones[boneKey] = quaternion;
    }
    return Object.keys(bones).length === 0 ? null : new PoseSnapshot({ bones });
}
