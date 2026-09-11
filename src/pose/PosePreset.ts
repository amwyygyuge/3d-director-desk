import { BODY_PART, isBodyPart } from "@/actor/actorSkeleton";
import type { BodyPart, BoneRotationsByName } from "@/actor/actorSkeleton";
import { isQuaternionTuple } from "@/pose/PoseSnapshot";
import type { QuaternionTuple } from "@/pose/PoseSnapshot";

export interface PosePresetJSON {
    readonly id: string;
    readonly labelZh: string;
    /** 作用部位:决定它能否与另一半身预设合成,以及组合器把它放进哪一列。 */
    readonly part: BodyPart;
    readonly skeletonFamily: string;
    /** 骨骼名 → 局部绝对旋转;以名而非 BoneKey 存,跨模型可移植。 */
    readonly bones: BoneRotationsByName;
    /** 用户自建标记:内置预设为 false,自建预设随工程文档走。 */
    readonly custom: boolean;
}

/**
 * 姿势预设(值对象):稀疏的骨骼旋转集合 + 作用部位。
 *
 * 稀疏是设计而非省略——上半身预设只写上半身骨骼,与下半身预设并集即得完整姿势,
 * 姿势数量因此是乘法而不是加法。
 */
export class PosePreset {
    readonly id: string;
    readonly labelZh: string;
    readonly part: BodyPart;
    readonly skeletonFamily: string;
    readonly bones: BoneRotationsByName;
    readonly custom: boolean;

    constructor(init: PosePresetJSON) {
        if (!init.id) throw new Error("PosePreset: id 不能为空");
        if (!init.labelZh) throw new Error(`PosePreset(${init.id}): labelZh 不能为空`);
        if (!isBodyPart(init.part)) throw new Error(`PosePreset(${init.id}): 未知部位 ${String(init.part)}`);
        if (!init.skeletonFamily) throw new Error(`PosePreset(${init.id}): skeletonFamily 不能为空`);
        const bones: Record<string, QuaternionTuple> = {};
        for (const boneName of Object.keys(init.bones).sort()) {
            const quaternion = init.bones[boneName];
            if (!boneName || !isQuaternionTuple(quaternion)) {
                throw new Error(`PosePreset(${init.id}): 骨骼 ${boneName} 的四元数非法`);
            }
            bones[boneName] = [quaternion[0], quaternion[1], quaternion[2], quaternion[3]];
        }
        if (Object.keys(bones).length === 0) throw new Error(`PosePreset(${init.id}): 至少需要一根骨骼`);
        this.id = init.id;
        this.labelZh = init.labelZh;
        this.part = init.part;
        this.skeletonFamily = init.skeletonFamily;
        this.bones = Object.freeze(bones);
        this.custom = init.custom;
        Object.freeze(this);
    }

    /** 整身预设不参与合成:应用时直接替换,不与另一列做并集。 */
    get isComposable(): boolean {
        return this.part !== BODY_PART.FULL;
    }

    toJSON(): PosePresetJSON {
        return {
            id: this.id,
            labelZh: this.labelZh,
            part: this.part,
            skeletonFamily: this.skeletonFamily,
            bones: this.bones,
            custom: this.custom,
        };
    }
}

/** 外部输入(文档/宿主/AI)的宽松解析:不合格返回 null 由调用方计数丢弃,不抛断链。 */
export function parsePosePreset(value: unknown): PosePreset | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const candidate = value as PosePresetJSON;
    if (typeof candidate.bones !== "object" || candidate.bones === null) return null;
    try {
        return new PosePreset({ ...candidate, custom: candidate.custom === true });
    } catch {
        return null;
    }
}
