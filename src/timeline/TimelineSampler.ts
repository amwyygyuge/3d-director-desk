import type { Object3D } from "three";

import type { Transform } from "../core/SceneObject";
import type { TimelineDoc } from "./TimelineDoc";
import type { TimelineTrack } from "./TimelineTrack";
import type { TransformKeyframe } from "./TransformKeyframe";
import { TIMELINE_TRACK_KIND } from "./TimelineTrack";
import { TIMELINE_EASING } from "./TransformKeyframe";

/** 三维运行时的纯采样服务；每次 evaluate 不分配对象。 */
export class TimelineSampler {
    evaluate(document: TimelineDoc, timeSeconds: number, runtimeFor: (targetId: string) => Object3D | undefined): void {
        for (const track of document.tracks) {
            const runtime = runtimeFor(track.targetId);
            if (!runtime) continue;
            if (!this.evaluateTrack(track, timeSeconds, runtime)) continue;
        }
    }

    evaluateTarget(
        document: TimelineDoc,
        targetId: string,
        timeSeconds: number,
        runtime: Object3D,
    ): boolean {
        const track = document.trackForTarget(targetId);
        return track ? this.evaluateTrack(track, timeSeconds, runtime) : false;
    }

    evaluateTrack(track: TimelineTrack, timeSeconds: number, runtime: Object3D): boolean {
        if (track.kind !== TIMELINE_TRACK_KIND.TRANSFORM) return false;
        const keyframes = track.keyframes as readonly TransformKeyframe[];
        const lastIndex = keyframes.length - 1;
        const first = keyframes[0];
        const last = keyframes[lastIndex];
        if (!first || !last || timeSeconds < first.time || timeSeconds > last.time) return false;
        if (timeSeconds === first.time || keyframes.length === 1) {
            this.apply(runtime, first.value);
            return true;
        }
        if (timeSeconds === last.time) {
            this.apply(runtime, last.value);
            return true;
        }
        const upperIndex = this.upperBound(keyframes, timeSeconds);
        const left = keyframes[upperIndex - 1];
        const right = keyframes[upperIndex];
        if (!left || !right) return false;
        const span = right.time - left.time;
        const progress = span === 0 ? 0 : (timeSeconds - left.time) / span;
        const easedProgress = right.easing === TIMELINE_EASING.SMOOTH ? progress * progress * (3 - 2 * progress) : progress;
        this.interpolate(runtime, left, right, easedProgress);
        return true;
    }

    private upperBound(keyframes: readonly TransformKeyframe[], timeSeconds: number): number {
        return this.searchUpperBound(keyframes, timeSeconds, 0, keyframes.length);
    }

    private searchUpperBound(
        keyframes: readonly TransformKeyframe[],
        timeSeconds: number,
        low: number,
        high: number,
    ): number {
        if (low >= high) return low;
        const middle = Math.floor((low + high) / 2);
        const keyframe = keyframes[middle];
        return !keyframe || keyframe.time > timeSeconds
            ? this.searchUpperBound(keyframes, timeSeconds, low, middle)
            : this.searchUpperBound(keyframes, timeSeconds, middle + 1, high);
    }

    private apply(runtime: Object3D, transform: Transform): void {
        runtime.position.set(transform.position[0], transform.position[1], transform.position[2]);
        runtime.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
        runtime.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
    }

    private interpolate(
        runtime: Object3D,
        left: TransformKeyframe,
        right: TransformKeyframe,
        progress: number,
    ): void {
        const leftValue = left.value;
        const rightValue = right.value;
        runtime.position.set(
            leftValue.position[0] + (rightValue.position[0] - leftValue.position[0]) * progress,
            leftValue.position[1] + (rightValue.position[1] - leftValue.position[1]) * progress,
            leftValue.position[2] + (rightValue.position[2] - leftValue.position[2]) * progress,
        );
        runtime.rotation.set(
            leftValue.rotation[0] + (rightValue.rotation[0] - leftValue.rotation[0]) * progress,
            leftValue.rotation[1] + (rightValue.rotation[1] - leftValue.rotation[1]) * progress,
            leftValue.rotation[2] + (rightValue.rotation[2] - leftValue.rotation[2]) * progress,
        );
        runtime.scale.set(
            leftValue.scale[0] + (rightValue.scale[0] - leftValue.scale[0]) * progress,
            leftValue.scale[1] + (rightValue.scale[1] - leftValue.scale[1]) * progress,
            leftValue.scale[2] + (rightValue.scale[2] - leftValue.scale[2]) * progress,
        );
    }
}
