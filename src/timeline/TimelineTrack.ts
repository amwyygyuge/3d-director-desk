import { TransformKeyframe } from "./TransformKeyframe";
import type { TransformKeyframeInit } from "./TransformKeyframe";

export const TIMELINE_TRACK_KIND = {
    TRANSFORM: "transform",
} as const;

export type TimelineTrackKind = (typeof TIMELINE_TRACK_KIND)[keyof typeof TIMELINE_TRACK_KIND];

export interface TimelineTrackInit {
    readonly id: string;
    readonly targetId: string;
    readonly kind: TimelineTrackKind;
    readonly keyframes: readonly (TransformKeyframe | TransformKeyframeInit)[];
}

function compareKeyframes(left: TransformKeyframe, right: TransformKeyframe): number {
    return left.time - right.time;
}

/** 单对象的不可变变换轨道；关键帧始终按时间升序保存。 */
export class TimelineTrack {
    readonly id: string;
    readonly targetId: string;
    readonly kind: TimelineTrackKind;
    readonly keyframes: readonly TransformKeyframe[];

    constructor(init: TimelineTrackInit) {
        this.id = init.id;
        this.targetId = init.targetId;
        this.kind = init.kind;
        this.keyframes = Object.freeze(
            init.keyframes.map((keyframe) =>
                keyframe instanceof TransformKeyframe ? keyframe : new TransformKeyframe(keyframe),
            ).sort(compareKeyframes),
        );
        Object.freeze(this);
    }

    keyframe(keyframeId: string): TransformKeyframe | undefined {
        return this.keyframes.find((keyframe) => keyframe.id === keyframeId);
    }

    withKeyframe(keyframe: TransformKeyframe): TimelineTrack {
        return new TimelineTrack({
            id: this.id,
            targetId: this.targetId,
            kind: this.kind,
            keyframes: [...this.keyframes.filter((current) => current.id !== keyframe.id), keyframe],
        });
    }

    withoutKeyframe(keyframeId: string): TimelineTrack {
        return new TimelineTrack({
            id: this.id,
            targetId: this.targetId,
            kind: this.kind,
            keyframes: this.keyframes.filter((keyframe) => keyframe.id !== keyframeId),
        });
    }

    toJSON(): TimelineTrackInit {
        return {
            id: this.id,
            targetId: this.targetId,
            kind: this.kind,
            keyframes: this.keyframes.map((keyframe) => keyframe.toJSON()),
        };
    }
}
