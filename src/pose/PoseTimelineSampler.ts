
import type { PoseLayer } from "./PoseLayer";
import type { PoseKeyframe } from "./PoseKeyframe";
import { TIMELINE_TRACK_KIND } from "../timeline/TimelineTrack";
import type { TimelineTrack } from "../timeline/TimelineTrack";
import { TIMELINE_EASING } from "../timeline/TransformKeyframe";

/** Timeline sampler for immutable pose snapshots; performs no snapshot construction during playback. */
export class PoseTimelineSampler {
    constructor(private readonly layer: PoseLayer) {}

    evaluateTrack(track: TimelineTrack, timeSeconds: number, weight: number): boolean {
        if (track.kind !== TIMELINE_TRACK_KIND.POSE) return false;
        const keyframes = track.keyframes as readonly PoseKeyframe[];
        const first = keyframes[0];
        const last = keyframes[keyframes.length - 1];
        if (!first || !last || timeSeconds < first.time || timeSeconds > last.time) return false;
        if (timeSeconds === first.time || keyframes.length === 1) {
            this.layer.apply(track.targetId, first.value, weight);
            return true;
        }
        if (timeSeconds === last.time) {
            this.layer.apply(track.targetId, last.value, weight);
            return true;
        }
        let upperIndex = 1;
        while (upperIndex < keyframes.length && keyframes[upperIndex]!.time <= timeSeconds) upperIndex += 1;
        const left = keyframes[upperIndex - 1];
        const right = keyframes[upperIndex];
        if (!left || !right) return false;
        const rawProgress = (timeSeconds - left.time) / (right.time - left.time);
        const progress = right.easing === TIMELINE_EASING.SMOOTH
            ? rawProgress * rawProgress * (3 - 2 * rawProgress)
            : rawProgress;
        this.layer.applyInterpolated(track.targetId, left.value, right.value, progress, weight);
        return true;
    }
}
