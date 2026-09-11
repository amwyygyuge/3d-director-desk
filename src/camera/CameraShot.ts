import { CameraLens } from "@/camera/CameraLens";
import type { CameraLensJSON } from "@/camera/CameraLens";
import type { Vec3 } from "@/core/SceneObject";

/** 焦距围栏(领域常量):定义在 CameraLens(焦距围栏由它派生),此处 re-export 保持既有调用点不变。 */
export { FOV_MAX, FOV_MIN } from "@/camera/CameraLens";

export const DEFAULT_CAMERA_FOV = 45;

function copyVec3([x, y, z]: Vec3): Vec3 {
    return Object.freeze([x, y, z] as const);
}
/** 机位的可序列化形态(toJSON 返回类型;文档/命令载荷共用) */
export type CameraShotJSON = { position: Vec3; target: Vec3; fov: number; lens: CameraLensJSON };

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
 * 一个机位 = 相机位置 + 注视目标 + 焦距(FOV) + 镜头光学参数。
 *
 * `fov` 与镜头的关系:焦距(mm)是 `fov` 的**派生视图**(见 `CameraLens` 的换算),
 * 不另存一份——两份必然漂移。`lens` 只放 fov 表达不了的光学量:光圈与对焦距离。
 */
export class CameraShot {
    readonly position: Vec3;
    readonly target: Vec3;
    readonly fov: number;
    readonly lens: CameraLens;

    constructor(init: { position: Vec3; target: Vec3; fov?: number; lens?: CameraLensJSON | CameraLens }) {
        const fov = init.fov ?? DEFAULT_CAMERA_FOV;
        if (!Number.isFinite(fov)) {
            throw new Error("CameraShot: fov must be finite");
        }
        this.position = copyVec3(init.position);
        this.target = copyVec3(init.target);
        this.fov = fov;
        this.lens = init.lens instanceof CameraLens ? init.lens : new CameraLens(init.lens);
        Object.freeze(this);
    }

    equals(other: CameraShot): boolean {
        const eq = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 1e-6);
        return (
            eq(this.position, other.position) &&
            eq(this.target, other.target) &&
            this.fov === other.fov &&
            this.lens.equals(other.lens)
        );
    }

    toJSON(): CameraShotJSON {
        return {
            position: copyVec3(this.position),
            target: copyVec3(this.target),
            fov: this.fov,
            lens: this.lens.toJSON(),
        };
    }
}
