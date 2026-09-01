import type { Vec3 } from "@/core/SceneObject";

export const DEFAULT_CAMERA_FOV = 45;

function copyVec3([x, y, z]: Vec3): Vec3 {
    return Object.freeze([x, y, z] as const);
}
/** 机位的可序列化形态(toJSON 返回类型;文档/命令载荷共用) */
export type CameraShotJSON = { position: Vec3; target: Vec3; fov: number };

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
        const fov = init.fov ?? DEFAULT_CAMERA_FOV;
        if (!Number.isFinite(fov)) {
            throw new Error("CameraShot: fov must be finite");
        }
        this.position = copyVec3(init.position);
        this.target = copyVec3(init.target);
        this.fov = fov;
        Object.freeze(this);
    }

    equals(other: CameraShot): boolean {
        const eq = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 1e-6);
        return eq(this.position, other.position) && eq(this.target, other.target) && this.fov === other.fov;
    }

    toJSON(): CameraShotJSON {
        return { position: copyVec3(this.position), target: copyVec3(this.target), fov: this.fov };
    }
}
