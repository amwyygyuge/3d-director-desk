import type { Object3D } from "three";

import type { Transform } from "@/core/SceneObject";
import { easedProgress } from "@/motion/EasingCurve";
import { createPositionSample } from "@/motion/MotionTrajectory";
import type { TimelineDoc } from "@/timeline/TimelineDoc";
import type { TimelineTrack } from "@/timeline/TimelineTrack";
import { GROUND_HEIGHT_METERS } from "@/timeline/TrackPolicies";
import type { TransformKeyframe } from "@/timeline/TransformKeyframe";
import { TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";

/** 曲线采样中转缓冲:求值同步且无重入,模块级复用即可维持零分配。 */
const POSITION_SAMPLE = createPositionSample();
const TANGENT_SAMPLE = createPositionSample();

/** Mutable output buffer for pure timeline transform sampling; callers own its lifetime. */
export interface TransformSample {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
    /** 该时刻已走弧长(米):动作步频相位的唯一来源,轨迹退化时为 0 */
    arcLengthMeters: number;
}

export function createTransformSample(): TransformSample {
    return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], arcLengthMeters: 0 };
}

function copyTransformToSample(transform: Transform, output: TransformSample): void {
    output.position[0] = transform.position[0];
    output.position[1] = transform.position[1];
    output.position[2] = transform.position[2];
    output.rotation[0] = transform.rotation[0];
    output.rotation[1] = transform.rotation[1];
    output.rotation[2] = transform.rotation[2];
    output.scale[0] = transform.scale[0];
    output.scale[1] = transform.scale[1];
    output.scale[2] = transform.scale[2];
}

function upperBound(keyframes: readonly TransformKeyframe[], timeSeconds: number): number {
    let low = 0;
    let high = keyframes.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const keyframe = keyframes[middle];
        if (keyframe && keyframe.time <= timeSeconds) low = middle + 1;
        else high = middle;
    }
    return low;
}

/**
 * 旋转与缩放:逐段线性。位置不在此处——它由整条轨的曲线决定,不是两枚关键帧的私事。
 */
function interpolateRotationScale(
    left: TransformKeyframe,
    right: TransformKeyframe,
    progress: number,
    output: TransformSample,
): void {
    const leftValue = left.value;
    const rightValue = right.value;
    output.rotation[0] = leftValue.rotation[0] + (rightValue.rotation[0] - leftValue.rotation[0]) * progress;
    output.rotation[1] = leftValue.rotation[1] + (rightValue.rotation[1] - leftValue.rotation[1]) * progress;
    output.rotation[2] = leftValue.rotation[2] + (rightValue.rotation[2] - leftValue.rotation[2]) * progress;
    output.scale[0] = leftValue.scale[0] + (rightValue.scale[0] - leftValue.scale[0]) * progress;
    output.scale[1] = leftValue.scale[1] + (rightValue.scale[1] - leftValue.scale[1]) * progress;
    output.scale[2] = leftValue.scale[2] + (rightValue.scale[2] - leftValue.scale[2]) * progress;
}

/**
 * 位置:优先走轨道的空间曲线(段内进度即缓动后的进度,曲线因此与缓动同源);
 * 轨迹退化(不足两帧/零跨度)时回落到两帧之间的直线。
 */
function samplePosition(
    track: TimelineTrack,
    segmentIndex: number,
    left: TransformKeyframe,
    right: TransformKeyframe,
    progress: number,
    output: TransformSample,
): void {
    if (track.trajectory?.sampleSegment(segmentIndex, progress, POSITION_SAMPLE)) {
        output.position[0] = POSITION_SAMPLE.x;
        output.position[1] = POSITION_SAMPLE.y;
        output.position[2] = POSITION_SAMPLE.z;
        return;
    }
    const leftValue = left.value;
    const rightValue = right.value;
    output.position[0] = leftValue.position[0] + (rightValue.position[0] - leftValue.position[0]) * progress;
    output.position[1] = leftValue.position[1] + (rightValue.position[1] - leftValue.position[1]) * progress;
    output.position[2] = leftValue.position[2] + (rightValue.position[2] - leftValue.position[2]) * progress;
}

/**
 * 策略后处理:贴地锁 Y、切线定朝向、并输出该时刻已走弧长(步频相位的唯一来源)。
 *
 * 三件事都依赖「当前落在哪一段的哪个位置」,故与位置采样共用同一组段内参数——
 * 分开算过一次就会出现朝向与画面差半帧的错位。
 */
function applyPolicies({
    track,
    segmentIndex,
    localProgress,
    output,
}: {
    readonly track: TimelineTrack;
    readonly segmentIndex: number;
    readonly localProgress: number;
    readonly output: TransformSample;
}): void {
    const policies = track.policies;
    if (policies.isGrounded) output.position[1] = GROUND_HEIGHT_METERS;
    const trajectory = track.trajectory;
    if (!trajectory) {
        output.arcLengthMeters = 0;
        return;
    }
    const from = trajectory.keyAt(segmentIndex);
    const to = trajectory.keyAt(segmentIndex + 1);
    const globalProgress = from && to ? from.progress + localProgress * (to.progress - from.progress) : localProgress;
    output.arcLengthMeters = trajectory.arcLengthAt(globalProgress);
    if (!policies.isPathOriented) return;
    if (!trajectory.sampleSegmentTangent(segmentIndex, localProgress, TANGENT_SAMPLE)) return;
    // 模型正面是 -Z(three 惯例:lookAt 让 -Z 指向目标,人偶资产同此朝向)。
    // 令 -Z 转到切线方向即 yaw = atan2(-x, -z);写成 atan2(x, z) 会让角色背对前进方向倒着跑。
    if (TANGENT_SAMPLE.x === 0 && TANGENT_SAMPLE.z === 0) return;
    output.rotation[0] = 0;
    output.rotation[1] = Math.atan2(-TANGENT_SAMPLE.x, -TANGENT_SAMPLE.z);
    output.rotation[2] = 0;
}

/**
 * Pure transform-track evaluator. It writes a caller-provided buffer and has no Three dependency.
 * `false` means the requested time falls outside the track's authored span.
 */
export function evaluateTransformTrack(track: TimelineTrack, timeSeconds: number, output: TransformSample): boolean {
    if (track.kind !== TIMELINE_TRACK_KIND.TRANSFORM) return false;
    const keyframes = track.keyframes as readonly TransformKeyframe[];
    const lastIndex = keyframes.length - 1;
    const first = keyframes[0];
    const last = keyframes[lastIndex];
    if (!first || !last || timeSeconds < first.time || timeSeconds > last.time) return false;
    const lastSegmentIndex = Math.max(0, (track.trajectory?.segmentCount ?? 1) - 1);
    if (timeSeconds === first.time || keyframes.length === 1) {
        copyTransformToSample(first.value, output);
        applyPolicies({ track, segmentIndex: 0, localProgress: 0, output });
        return true;
    }
    if (timeSeconds === last.time) {
        copyTransformToSample(last.value, output);
        applyPolicies({ track, segmentIndex: lastSegmentIndex, localProgress: 1, output });
        return true;
    }
    const upperIndex = upperBound(keyframes, timeSeconds);
    const right = keyframes[upperIndex];
    const left = keyframes[upperIndex - 1];
    if (!left || !right) return false;
    const span = right.time - left.time;
    const progress = span === 0 ? 0 : (timeSeconds - left.time) / span;
    const eased = easedProgress(right.easing, progress);
    interpolateRotationScale(left, right, eased, output);
    samplePosition(track, upperIndex - 1, left, right, eased, output);
    applyPolicies({ track, segmentIndex: upperIndex - 1, localProgress: eased, output });
    return true;
}

/**
 * Pure document evaluator for domain queries. Outside an authored transform span it returns
 * the authoritative entity transform, matching playback's restore semantics.
 */
export function evaluateTimelineTransform(
    document: TimelineDoc,
    targetId: string,
    timeSeconds: number,
    fallback: Transform,
    output: TransformSample,
): boolean {
    const track = document.trackForTarget(targetId, TIMELINE_TRACK_KIND.TRANSFORM);
    if (track && evaluateTransformTrack(track, timeSeconds, output)) return true;
    copyTransformToSample(fallback, output);
    return false;
}

/** Three runtime sampler delegates interpolation to the shared pure evaluator. */
export class TimelineSampler {
    private readonly sample: TransformSample = createTransformSample();

    /** 最近一次成功采样的已走弧长:回放协调器据此驱动动作步频,不必二次求值。 */
    get lastArcLengthMeters(): number {
        return this.sample.arcLengthMeters;
    }

    evaluate(document: TimelineDoc, timeSeconds: number, runtimeFor: (targetId: string) => Object3D | undefined): void {
        for (const track of document.tracks) {
            const runtime = runtimeFor(track.targetId);
            if (!runtime || !this.evaluateTrack(track, timeSeconds, runtime)) continue;
        }
    }

    evaluateTarget(document: TimelineDoc, targetId: string, timeSeconds: number, runtime: Object3D): boolean {
        const track = document.trackForTarget(targetId);
        return track ? this.evaluateTrack(track, timeSeconds, runtime) : false;
    }

    evaluateTrack(track: TimelineTrack, timeSeconds: number, runtime: Object3D): boolean {
        if (!evaluateTransformTrack(track, timeSeconds, this.sample)) return false;
        runtime.position.set(this.sample.position[0], this.sample.position[1], this.sample.position[2]);
        runtime.rotation.set(this.sample.rotation[0], this.sample.rotation[1], this.sample.rotation[2]);
        runtime.scale.set(this.sample.scale[0], this.sample.scale[1], this.sample.scale[2]);
        return true;
    }
}
