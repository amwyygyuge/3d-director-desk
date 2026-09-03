import type { ActorAppearance } from "@/actor/ActorAppearance";
import type { ObjectMaterialRegistry } from "@/core/ObjectMaterialRegistry";

/**
 * 人偶外观的 Three 写方(运行时适配器,每桌一套,永不进 MobX)。
 *
 * 材质克隆归 ObjectMaterialRegistry 唯一持有:本类与选中辉光(SelectionTintBinder)是同一批
 * 克隆材质上的两个写入者,各自再克隆一次会互相覆盖。
 *
 * 着色只写 uniform(color/metalness/roughness),不改 shader 定义,因此不触发 program 重编译;
 * emissive 留给选中辉光,两个写入者的通道正交,取消选中不需要还原画像的动态值。
 */
export class ActorAppearanceBinder {
    constructor(private readonly materials: ObjectMaterialRegistry) {}

    paint(objectId: string, appearance: ActorAppearance): void {
        const params = appearance.surfaceParams;
        for (const material of this.materials.materialsOf(objectId)) {
            material.color.set(appearance.baseColorHex);
            material.metalness = params.metalness;
            material.roughness = params.roughness;
        }
    }
}
