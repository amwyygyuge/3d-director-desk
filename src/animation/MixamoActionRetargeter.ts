import { AnimationClip, Bone, Skeleton } from "three";
import type { KeyframeTrack, Object3D, SkinnedMesh } from "three";
import { clone as cloneSkeleton, retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";

import { normalizeMixamoBoneName } from "@/actor/mixamoSkeleton";

export const ACTION_CHANNEL_POLICY = {
    PRESERVE: "preserve",
    ROTATION_ONLY: "rotation-only",
} as const;
export type ActionChannelPolicy = (typeof ACTION_CHANNEL_POLICY)[keyof typeof ACTION_CHANNEL_POLICY];

export interface MixamoActionRetargetOptions {
    readonly channels?: ActionChannelPolicy;
    /** 去除源动作开头/结尾的静态参考帧;单位秒。 */
    readonly trimStartSeconds?: number;
    readonly trimEndSeconds?: number;
    /** 动作文件自己的骨架;FBX 重定向必须提供。 */
    readonly sourceRoot?: Object3D;
    /** 目标人偶当前运行时;会被克隆,实际场景不受 retargetClip 的 skeleton.pose() 影响。 */
    readonly targetRoot?: Object3D;
}

function trimmedTrack(track: KeyframeTrack, startTimeSeconds: number, endTimeSeconds: number): KeyframeTrack {
    const valueSize = track.getValueSize();
    const times = [...track.times];
    const firstIndex = times.findIndex((time) => time >= startTimeSeconds);
    const lastIndex = times.findLastIndex((time) => time <= endTimeSeconds);
    if (firstIndex < 0 || lastIndex < firstIndex) {
        throw new Error("MixamoActionRetargeter: 动作轨道裁剪后为空");
    }
    const trimmed = track.clone();
    trimmed.times = track.times.slice(firstIndex, lastIndex + 1);
    trimmed.times = new Float32Array(trimmed.times.map((time) => time - startTimeSeconds));
    trimmed.values = track.values.slice(firstIndex * valueSize, (lastIndex + 1) * valueSize);
    return trimmed;
}

function trimClip(clip: AnimationClip, trimStartSeconds: number, trimEndSeconds: number): AnimationClip {
    if (trimStartSeconds === 0 && trimEndSeconds === 0) return clip;
    const endTimeSeconds = clip.duration - trimEndSeconds;
    if (trimStartSeconds < 0 || trimEndSeconds < 0 || endTimeSeconds <= trimStartSeconds) {
        throw new Error("MixamoActionRetargeter: 动作裁剪窗口无效");
    }
    return new AnimationClip(
        clip.name,
        endTimeSeconds - trimStartSeconds,
        clip.tracks.map((track) => trimmedTrack(track, trimStartSeconds, endTimeSeconds)),
    );
}

function sourceBonesOf(root: Object3D): Bone[] {
    const bones: Bone[] = [];
    root.traverse((node) => {
        if (node instanceof Bone) bones.push(node);
    });
    return bones;
}

function skinnedMeshOf(root: Object3D): SkinnedMesh | null {
    let found: SkinnedMesh | null = null;
    root.traverse((node) => {
        if (!found && "isSkinnedMesh" in node && node.isSkinnedMesh) found = node as SkinnedMesh;
    });
    return found;
}

/** SkeletonUtils 输出 .bones[name].quaternion;本仓 AnimationBinder 直接挂节点树,改回 name.quaternion。 */
function normalizeOutputTrackName(name: string): string {
    const match = /^\.bones\[(.+)\]\.(.+)$/.exec(name);
    return match?.[1] && match[2] ? `${match[1]}.${match[2]}` : name;
}

const TARGET_HIPS_TRACK_NAME = "mixamorigHips.quaternion";

function retargetedTrackName(name: string): string {
    const [nodeName, ...propertyPath] = normalizeOutputTrackName(name).split(".");
    const boneName = nodeName ? normalizeMixamoBoneName(nodeName) : null;
    return boneName ? [boneName, ...propertyPath].join(".") : name;
}

/**
 * Mixamo 动作重定向适配器。
 *
 * 只改轨道名不足以跨 FBX 导出器:源/目标骨架的 armature 根方向、单位和 bind pose 都可能不同,
 * 直接写绝对四元数会把人偶放倒。这里用 SkeletonUtils 的世界矩阵重定向,再把轨道名收回到节点路径;
 * position/scale 不进入场景,Hips 朝向轨道也会移除;实体 transform 是位置与朝向的唯一权威。
 */
export class MixamoActionRetargeter {
    normalize(clip: AnimationClip, options: MixamoActionRetargetOptions = {}): AnimationClip {
        const rotationOnly = options.channels === ACTION_CHANNEL_POLICY.ROTATION_ONLY;
        const retargeted =
            rotationOnly && options.sourceRoot && options.targetRoot
                ? this.retargetWithSkeleton(clip, options.sourceRoot, options.targetRoot)
                : clip.clone();
        const tracks = retargeted.tracks.flatMap((track) => {
            if (rotationOnly && !track.name.endsWith(".quaternion")) return [];
            const retargetedTrack = track.clone();
            retargetedTrack.name = retargetedTrackName(track.name);
            // 实体 transform 是朝向唯一权威:外部动作不写 Hips 朝向,避免手势改变模型面向。
            if (rotationOnly && retargetedTrack.name === TARGET_HIPS_TRACK_NAME) return [];
            return [retargetedTrack];
        });
        const normalized = new AnimationClip(retargeted.name, retargeted.duration, tracks);
        return trimClip(normalized, options.trimStartSeconds ?? 0, options.trimEndSeconds ?? 0);
    }

    private retargetWithSkeleton(clip: AnimationClip, sourceRoot: Object3D, targetRoot: Object3D): AnimationClip {
        const sourceBones = sourceBonesOf(sourceRoot);
        const target = cloneSkeleton(targetRoot);
        const targetSkin = skinnedMeshOf(target);
        if (!targetSkin || sourceBones.length === 0) {
            throw new Error("MixamoActionRetargeter: 源或目标骨架缺失");
        }
        target.updateMatrixWorld(true);
        sourceRoot.updateMatrixWorld(true);
        const names = Object.fromEntries(
            targetSkin.skeleton.bones.flatMap((targetBone) => {
                const sourceBone = sourceBones.find(
                    (candidate) => normalizeMixamoBoneName(candidate.name) === targetBone.name,
                );
                return sourceBone ? [[targetBone.name, sourceBone.name]] : [];
            }),
        );
        const sourceHips = sourceBones.find((bone) => normalizeMixamoBoneName(bone.name) === "mixamorigHips");
        return retargetClip(targetSkin, new Skeleton(sourceBones), clip, {
            names,
            hip: sourceHips?.name ?? "Hips",
        });
    }
}
