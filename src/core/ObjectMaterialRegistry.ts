import { Mesh } from "three";
import type { Material, MeshStandardMaterial, Object3D } from "three";

import { DisposeBag } from "@/core/DisposeBag";

function isStandardMaterial(material: Material): material is MeshStandardMaterial {
    return (material as MeshStandardMaterial).isMeshStandardMaterial === true;
}

/**
 * 模型实例可着色材质的唯一 owner(运行时适配器,每桌一套,永不进 MobX)。
 *
 * 必须克隆:ModelImporter 的实例克隆走 SkeletonUtils,几何与材质在同 URL 的所有实例间共享,
 * 直接改 uniform 会让全场同资产模型一起变,改缓存源还会跨桌泄漏。克隆体登记进本类的 DisposeBag,
 * 缓存源材质的释放权仍归 ModelImporter,两侧互不越界。
 *
 * 单一 owner 是硬约束:人偶画像(color/metalness/roughness)与选中辉光(emissive)是两个写入者,
 * 各自再克隆一次就会互相覆盖——谁后克隆谁生效,另一方的写入凭空消失。
 */
export class ObjectMaterialRegistry {
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

    /** 可着色槽位;空数组 = 该实例只有共享的非标准材质(OBJ/FBX 的 Phong/Basic),写入方必须回退。 */
    materialsOf(objectId: string): readonly MeshStandardMaterial[] {
        return this.materialsByObject.get(objectId) ?? EMPTY_MATERIALS;
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

    /** 非标准材质原样保留:人偶资产是单 PBR 材质,但注入模型不保证,写入只作用于能写的槽位。 */
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

const EMPTY_MATERIALS: readonly MeshStandardMaterial[] = [];
