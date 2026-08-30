import { Box3, Mesh, SkinnedMesh } from "three";
import type { Object3D } from "three";

const TMP_MEASURE_BOX = new Box3();

/**
 * 模型包围盒测量(渲染层归一化壳与 scene.describe 查询共用,Rule of Two):
 * 蒙皮网格必须算骨架构形后的真实顶点——setFromObject 只看绑定几何,
 * armature 缩放型 rig(如 RobotExpressive 的 ×100)会测出谬误尺寸。
 * 注意先 skeleton.update():boneMatrices 平时由渲染器更新,加载期测量必须自己补,否则拿到未初始化矩阵。
 */
export function measureModelBox(object3d: Object3D, target: Box3): void {
    object3d.updateWorldMatrix(true, true);
    target.makeEmpty();
    object3d.traverse((node) => {
        const isSkinned = node instanceof SkinnedMesh;
        if (!isSkinned && !(node instanceof Mesh)) return;
        if (isSkinned) {
            node.skeleton.update();
            node.computeBoundingBox();
            TMP_MEASURE_BOX.copy(node.boundingBox).applyMatrix4(node.matrixWorld);
        } else if (node instanceof Mesh) {
            node.geometry.computeBoundingBox();
            if (!node.geometry.boundingBox) return;
            TMP_MEASURE_BOX.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
        }
        target.union(TMP_MEASURE_BOX);
    });
}
