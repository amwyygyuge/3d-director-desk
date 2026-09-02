import { PathSimplifier } from "@/authoring/PathSimplifier";
import type { Transform, Vec3 } from "@/core/SceneObject";
import { TIMELINE_EASING } from "@/timeline/TransformKeyframe";
import type { TransformKeyframeInit } from "@/timeline/TransformKeyframe";

/** 抽稀阈值 = 路径长度 × 本比例:与场景尺度无关,大场景不退化成折线,小场景不抹平细节。 */
const SIMPLIFY_RATIO = 0.02;
/** 默认步行速度(米/秒):路径越长时长越长,落笔即匀速,不必手调时长去对付脚滑。 */
export const DEFAULT_WALK_SPEED_MPS = 1.4;
/** 一次绘制至少要两个点才构成走位。 */
const MINIMUM_DRAFT_POINTS = 2;

export interface WalkDraftInput {
    /** 绘制平面上的原始采样点(世界坐标) */
    readonly points: readonly Vec3[];
    /** 基准变换:走位只改位置,旋转与缩放沿用对象当前值(朝向策略是后续能力) */
    readonly base: Transform;
    readonly startSeconds: number;
    readonly speedMetersPerSecond?: number;
}

function distanceBetween(from: Vec3, to: Vec3): number {
    const x = to[0] - from[0];
    const y = to[1] - from[1];
    const z = to[2] - from[2];
    return Math.sqrt(x * x + y * y + z * z);
}

function totalLength(points: readonly Vec3[]): number {
    return points.reduce((sum, point, index) => {
        const previous = points[index - 1];
        return previous ? sum + distanceBetween(previous, point) : sum;
    }, 0);
}

/** 累计弧长 → 绝对秒:匀速行进,时刻由「走了多远」决定,而非把点均分到固定时长。 */
function keyframeAt({
    point,
    elapsedMeters,
    base,
    startSeconds,
    speed,
}: {
    readonly point: Vec3;
    readonly elapsedMeters: number;
    readonly base: Transform;
    readonly startSeconds: number;
    readonly speed: number;
}): TransformKeyframeInit {
    return {
        id: crypto.randomUUID(),
        time: startSeconds + elapsedMeters / speed,
        value: { position: point, rotation: base.rotation, scale: base.scale },
        easing: TIMELINE_EASING.LINEAR,
    };
}

/**
 * 走位草绘编译器(领域服务,无状态):原始笔迹 → 可编辑的关键帧序列。
 *
 * 两条设计:
 * - 空间与时间分离——抽稀只管形状,时刻由弧长除以速度得出;重画形状不必重设时长。
 * - 产物就是标准 TransformKeyframe——绘制不是第二种数据,后续拖点/改时间与手打的关键帧同路。
 */
export class WalkDraftCompiler {
    constructor(private readonly simplifier = new PathSimplifier()) {}

    compile({ points, base, startSeconds, speedMetersPerSecond }: WalkDraftInput): readonly TransformKeyframeInit[] {
        if (points.length < MINIMUM_DRAFT_POINTS) return [];
        const pathLength = totalLength(points);
        if (pathLength === 0) return [];
        const speed = speedMetersPerSecond ?? DEFAULT_WALK_SPEED_MPS;
        const simplified = this.simplifier.simplify(points, pathLength * SIMPLIFY_RATIO);
        return simplified.reduce<{ elapsed: number; keyframes: TransformKeyframeInit[] }>(
            (accumulated, point, index) => {
                const previous = simplified[index - 1];
                const elapsed = previous ? accumulated.elapsed + distanceBetween(previous, point) : 0;
                accumulated.keyframes.push(keyframeAt({ point, elapsedMeters: elapsed, base, startSeconds, speed }));
                return { elapsed, keyframes: accumulated.keyframes };
            },
            { elapsed: 0, keyframes: [] },
        ).keyframes;
    }
}
