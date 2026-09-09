import { Box3, Matrix4, Mesh, SkinnedMesh } from "three";
import type { Object3D } from "three";

const TMP_MEASURE_BOX = new Box3();
const TMP_INVERSE_ROOT = new Matrix4();
const TMP_RELATIVE_MATRIX = new Matrix4();

/**
 * 模型包围盒测量(渲染层归一化壳与 scene.describe 查询共用,Rule of Two):
 * 蒙皮网格必须算骨架构形后的真实顶点——setFromObject 只看绑定几何,
 * armature 缩放型 rig(如 RobotExpressive 的 ×100)会测出谬误尺寸。
 * 注意先 skeleton.update():boneMatrices 平时由渲染器更新,加载期测量必须自己补,否则拿到未初始化矩阵。
 *
 * `relativeTo` 给定时按该节点的局部坐标系测量,而不是世界坐标系。归一化必须用它:
 * 壳层挂在承载实体 transform 的 group 之下,世界口径会把实体 scale 读进尺寸,
 * 于是落尺系数恰好抵消实体缩放(实测背景墙 scale 14 → 壳层 1/14,墙被压回单位盒而不可见)。
 */
export function measureModelBox(object3d: Object3D, target: Box3, relativeTo?: Object3D): void {
    object3d.updateWorldMatrix(true, true);
    target.makeEmpty();
    const root = relativeTo ?? null;
    if (root) {
        root.updateWorldMatrix(true, true);
        TMP_INVERSE_ROOT.copy(root.matrixWorld).invert();
    }
    object3d.traverse((node) => {
        const isSkinned = node instanceof SkinnedMesh;
        if (!isSkinned && !(node instanceof Mesh)) return;
        if (isSkinned) {
            node.skeleton.update();
            node.computeBoundingBox();
            TMP_MEASURE_BOX.copy(node.boundingBox);
        } else if (node instanceof Mesh) {
            node.geometry.computeBoundingBox();
            if (!node.geometry.boundingBox) return;
            TMP_MEASURE_BOX.copy(node.geometry.boundingBox);
        }
        if (root) {
            TMP_RELATIVE_MATRIX.multiplyMatrices(TMP_INVERSE_ROOT, node.matrixWorld);
            TMP_MEASURE_BOX.applyMatrix4(TMP_RELATIVE_MATRIX);
        } else {
            TMP_MEASURE_BOX.applyMatrix4(node.matrixWorld);
        }
        target.union(TMP_MEASURE_BOX);
    });
}
