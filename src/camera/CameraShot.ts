import type { Vec3 } from "@/core/SceneObject";

export const DEFAULT_CAMERA_FOV = 45;
/** 焦距围栏(领域常量):命令层与关键帧共用同一上下界,禁止两处各写一份 */
export const FOV_MIN = 1;
export const FOV_MAX = 179;

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

/** 景别中文标签(唯一真相源:机位面板/运镜落幅/布景 prompt 合成共用,禁两处漂移) */
export const SHOT_SIZE_LABEL: Record<ShotSize, string> = {
    [SHOT_SIZE.EXTREME_LONG]: "大远景",
    [SHOT_SIZE.LONG]: "远景",
    [SHOT_SIZE.MEDIUM_LONG]: "中远景",
    [SHOT_SIZE.MEDIUM]: "中景",
    [SHOT_SIZE.MEDIUM_CLOSE]: "中近景",
    [SHOT_SIZE.CLOSE_UP]: "特写",
    [SHOT_SIZE.EXTREME_CLOSE_UP]: "大特写",
};

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
