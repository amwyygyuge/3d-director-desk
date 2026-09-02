import { AutoHandleSolver, createHandlePair } from "@/motion/AutoHandleSolver";
import type { MotionKey } from "@/motion/MotionKey";
import type { MotionKeyLike } from "@/motion/MotionKey";

/** 调用方持有的位置采样输出;采样期只写标量,永不分配。 */
export interface MotionPositionSample {
    x: number;
    y: number;
    z: number;
}

export function createPositionSample(): MotionPositionSample {
    return { x: 0, y: 0, z: 0 };
}

const MINIMUM_TRAJECTORY_KEYS = 2;
/** 每段缓存 2 个绝对控制点(c1、c2),共 6 个分量 */
const COMPONENTS_PER_SEGMENT = 6;
const CUBIC_BEZIER_CONTROL_WEIGHT = 3;
/** 每段弧长采样点数:16 足以让走位长度误差落在毫米级,表本身也只有几百个 float */
const ARC_SAMPLES_PER_SEGMENT = 16;
const DERIVATIVE_WEIGHT = 3;

const handleSolver = new AutoHandleSolver();
const solvedHandles = createHandlePair();

function sortedByProgress<K extends MotionKeyLike>(keys: readonly K[]): readonly K[] {
    return [...keys].sort((left, right) => left.progress - right.progress);
}

function assertUniqueKeys(keys: readonly MotionKeyLike[]): void {
    const ids = new Set(keys.map((key) => key.id));
    const progresses = new Set(keys.map((key) => key.progress));
    if (ids.size !== keys.length) throw new Error("MotionTrajectory key ids must be unique");
    if (progresses.size !== keys.length) throw new Error("MotionTrajectory key progress values must be unique");
}

/**
 * 构造期一次性解算:auto 手柄求切线,manual 手柄照用,结果落成段级绝对控制点。
 * 索引式循环是零分配纪律的直接要求(闭包与迭代器都会在采样准备期产生垃圾)。
 */
function solveControlPoints(keys: readonly MotionKeyLike[]): Float32Array {
    const segmentCount = keys.length - 1;
    const controls = new Float32Array(segmentCount * COMPONENTS_PER_SEGMENT);
    for (let segment = 0; segment < segmentCount; segment += 1) {
        const from = keys[segment];
        const to = keys[segment + 1];
        if (!from || !to) continue;
        const offset = segment * COMPONENTS_PER_SEGMENT;
        handleSolver.solve(keys, segment, solvedHandles);
        controls[offset] = from.position[0] + solvedHandles.outX;
        controls[offset + 1] = from.position[1] + solvedHandles.outY;
        controls[offset + 2] = from.position[2] + solvedHandles.outZ;
        handleSolver.solve(keys, segment + 1, solvedHandles);
        controls[offset + 3] = to.position[0] + solvedHandles.inX;
        controls[offset + 4] = to.position[1] + solvedHandles.inY;
        controls[offset + 5] = to.position[2] + solvedHandles.inZ;
    }
    return controls;
}

function cubicComponent(from: number, control1: number, control2: number, to: number, progress: number): number {
    const inverse = 1 - progress;
    const inverseSquared = inverse * inverse;
    const progressSquared = progress * progress;
    return (
        inverseSquared * inverse * from +
        CUBIC_BEZIER_CONTROL_WEIGHT * inverseSquared * progress * control1 +
        CUBIC_BEZIER_CONTROL_WEIGHT * inverse * progressSquared * control2 +
        progressSquared * progress * to
    );
}

/** 三次 Bézier 一阶导:B'(t) = 3[(c1-p0)(1-t)² + 2(c2-c1)(1-t)t + (p1-c2)t²] */
function cubicDerivative(from: number, control1: number, control2: number, to: number, progress: number): number {
    const inverse = 1 - progress;
    return (
        DERIVATIVE_WEIGHT *
        (inverse * inverse * (control1 - from) +
            2 * inverse * progress * (control2 - control1) +
            progress * progress * (to - control2))
    );
}

/**
 * 空间轨迹聚合(不可变):一组按 progress 排序的关键点 + 段级预解算控制点。
 *
 * 领域中立:相机运镜与模型走位共用同一条曲线实现——K 只需满足 MotionKeyLike,
 * 各自领域的载荷(注视点/fov/朝向)由拥有方另行插值,轨迹只负责空间位置。
 * 时间不属于本类(progress 归一化),故重定时无需重画:拉伸片段时形状恒定。
 */
export class MotionTrajectory<K extends MotionKeyLike = MotionKey> {
    readonly keys: readonly K[];
    private readonly controls: Float32Array;
    /** 累计弧长表(按 progress 均匀采样):步频相位与等距刻度共用,构造期算一次 */
    private readonly arcLengths: Float32Array;

    constructor(keys: readonly K[]) {
        if (keys.length < MINIMUM_TRAJECTORY_KEYS) throw new Error("MotionTrajectory requires at least two keys");
        const ordered = sortedByProgress(keys);
        assertUniqueKeys(ordered);
        this.keys = Object.freeze(ordered);
        this.controls = solveControlPoints(this.keys);
        this.arcLengths = this.solveArcLengths();
        Object.freeze(this);
    }

    /** 弧长表的采样点数(段数 × 每段采样 + 1);表内相邻点等 progress 间隔,查表即线性插值。 */
    private get arcSampleCount(): number {
        return this.segmentCount * ARC_SAMPLES_PER_SEGMENT;
    }

    private solveArcLengths(): Float32Array {
        const sampleCount = this.arcSampleCount;
        const lengths = new Float32Array(sampleCount + 1);
        const current = createPositionSample();
        const previous = createPositionSample();
        this.samplePosition(0, previous);
        for (let step = 1; step <= sampleCount; step += 1) {
            this.samplePosition(step / sampleCount, current);
            const dx = current.x - previous.x;
            const dy = current.y - previous.y;
            const dz = current.z - previous.z;
            lengths[step] = (lengths[step - 1] ?? 0) + Math.sqrt(dx * dx + dy * dy + dz * dz);
            previous.x = current.x;
            previous.y = current.y;
            previous.z = current.z;
        }
        return lengths;
    }

    /** 整条轨迹的空间长度(米):走位时长与步频相位都由它换算。 */
    get totalLength(): number {
        return this.arcLengths[this.arcSampleCount] ?? 0;
    }

    /** progress → 已走弧长;表内线性插值,查询期零分配。 */
    arcLengthAt(progress: number): number {
        if (!Number.isFinite(progress)) return 0;
        const sampleCount = this.arcSampleCount;
        const clamped = Math.min(Math.max(progress, 0), 1);
        const position = clamped * sampleCount;
        const index = Math.min(Math.floor(position), sampleCount - 1);
        const from = this.arcLengths[index] ?? 0;
        const to = this.arcLengths[index + 1] ?? from;
        return from + (to - from) * (position - index);
    }

    /** 段内三次 Bézier 一阶导 = 前进方向(未归一化);与 sampleSegment 同参,保证切线与位置同点。 */
    sampleSegmentTangent(segmentIndex: number, localProgress: number, sample: MotionPositionSample): boolean {
        const from = this.keys[segmentIndex];
        const to = this.keys[segmentIndex + 1];
        if (!from || !to) return false;
        const offset = segmentIndex * COMPONENTS_PER_SEGMENT;
        sample.x = cubicDerivative(
            from.position[0],
            this.controls[offset] ?? 0,
            this.controls[offset + 3] ?? 0,
            to.position[0],
            localProgress,
        );
        sample.y = cubicDerivative(
            from.position[1],
            this.controls[offset + 1] ?? 0,
            this.controls[offset + 4] ?? 0,
            to.position[1],
            localProgress,
        );
        sample.z = cubicDerivative(
            from.position[2],
            this.controls[offset + 2] ?? 0,
            this.controls[offset + 5] ?? 0,
            to.position[2],
            localProgress,
        );
        return true;
    }

    sampleTangent(progress: number, sample: MotionPositionSample): boolean {
        if (!Number.isFinite(progress)) return false;
        const segmentIndex = this.segmentIndexAt(progress);
        return this.sampleSegmentTangent(segmentIndex, this.segmentProgress(progress, segmentIndex), sample);
    }

    get segmentCount(): number {
        return this.keys.length - 1;
    }

    key(keyId: string): K | undefined {
        return this.keys.find((key) => key.id === keyId);
    }

    keyAt(index: number): K | undefined {
        return this.keys[index];
    }

    indexOf(keyId: string): number {
        return this.keys.findIndex((key) => key.id === keyId);
    }

    /** 命中段索引(二分,零分配):progress 越界时钳到首/末段。 */
    segmentIndexAt(progress: number): number {
        const lastSegment = this.segmentCount - 1;
        let low = 0;
        let high = lastSegment;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            const key = this.keys[middle];
            if (key && key.progress <= progress) low = middle;
            else high = middle - 1;
        }
        return Math.min(Math.max(low, 0), lastSegment);
    }

    /** 段内局部进度:相邻关键点的 progress 间距即该段配速(显式配速,不做弧长重参数化)。 */
    segmentProgress(progress: number, segmentIndex: number): number {
        const from = this.keys[segmentIndex];
        const to = this.keys[segmentIndex + 1];
        if (!from || !to) return 0;
        const span = to.progress - from.progress;
        const local = span === 0 ? 0 : (progress - from.progress) / span;
        return Math.min(Math.max(local, 0), 1);
    }

    /** 段内三次 Bézier 求值;控制点已预解算,帧内零分配、无手柄分支。 */
    sampleSegment(segmentIndex: number, localProgress: number, sample: MotionPositionSample): boolean {
        const from = this.keys[segmentIndex];
        const to = this.keys[segmentIndex + 1];
        if (!from || !to) return false;
        const offset = segmentIndex * COMPONENTS_PER_SEGMENT;
        sample.x = cubicComponent(
            from.position[0],
            this.controls[offset] ?? 0,
            this.controls[offset + 3] ?? 0,
            to.position[0],
            localProgress,
        );
        sample.y = cubicComponent(
            from.position[1],
            this.controls[offset + 1] ?? 0,
            this.controls[offset + 4] ?? 0,
            to.position[1],
            localProgress,
        );
        sample.z = cubicComponent(
            from.position[2],
            this.controls[offset + 2] ?? 0,
            this.controls[offset + 5] ?? 0,
            to.position[2],
            localProgress,
        );
        return true;
    }

    samplePosition(progress: number, sample: MotionPositionSample): boolean {
        if (!Number.isFinite(progress)) return false;
        const segmentIndex = this.segmentIndexAt(progress);
        return this.sampleSegment(segmentIndex, this.segmentProgress(progress, segmentIndex), sample);
    }

    /** 覆盖同 id 关键点,否则追加;返回的新轨迹已重新解算切线。 */
    withKey(key: K): MotionTrajectory<K> {
        const replaced = this.key(key.id) !== undefined;
        const keys = replaced
            ? this.keys.map((current) => (current.id === key.id ? key : current))
            : [...this.keys, key];
        return new MotionTrajectory<K>(keys);
    }

    /** 少于两个关键点的轨迹不成立;调用方据 null 决定是否连片段一并删除。 */
    withoutKey(keyId: string): MotionTrajectory<K> | null {
        const keys = this.keys.filter((key) => key.id !== keyId);
        return keys.length < MINIMUM_TRAJECTORY_KEYS ? null : new MotionTrajectory<K>(keys);
    }
}
