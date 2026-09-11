import type { AnimationClip, Object3D } from "three";

/** 骨骼匹配率阈值:低于则判定异构,拒绝挂载并给结构化诊断(AI 重试路径,见 ai-control.md) */
export const BONE_MATCH_THRESHOLD = 0.5;

export interface BoneCheckResult {
    /** 命中轨道占比 0~1 */
    matchedRatio: number;
    /** clip 中无法绑到模型节点的轨道目标名 */
    missingTargets: readonly string[];
    readonly ok: boolean;
}

/**
 * 骨骼兼容预检(领域服务):clip 轨道目标名 ∩ 模型节点名。
 * 同构骨骼(同一模型系导出)直接通过;异构(如人形动作挂四足)给出缺失清单。
 * 重定向(异构强行匹配)属专项,经 RetargetStrategy 扩展点接入,不在此处。
 */
export class BoneCompatibilityChecker {
    check(root: Object3D, clip: AnimationClip): BoneCheckResult {
        const nodeNames = new Set<string>();
        root.traverse((node) => {
            if (node.name) nodeNames.add(node.name);
        });
        // 轨道名形如 "pelvis.position",目标节点名取第一段
        const targets = [...new Set(clip.tracks.map((track) => track.name.split(".")[0] ?? ""))].filter(Boolean);
        const missingTargets = targets.filter((name) => !nodeNames.has(name));
        const matchedRatio = targets.length === 0 ? 0 : (targets.length - missingTargets.length) / targets.length;
        return { matchedRatio, missingTargets, ok: matchedRatio >= BONE_MATCH_THRESHOLD };
    }
}
