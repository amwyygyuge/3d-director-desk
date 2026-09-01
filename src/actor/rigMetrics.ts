import type { Object3D } from "three";

const BONE_TYPE = "Bone";
const WORLD_Y_OFFSET_INDEX = 13;

interface BoneSpan {
    readonly lowestY: number;
    readonly highestY: number;
}

function measureBoneSpan(root: Object3D): BoneSpan | null {
    root.updateWorldMatrix(true, true);
    const span = { lowestY: Number.POSITIVE_INFINITY, highestY: Number.NEGATIVE_INFINITY };
    root.traverse((node) => {
        if (node.type !== BONE_TYPE) return;
        const worldY = node.matrixWorld.elements[WORLD_Y_OFFSET_INDEX] ?? 0;
        span.lowestY = Math.min(span.lowestY, worldY);
        span.highestY = Math.max(span.highestY, worldY);
    });
    return Number.isFinite(span.lowestY) && Number.isFinite(span.highestY) ? span : null;
}

/**
 * 骨骼世界坐标度量(人偶的唯一可信尺度读数)。
 *
 * 内置人形是 armature 缩放型 rig:`SkinnedMesh.computeBoundingBox` 的局部盒随壳层缩放线性膨胀,
 * 再乘 `matrixWorld` 就成了二次量——按包围盒定身高会逐次放大一个数量级,按包围盒贴地会把人偶埋进地下
 * (两者均已实测)。蒙皮顶点跟随骨骼,所以骨骼世界 Y 是线性且可重入的。
 */
export function boneSpanY(root: Object3D): number {
    const span = measureBoneSpan(root);
    return span ? span.highestY - span.lowestY : 0;
}

export function lowestBoneWorldY(root: Object3D): number | null {
    return measureBoneSpan(root)?.lowestY ?? null;
}
