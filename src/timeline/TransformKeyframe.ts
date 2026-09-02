import type { Transform, Vec3 } from "@/core/SceneObject";
import { copyVec3, MOTION_HANDLE_MODE } from "@/motion/MotionKey";
import type { MotionHandleMode } from "@/motion/MotionKey";

export const TIMELINE_EASING = {
    LINEAR: "linear",
    SMOOTH: "smooth",
} as const;

export type TimelineEasing = (typeof TIMELINE_EASING)[keyof typeof TIMELINE_EASING];

const ZERO_HANDLE: Vec3 = [0, 0, 0];

export interface TransformKeyframeInit {
    readonly id: string;
    readonly time: number;
    readonly value: Transform;
    readonly easing: TimelineEasing;
    /** 位置切线手柄:相对本帧位置的偏移。auto 模式下由 AutoHandleSolver 覆写,此处的值不参与求值。 */
    readonly inHandle?: Vec3;
    readonly outHandle?: Vec3;
    /** auto = 切线随相邻帧自动平滑;manual = 作者已接管该点切线。 */
    readonly handleMode?: MotionHandleMode;
}

function copyVector([x, y, z]: Transform["position"]): Transform["position"] {
    return [x, y, z];
}

function copyTransform(value: Transform): Transform {
    return {
        position: copyVector(value.position),
        rotation: copyVector(value.rotation),
        scale: copyVector(value.scale),
    };
}

/**
 * 可序列化的变换关键帧值对象；时间采用绝对秒。
 *
 * 位置通道额外携带轨迹切线手柄:走位是空间曲线而非逐段直线,曲线形状由整条轨的
 * 关键帧共同决定(派生见 buildTransformTrajectory),但「以什么切线经过这一点」
 * 属于该点自身的属性,故随关键帧存储、随关键帧撤销。
 */
export class TransformKeyframe {
    readonly id: string;
    readonly time: number;
    readonly value: Transform;
    readonly easing: TimelineEasing;
    readonly inHandle: Vec3;
    readonly outHandle: Vec3;
    readonly handleMode: MotionHandleMode;

    constructor(init: TransformKeyframeInit) {
        this.id = init.id;
        this.time = init.time;
        this.value = copyTransform(init.value);
        this.easing = init.easing;
        this.inHandle = copyVec3(init.inHandle ?? ZERO_HANDLE);
        this.outHandle = copyVec3(init.outHandle ?? ZERO_HANDLE);
        this.handleMode = init.handleMode ?? MOTION_HANDLE_MODE.AUTO;
        Object.freeze(this.value.position);
        Object.freeze(this.value.rotation);
        Object.freeze(this.value.scale);
        Object.freeze(this.value);
        Object.freeze(this.inHandle);
        Object.freeze(this.outHandle);
        Object.freeze(this);
    }

    toJSON(): TransformKeyframeInit {
        return {
            id: this.id,
            time: this.time,
            value: copyTransform(this.value),
            easing: this.easing,
            inHandle: copyVec3(this.inHandle),
            outHandle: copyVec3(this.outHandle),
            handleMode: this.handleMode,
        };
    }
}
