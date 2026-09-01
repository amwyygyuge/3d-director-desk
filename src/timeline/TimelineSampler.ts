import type { Object3D } from "three";

import type { Transform } from "@/core/SceneObject";
import type { TimelineDoc } from "@/timeline/TimelineDoc";
import type { TimelineTrack } from "@/timeline/TimelineTrack";
import type { TransformKeyframe } from "@/timeline/TransformKeyframe";
import { TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";
import { TIMELINE_EASING } from "@/timeline/TransformKeyframe";

/** Mutable output buffer for pure timeline transform sampling; callers own its lifetime. */
export interface TransformSample {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
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

function interpolate(
    left: TransformKeyframe,
    right: TransformKeyframe,
    progress: number,
    output: TransformSample,
): void {
    const leftValue = left.value;
    const rightValue = right.value;
    output.position[0] = leftValue.position[0] + (rightValue.position[0] - leftValue.position[0]) * progress;
    output.position[1] = leftValue.position[1] + (rightValue.position[1] - leftValue.position[1]) * progress;
    output.position[2] = leftValue.position[2] + (rightValue.position[2] - leftValue.position[2]) * progress;
    output.rotation[0] = leftValue.rotation[0] + (rightValue.rotation[0] - leftValue.rotation[0]) * progress;
    output.rotation[1] = leftValue.rotation[1] + (rightValue.rotation[1] - leftValue.rotation[1]) * progress;
    output.rotation[2] = leftValue.rotation[2] + (rightValue.rotation[2] - leftValue.rotation[2]) * progress;
    output.scale[0] = leftValue.scale[0] + (rightValue.scale[0] - leftValue.scale[0]) * progress;
    output.scale[1] = leftValue.scale[1] + (rightValue.scale[1] - leftValue.scale[1]) * progress;
    output.scale[2] = leftValue.scale[2] + (rightValue.scale[2] - leftValue.scale[2]) * progress;
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
    if (timeSeconds === first.time || keyframes.length === 1) {
        copyTransformToSample(first.value, output);
        return true;
    }
    if (timeSeconds === last.time) {
        copyTransformToSample(last.value, output);
        return true;
    }
    const upperIndex = upperBound(keyframes, timeSeconds);
    const right = keyframes[upperIndex];
    const left = keyframes[upperIndex - 1];
    if (!left || !right) return false;
    const span = right.time - left.time;
    const progress = span === 0 ? 0 : (timeSeconds - left.time) / span;
    const easedProgress = right.easing === TIMELINE_EASING.SMOOTH ? progress * progress * (3 - 2 * progress) : progress;
    interpolate(left, right, easedProgress, output);
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
    private readonly sample: TransformSample = {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
    };

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
