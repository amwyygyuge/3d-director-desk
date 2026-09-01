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

/**
 * 缓动反解:轨迹参数 → 归一化时间。
 *
 * 时间曲线把「时间」映射成「轨迹参数」,所以任何要把关键帧摆回时间轴(菱形位置、跳转、吸附)
 * 的地方都必须走这条反函数,否则关键帧的显示时刻与它实际出画的时刻对不上。
 * smoothstep 的闭式反解:p = 1/2 - sin(asin(1 - 2v) / 3)。
 */
export function inverseEasedProgress(easing: CameraMotionEasing, value: number): number {
    if (easing !== CAMERA_MOTION_EASING.SMOOTH) return value;
    const clamped = Math.min(Math.max(value, 0), 1);
    return 0.5 - Math.sin(Math.asin(1 - 2 * clamped) / 3);
}
