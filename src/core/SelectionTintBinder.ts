import type { MeshStandardMaterial } from "three";

import type { CaptureMask } from "@/capture/CaptureMask";
import type { ObjectMaterialRegistry } from "@/core/ObjectMaterialRegistry";
import { SELECTION_ROLE } from "@/core/SelectionRole";
import type { SelectionRole } from "@/core/SelectionRole";

interface TintRecipe {
    /** 自发光色:与既有选中色同源,避免第二套视觉语言 */
    readonly emissiveHex: number;
    readonly intensity: number;
}

/** 角色 → 辉光配方查表(纪律:禁 if 链)。 */
const SELECTION_TINT: Record<SelectionRole, TintRecipe> = {
    [SELECTION_ROLE.PRIMARY]: { emissiveHex: 0xffd54f, intensity: 0.38 },
    [SELECTION_ROLE.SECONDARY]: { emissiveHex: 0xffd54f, intensity: 0.15 },
};

interface MaterialSnapshot {
    readonly emissiveHex: number;
    readonly intensity: number;
}

interface TintBinding {
    readonly role: SelectionRole;
    /** 着色时持有的材质引用:实体卸载时 registry 先释放,回查会拿到空表,还原就会漏 */
    readonly materials: readonly MeshStandardMaterial[];
    /** 与 materials 同序的原值:资产可能自带自发光,归零不等于还原 */
    readonly originals: readonly MaterialSnapshot[];
}

/**
 * 选中辉光的 Three 写方(运行时适配器,每桌一套,永不进 MobX)。
 *
 * 通道选择:只写 emissive/emissiveIntensity。人偶画像占用 color/metalness/roughness,
 * 抢同一 uniform 会让「取消选中」需要还原一个可能中途被改过的动态值;emissive 与画像正交,
 * 且内置人形材质 metallic=1 且无环境贴图(见 ActorAppearance),改 albedo 在画面上几乎不动,
 * 自发光是加法项,不吃这个亏。写 uniform 不改 shader 定义,不触发 program 重编译。
 *
 * 采集让位:实现 CaptureMask,截图与视频导出跟随 hideHelpers 收起辉光,成片零污染。
 */
export class SelectionTintBinder implements CaptureMask {
    private readonly bindings = new Map<string, TintBinding>();
    private isSuppressed = false;

    constructor(private readonly materials: ObjectMaterialRegistry) {}

    /** 着色;返回 false 表示该实例没有可着色材质,调用方回退线框。 */
    apply(objectId: string, role: SelectionRole): boolean {
        const existing = this.bindings.get(objectId);
        if (existing) {
            if (existing.role === role) return true;
            this.clear(objectId);
        }
        const materials = this.materials.materialsOf(objectId);
        if (materials.length === 0) return false;
        this.bindings.set(objectId, {
            role,
            materials,
            originals: materials.map((material) => ({
                emissiveHex: material.emissive.getHex(),
                intensity: material.emissiveIntensity,
            })),
        });
        if (!this.isSuppressed) paintTint(materials, SELECTION_TINT[role]);
        return true;
    }

    clear(objectId: string): void {
        const binding = this.bindings.get(objectId);
        if (!binding) return;
        this.bindings.delete(objectId);
        restoreTint(binding);
    }

    /** 采集开始:跟随 hideHelpers 收起辉光。 */
    suppress(): void {
        if (this.isSuppressed) return;
        this.isSuppressed = true;
        for (const binding of this.bindings.values()) restoreTint(binding);
    }

    /** 采集结束:按当前绑定重新着色(期间的选中变更已写进 bindings,复原即最新态)。 */
    restore(): void {
        if (!this.isSuppressed) return;
        this.isSuppressed = false;
        for (const binding of this.bindings.values()) paintTint(binding.materials, SELECTION_TINT[binding.role]);
    }

    dispose(): void {
        this.bindings.clear();
    }
}

function paintTint(materials: readonly MeshStandardMaterial[], recipe: TintRecipe): void {
    for (const material of materials) {
        material.emissive.setHex(recipe.emissiveHex);
        material.emissiveIntensity = recipe.intensity;
    }
}

function restoreTint(binding: TintBinding): void {
    for (const [index, material] of binding.materials.entries()) {
        const original = binding.originals[index];
        if (!original) continue;
        material.emissive.setHex(original.emissiveHex);
        material.emissiveIntensity = original.intensity;
    }
}
