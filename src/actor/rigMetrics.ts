import { Matrix4, Vector3 } from "three";
import type { Object3D } from "three";

const BONE_TYPE = "Bone";
const WORLD_Y_OFFSET_INDEX = 13;

const TMP_INVERSE_ROOT = new Matrix4();
const TMP_BONE_POSITION = new Vector3();

interface BoneSpan {
    readonly lowestY: number;
    readonly highestY: number;
}

function measureBoneSpan(root: Object3D, relativeTo?: Object3D): BoneSpan | null {
    root.updateWorldMatrix(true, true);
    const frame = relativeTo ?? null;
    if (frame) {
        frame.updateWorldMatrix(true, true);
        TMP_INVERSE_ROOT.copy(frame.matrixWorld).invert();
    }
    const span = { lowestY: Number.POSITIVE_INFINITY, highestY: Number.NEGATIVE_INFINITY };
    root.traverse((node) => {
        if (node.type !== BONE_TYPE) return;
        let y: number;
        if (frame) {
            TMP_BONE_POSITION.setFromMatrixPosition(node.matrixWorld).applyMatrix4(TMP_INVERSE_ROOT);
            y = TMP_BONE_POSITION.y;
        } else {
            y = node.matrixWorld.elements[WORLD_Y_OFFSET_INDEX] ?? 0;
        }
        span.lowestY = Math.min(span.lowestY, y);
        span.highestY = Math.max(span.highestY, y);
    });
    return Number.isFinite(span.lowestY) && Number.isFinite(span.highestY) ? span : null;
}

/**
 * 骨骼坐标度量(人偶的唯一可信尺度读数)。
 *
 * 内置人形是 armature 缩放型 rig:`SkinnedMesh.computeBoundingBox` 的局部盒随壳层缩放线性膨胀,
 * 再乘 `matrixWorld` 就成了二次量——按包围盒定身高会逐次放大一个数量级,按包围盒贴地会把人偶埋进地下
 * (两者均已实测)。蒙皮顶点跟随骨骼,所以骨骼 Y 是线性且可重入的。
 *
 * `relativeTo` 给定时按该节点的局部坐标系测量。做「身高 ÷ 壳缩放」的比值时必须用它:
 * 世界口径会把承载实体 transform 的父级 scale 一并读进跨度,而分母只有壳层自己的 scale,
 * 父级缩放就漏进标定量(实测 scale.y=2.6 的实体标定量偏大 2.6 倍,人偶落尺随之错同样倍数)。
 */
export function boneSpanY(root: Object3D, relativeTo?: Object3D): number {
    const span = relativeTo ? measureBoneSpan(root, relativeTo) : measureBoneSpan(root);
    return span ? span.highestY - span.lowestY : 0;
}

/** 贴地用的世界口径最低骨骼 Y:与场景地面同一坐标系,不能改成局部。 */
export function lowestBoneWorldY(root: Object3D): number | null {
    return measureBoneSpan(root)?.lowestY ?? null;
}
