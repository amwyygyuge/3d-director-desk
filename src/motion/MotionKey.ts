import { finiteVec3 } from "@/core/SceneObject";
import type { Vec3 } from "@/core/SceneObject";

/**
 * 手柄模式:auto = 切线由 AutoHandleSolver 求解(移动关键点曲线自动保持平滑);
 * manual = 作者接管切线,系统不再覆写。
 */
export const MOTION_HANDLE_MODE = {
    AUTO: "auto",
    MANUAL: "manual",
} as const;
export type MotionHandleMode = (typeof MOTION_HANDLE_MODE)[keyof typeof MOTION_HANDLE_MODE];

export const MOTION_PROGRESS_MIN = 0;
export const MOTION_PROGRESS_MAX = 1;

const ZERO_HANDLE: Vec3 = [0, 0, 0];

export interface MotionKeyInit {
    readonly id: string;
    /** 归一化进度:时长变化时轨迹形状不变(重定时免重画) */
    readonly progress: number;
    readonly position: Vec3;
    readonly inHandle?: Vec3;
    readonly outHandle?: Vec3;
    readonly handleMode?: MotionHandleMode;
}

export interface MotionKeyJSON {
    readonly id: string;
    readonly progress: number;
    readonly position: Vec3;
    readonly inHandle: Vec3;
    readonly outHandle: Vec3;
    readonly handleMode: MotionHandleMode;
}

/** 轨迹采样的最小结构契约:相机/模型各自的关键帧类只需满足它即可复用同一条曲线实现。 */
export interface MotionKeyLike {
    readonly id: string;
    readonly progress: number;
    readonly position: Vec3;
    readonly inHandle: Vec3;
    readonly outHandle: Vec3;
    readonly handleMode: MotionHandleMode;
}

export function copyVec3(vector: Vec3): Vec3 {
    return [vector[0], vector[1], vector[2]];
}

export function isMotionProgress(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= MOTION_PROGRESS_MIN && value <= MOTION_PROGRESS_MAX;
}

function isHandleMode(value: MotionHandleMode): boolean {
    return value === MOTION_HANDLE_MODE.AUTO || value === MOTION_HANDLE_MODE.MANUAL;
}

/**
 * 空间轨迹关键点(值对象,不可变)。
 *
 * 领域边界:它只描述「在归一化进度 p 处经过哪个世界点、以什么切线经过」——
 * 与「谁在走这条轨迹」(相机/模型)无关,故住在通用 motion 模块而非相机领域。
 * 手柄是相对关键点位置的偏移,平移整条轨迹时无需重算。
 */
export class MotionKey implements MotionKeyLike {
    readonly id: string;
    readonly progress: number;
    readonly position: Vec3;
    readonly inHandle: Vec3;
    readonly outHandle: Vec3;
    readonly handleMode: MotionHandleMode;

    constructor(init: MotionKeyInit) {
        const inHandle = init.inHandle ?? ZERO_HANDLE;
        const outHandle = init.outHandle ?? ZERO_HANDLE;
        const handleMode = init.handleMode ?? MOTION_HANDLE_MODE.AUTO;
        if (
            init.id.length === 0 ||
            !isMotionProgress(init.progress) ||
            !finiteVec3(init.position) ||
            !finiteVec3(inHandle) ||
            !finiteVec3(outHandle) ||
            !isHandleMode(handleMode)
        ) {
            throw new Error("MotionKey requires a stable id, progress in [0,1], and finite vectors");
        }
        this.id = init.id;
        this.progress = init.progress;
        this.position = copyVec3(init.position);
        this.inHandle = copyVec3(inHandle);
        this.outHandle = copyVec3(outHandle);
        this.handleMode = handleMode;
        // 只有最派生类冻结:基类提前冻结会让子类(CameraKey)的字段赋值在严格模式下抛错
        if (new.target === MotionKey) Object.freeze(this);
    }

    /** 子类以协变返回类型覆盖它,即可让全部 with* 操作返回自身类型。 */
    protected replicate(overrides: Partial<MotionKeyJSON>): MotionKey {
        return new MotionKey({ ...this.toJSON(), ...overrides });
    }

    withProgress(progress: number): MotionKey {
        return this.replicate({ progress });
    }

    withPosition(position: Vec3): MotionKey {
        return this.replicate({ position });
    }

    /** 拖动手柄即接管切线:模式随之切 manual,系统不再自动平滑该点。 */
    withHandle(kind: "in" | "out", value: Vec3): MotionKey {
        const handles = kind === "in" ? { inHandle: value } : { outHandle: value };
        return this.replicate({ ...handles, handleMode: MOTION_HANDLE_MODE.MANUAL });
    }

    withAutoHandles(): MotionKey {
        return this.replicate({
            inHandle: ZERO_HANDLE,
            outHandle: ZERO_HANDLE,
            handleMode: MOTION_HANDLE_MODE.AUTO,
        });
    }

    toJSON(): MotionKeyJSON {
        return {
            id: this.id,
            progress: this.progress,
            position: copyVec3(this.position),
            inHandle: copyVec3(this.inHandle),
            outHandle: copyVec3(this.outHandle),
            handleMode: this.handleMode,
        };
    }
}
