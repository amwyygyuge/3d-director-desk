import { MotionKey } from "@/motion/MotionKey";
import { MotionTrajectory } from "@/motion/MotionTrajectory";
import type { TransformKeyframe } from "@/timeline/TransformKeyframe";

const MINIMUM_TRAJECTORY_KEYS = 2;

/**
 * transform 轨的空间轨迹派生(纯函数,轨道构造期调用一次)。
 *
 * 领域边界:轨迹只认「形状与配速」,故关键帧的绝对秒在此归一化成 progress;
 * 绝对秒仍归关键帧所有(走位的时刻要与镜头切点对齐,不能被容器重定时改写)。
 * 退化情形(不足两帧 / 时间跨度为零)返回 null,采样端据此退回逐段直线。
 */
export function buildTransformTrajectory(keyframes: readonly TransformKeyframe[]): MotionTrajectory | null {
    if (keyframes.length < MINIMUM_TRAJECTORY_KEYS) return null;
    const first = keyframes[0];
    const last = keyframes[keyframes.length - 1];
    if (!first || !last) return null;
    const span = last.time - first.time;
    if (span <= 0) return null;
    return new MotionTrajectory(
        keyframes.map(
            (keyframe) =>
                new MotionKey({
                    id: keyframe.id,
                    progress: (keyframe.time - first.time) / span,
                    position: keyframe.value.position,
                    inHandle: keyframe.inHandle,
                    outHandle: keyframe.outHandle,
                    handleMode: keyframe.handleMode,
                }),
        ),
    );
}
