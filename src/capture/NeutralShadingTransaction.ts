import { Mesh, MeshStandardMaterial } from "three";
import type { Material, Object3D } from "three";

/**
 * 中性着色材质(模块级单例,零逐网格分配):压塑料高光的黏土灰。
 * 定位:成片喂视频模型时,外观会被重打——中性帧不把 previz 质感带进生成结果,
 * 让结构(站位/剪影/运动)穿过去,外观交给模型。着色随工作室光呈现体积。
 */
const NEUTRAL_MATERIAL = new MeshStandardMaterial({ color: 0xb4b4b4, roughness: 0.85, metalness: 0 });

/**
 * 采集期中性着色事务(镜像 HelperVisibilityTransaction):
 * apply 一次遍历(冷路径,非渲染循环)把可见网格材质换成中性单例,restore 精确复位。
 * 材质引用是 three 运行时,存普通 Map,永不进 observable(红线 3)。
 */
export class NeutralShadingTransaction {
    private readonly originals = new Map<Mesh, Material | Material[]>();

    apply(root: Object3D): void {
        root.traverse((node) => {
            if (!(node instanceof Mesh) || !node.visible) return;
            this.originals.set(node, node.material);
            node.material = NEUTRAL_MATERIAL;
        });
    }

    restore(): void {
        for (const [mesh, material] of this.originals) mesh.material = material;
        this.originals.clear();
    }
}
