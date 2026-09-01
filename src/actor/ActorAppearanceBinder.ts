import { Mesh } from "three";
import type { Material, MeshStandardMaterial, Object3D } from "three";

import type { ActorAppearance } from "@/actor/ActorAppearance";
import { DisposeBag } from "@/core/DisposeBag";

function isStandardMaterial(material: Material): material is MeshStandardMaterial {
    return (material as MeshStandardMaterial).isMeshStandardMaterial === true;
}

/**
 * 人偶外观的 Three 写方(运行时适配器,每桌一套,永不进 MobX)。
 *
 * 必须克隆材质:ModelImporter 的实例克隆走 SkeletonUtils,几何与材质在同 URL 的所有实例间共享,
 * 直接改 color 会让全场人偶同色,改缓存源还会跨桌泄漏。克隆体登记进本类的 DisposeBag,
 * 缓存源材质的释放权仍归 ModelImporter,两侧互不越界。
 *
 * 着色只写 uniform(color/metalness/roughness),不改 shader 定义,因此不触发 program 重编译。
 */
export class ActorAppearanceBinder {
    private readonly materialsByObject = new Map<string, readonly MeshStandardMaterial[]>();
    private readonly disposeBag = new DisposeBag();

    attach(objectId: string, root: Object3D): void {
        this.detach(objectId);
        const materials = this.cloneMaterials(root);
        this.materialsByObject.set(objectId, materials);
        this.disposeBag.register(() => this.disposeMaterials(materials));
    }

    detach(objectId: string): void {
        const materials = this.materialsByObject.get(objectId);
        if (!materials) return;
        this.materialsByObject.delete(objectId);
        this.disposeMaterials(materials);
    }

    paint(objectId: string, appearance: ActorAppearance): void {
        const materials = this.materialsByObject.get(objectId);
        if (!materials) return;
        const params = appearance.surfaceParams;
        for (const material of materials) {
            material.color.set(appearance.baseColorHex);
            material.metalness = params.metalness;
            material.roughness = params.roughness;
        }
    }

    dispose(): void {
        this.materialsByObject.clear();
        this.disposeBag.dispose();
    }

    private cloneMaterials(root: Object3D): readonly MeshStandardMaterial[] {
        const meshes: Mesh[] = [];
        root.traverse((node) => {
            if (node instanceof Mesh) meshes.push(node);
        });
        return meshes.flatMap((mesh) => this.replaceMeshMaterials(mesh));
    }

    /** 非标准材质原样保留:人偶资产是单 PBR 材质,但注入模型不保证,着色只作用于能着色的槽位。 */
    private replaceMeshMaterials(mesh: Mesh): readonly MeshStandardMaterial[] {
        const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const replacements = sources.map((material) => (isStandardMaterial(material) ? material.clone() : material));
        mesh.material = Array.isArray(mesh.material) ? replacements : replacements[0]!;
        return replacements.filter(isStandardMaterial);
    }

    private disposeMaterials(materials: readonly MeshStandardMaterial[]): void {
        for (const material of materials) material.dispose();
    }
}
