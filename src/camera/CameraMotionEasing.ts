/**
 * 运镜缓动(值语义):只有两档,节奏靠关键帧密度 + 缓动组合表达。
 * 独立成模块是为了让 CameraKey 与 CameraMotionClip 互不循环引用。
 */
export const CAMERA_MOTION_EASING = {
    LINEAR: "linear",
    SMOOTH: "smooth",
} as const;
export type CameraMotionEasing = (typeof CAMERA_MOTION_EASING)[keyof typeof CAMERA_MOTION_EASING];

export function isCameraMotionEasing(value: unknown): value is CameraMotionEasing {
    return value === CAMERA_MOTION_EASING.LINEAR || value === CAMERA_MOTION_EASING.SMOOTH;
}

/** 段内缓动求值:smooth 用 smoothstep,linear 原样返回。 */
export function easedProgress(easing: CameraMotionEasing, progress: number): number {
    return easing === CAMERA_MOTION_EASING.SMOOTH ? progress * progress * (3 - 2 * progress) : progress;
}
