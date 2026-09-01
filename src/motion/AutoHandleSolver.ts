import { MOTION_HANDLE_MODE } from "@/motion/MotionKey";
import type { MotionKeyLike } from "@/motion/MotionKey";

/** Catmull-Rom → 三次 Bézier 的标准切线权重:控制点落在相邻弦长的三分之一处。 */
const CATMULL_ROM_TANGENT_WEIGHT = 1 / 6;

/** 求解结果:相对关键点位置的入/出手柄偏移,与 MotionKey 的手柄语义同构。 */
export interface MotionHandlePair {
    inX: number;
    inY: number;
    inZ: number;
    outX: number;
    outY: number;
    outZ: number;
}

export function createHandlePair(): MotionHandlePair {
    return { inX: 0, inY: 0, inZ: 0, outX: 0, outY: 0, outZ: 0 };
}

/** 端点用镜像虚拟点补齐,使首尾切线与内部同尺度(等距时即相邻弦长的三分之一)。 */
function tangentComponent(keys: readonly MotionKeyLike[], index: number, axis: number): number {
    const current = keys[index]?.position[axis] ?? 0;
    const previousKey = keys[index - 1]?.position[axis];
    const nextKey = keys[index + 1]?.position[axis];
    const from = previousKey ?? (nextKey === undefined ? current : 2 * current - nextKey);
    const to = nextKey ?? (previousKey === undefined ? current : 2 * current - previousKey);
    return (to - from) * CATMULL_ROM_TANGENT_WEIGHT;
}

/**
 * 自动切线求解(领域服务,无状态)。
 *
 * 「打三个点就得到一条顺滑轨迹」是默认结果而非手工成果:auto 关键点的切线由相邻点决定,
 * 关键点一动即整体重算。求解只在轨迹构造期发生一次(结果缓存进不可变轨迹),绝不进帧循环。
 */
export class AutoHandleSolver {
    solve(keys: readonly MotionKeyLike[], index: number, out: MotionHandlePair): void {
        const key = keys[index];
        if (!key) return;
        const isManual = key.handleMode === MOTION_HANDLE_MODE.MANUAL;
        const outX = isManual ? key.outHandle[0] : tangentComponent(keys, index, 0);
        const outY = isManual ? key.outHandle[1] : tangentComponent(keys, index, 1);
        const outZ = isManual ? key.outHandle[2] : tangentComponent(keys, index, 2);
        out.outX = outX;
        out.outY = outY;
        out.outZ = outZ;
        out.inX = isManual ? key.inHandle[0] : -outX;
        out.inY = isManual ? key.inHandle[1] : -outY;
        out.inZ = isManual ? key.inHandle[2] : -outZ;
    }
}
