import { BoneScalePlan } from "@/actor/BoneScalePlan";
import type { BoneScaleEntry } from "@/actor/BoneScalePlan";
import type { ActorBuild } from "@/actor/ActorBuild";
import {
    SKELETON_BONE_ORDER,
    SKELETON_LIMB_GIRTH_BONES,
    SKELETON_SHOULDER_BONES,
    SKELETON_TORSO_GIRTH_BONES,
    skeletonParentOf,
} from "@/actor/actorSkeleton";
import type { Vec3 } from "@/core/SceneObject";

const NEUTRAL_SCALE: Vec3 = [1, 1, 1];

/** 四肢围度跟随躯干的比例:等比会让手臂随肚子一起膨胀,减弱后才像「壮」而不是「肿」。 */
const LIMB_GIRTH_RATIO = 0.6;

function isNeutral(scale: Vec3): boolean {
    return scale[0] === 1 && scale[1] === 1 && scale[2] === 1;
}

/**
 * 体型解算(领域服务,纯计算):体型参数 → 每根骨骼的局部缩放。
 *
 * 规则只有一条:表里给的是每根骨骼的**目标累计缩放**,局部缩放 = 目标 ÷ 父目标。
 * 未列入表的骨骼目标为恒等,于是被缩放骨骼的子级自动得到逆补偿——手、脚、头不会跟着躯干变形,
 * 无需单独维护「末端补偿名单」。
 *
 * 已知近似:父子骨骼坐标系存在旋转时,非均匀缩放的抵消不是精确逆运算(踝、髋处最明显)。
 * 因此围度/肩宽的取值区间被刻意收窄(见 ActorBuild),把剪切留在肉眼不可辨的量级。
 * 身高不走骨骼——它由归一化策略在壳层等比缩放兑现,等比不产生剪切。
 */
export class BodyBuildSolver {
    solve(build: ActorBuild): BoneScalePlan {
        const targets = this.targetScales(build);
        const entries = SKELETON_BONE_ORDER.flatMap((boneName) => this.localEntry(boneName, targets));
        return new BoneScalePlan(entries);
    }

    private localEntry(boneName: string, targets: ReadonlyMap<string, Vec3>): readonly BoneScaleEntry[] {
        const target = targets.get(boneName) ?? NEUTRAL_SCALE;
        const parentName = skeletonParentOf(boneName);
        const parentTarget = (parentName ? targets.get(parentName) : undefined) ?? NEUTRAL_SCALE;
        const local: Vec3 = [target[0] / parentTarget[0], target[1] / parentTarget[1], target[2] / parentTarget[2]];
        return isNeutral(local) ? [] : [{ boneName, scale: local }];
    }

    private targetScales(build: ActorBuild): ReadonlyMap<string, Vec3> {
        const torso: Vec3 = [build.girthScale, 1, build.girthScale];
        const limbGirth = 1 + (build.girthScale - 1) * LIMB_GIRTH_RATIO;
        const limb: Vec3 = [limbGirth, 1, limbGirth];
        // clavicle 骨的局部 +Y 指向 upperarm(rest 偏移 [0.019,0.141,0.081]),故纵向缩放即横向加宽肩带
        const shoulder: Vec3 = [1, build.shoulderScale, 1];
        return new Map<string, Vec3>([
            ...SKELETON_TORSO_GIRTH_BONES.map((boneName) => [boneName, torso] as const),
            ...SKELETON_LIMB_GIRTH_BONES.map((boneName) => [boneName, limb] as const),
            ...SKELETON_SHOULDER_BONES.map((boneName) => [boneName, shoulder] as const),
        ]);
    }
}
