import { PoseKeyframe } from "../pose/PoseKeyframe";
import type { PoseKeyframeInit } from "../pose/PoseKeyframe";
import { TransformKeyframe } from "./TransformKeyframe";
import type { TransformKeyframeInit } from "./TransformKeyframe";

export const TIMELINE_TRACK_KIND = {
    TRANSFORM: "transform",
    POSE: "pose",
} as const;

export type TimelineTrackKind = (typeof TIMELINE_TRACK_KIND)[keyof typeof TIMELINE_TRACK_KIND];
export type TimelineKeyframe = TransformKeyframe | PoseKeyframe;

export type TimelineTrackInit = TransformTimelineTrackInit | PoseTimelineTrackInit;
export interface TransformTimelineTrackInit {
    readonly id: string;
    readonly targetId: string;
    readonly kind: typeof TIMELINE_TRACK_KIND.TRANSFORM;
    readonly keyframes: readonly (TransformKeyframe | TransformKeyframeInit)[];
}
export interface PoseTimelineTrackInit {
    readonly id: string;
    readonly targetId: string;
    readonly kind: typeof TIMELINE_TRACK_KIND.POSE;
    readonly keyframes: readonly (PoseKeyframe | PoseKeyframeInit)[];
}

function compareKeyframes(left: TimelineKeyframe, right: TimelineKeyframe): number {
    return left.time - right.time;
}

/** Immutable discriminated track: a target may own one transform and one pose track. */
export class TimelineTrack {
    readonly id: string;
    readonly targetId: string;
    readonly kind: TimelineTrackKind;
    readonly keyframes: readonly TimelineKeyframe[];

    constructor(init: TimelineTrackInit) {
        this.id = init.id;
        this.targetId = init.targetId;
        this.kind = init.kind;
        const keyframes: TimelineKeyframe[] = init.kind === TIMELINE_TRACK_KIND.TRANSFORM
            ? init.keyframes.map((keyframe) => keyframe instanceof TransformKeyframe ? keyframe : new TransformKeyframe(keyframe))
            : init.keyframes.map((keyframe) => keyframe instanceof PoseKeyframe ? keyframe : new PoseKeyframe(keyframe));
        this.keyframes = Object.freeze(keyframes.sort(compareKeyframes));
        Object.freeze(this);
    }

    keyframe(keyframeId: string): TimelineKeyframe | undefined {
        return this.keyframes.find((keyframe) => keyframe.id === keyframeId);
    }

    withKeyframe(keyframe: TimelineKeyframe): TimelineTrack {
        if (this.kind === TIMELINE_TRACK_KIND.TRANSFORM && keyframe instanceof TransformKeyframe) {
            return new TimelineTrack({ id: this.id, targetId: this.targetId, kind: TIMELINE_TRACK_KIND.TRANSFORM, keyframes: [...this.keyframes.filter((current) => current.id !== keyframe.id) as TransformKeyframe[], keyframe] });
        }
        if (this.kind === TIMELINE_TRACK_KIND.POSE && keyframe instanceof PoseKeyframe) {
            return new TimelineTrack({ id: this.id, targetId: this.targetId, kind: TIMELINE_TRACK_KIND.POSE, keyframes: [...this.keyframes.filter((current) => current.id !== keyframe.id) as PoseKeyframe[], keyframe] });
        }
        throw new Error("TimelineTrack: keyframe kind does not match track kind");
    }

    withoutKeyframe(keyframeId: string): TimelineTrack {
        if (this.kind === TIMELINE_TRACK_KIND.TRANSFORM) {
            return new TimelineTrack({ id: this.id, targetId: this.targetId, kind: TIMELINE_TRACK_KIND.TRANSFORM, keyframes: this.keyframes.filter((keyframe) => keyframe.id !== keyframeId) as TransformKeyframe[] });
        }
        return new TimelineTrack({ id: this.id, targetId: this.targetId, kind: TIMELINE_TRACK_KIND.POSE, keyframes: this.keyframes.filter((keyframe) => keyframe.id !== keyframeId) as PoseKeyframe[] });
    }

    toJSON(): TimelineTrackInit {
        if (this.kind === TIMELINE_TRACK_KIND.TRANSFORM) {
            return { id: this.id, targetId: this.targetId, kind: TIMELINE_TRACK_KIND.TRANSFORM, keyframes: this.keyframes.map((keyframe) => (keyframe as TransformKeyframe).toJSON()) };
        }
        return { id: this.id, targetId: this.targetId, kind: TIMELINE_TRACK_KIND.POSE, keyframes: this.keyframes.map((keyframe) => (keyframe as PoseKeyframe).toJSON()) };
    }
}
