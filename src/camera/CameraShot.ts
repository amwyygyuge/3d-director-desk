import type { Vec3 } from "../core/SceneObject";

/** 景别:业务资产视角的镜头规格 */
export const SHOT_SIZE = {
    EXTREME_LONG: "extreme-long",
    LONG: "long",
    MEDIUM_LONG: "medium-long",
    MEDIUM: "medium",
    MEDIUM_CLOSE: "medium-close",
    CLOSE_UP: "close-up",
    EXTREME_CLOSE_UP: "extreme-close-up",
} as const;
export type ShotSize = (typeof SHOT_SIZE)[keyof typeof SHOT_SIZE];

/**
 * 机位值对象:由属性值定义、不可变。
 * 一个机位 = 相机位置 + 注视目标 + 焦距(FOV)。
 */
export class CameraShot {
    readonly position: Vec3;
    readonly target: Vec3;
    readonly fov: number;

    constructor(init: { position: Vec3; target: Vec3; fov?: number }) {
        this.position = init.position;
        this.target = init.target;
        this.fov = init.fov ?? 45;
        Object.freeze(this);
    }

    equals(other: CameraShot): boolean {
        const eq = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 1e-6);
        return eq(this.position, other.position) && eq(this.target, other.target) && this.fov === other.fov;
    }

    toJSON(): { position: Vec3; target: Vec3; fov: number } {
        return { position: this.position, target: this.target, fov: this.fov };
    }
}
