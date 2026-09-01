import type { Vec3 } from "@/core/SceneObject";

export interface BoneScaleEntry {
    readonly boneName: string;
    /** 骨骼**局部**缩放(已按父级目标做过约除),运行时直接乘到 rest scale 上。 */
    readonly scale: Vec3;
}

/** 体型解算产物:纯数据,可缓存、可比较,不含任何 Three 引用。 */
export class BoneScalePlan {
    readonly entries: readonly BoneScaleEntry[];

    constructor(entries: readonly BoneScaleEntry[]) {
        this.entries = Object.freeze([...entries]);
        Object.freeze(this);
    }

    get isNeutral(): boolean {
        return this.entries.length === 0;
    }
}
