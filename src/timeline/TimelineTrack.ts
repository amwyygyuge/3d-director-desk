import type { TransformKeyframe } from "./TransformKeyframe";
import type { TransformKeyframeInit } from "./TransformKeyframe";
import { keyframeCodecFor } from "./keyframeCodecs";

export const TIMELINE_TRACK_KIND = {
    TRANSFORM: "transform",
} as const;
export type TimelineTrackKind = (typeof TIMELINE_TRACK_KIND)[keyof typeof TIMELINE_TRACK_KIND];
export type TimelineKeyframe = TransformKeyframe;

export interface TimelineTrackInit {
    readonly id: string;
    readonly targetId: string;
    readonly kind: TimelineTrackKind;
    readonly keyframes: readonly (TransformKeyframe | TransformKeyframeInit)[];
}

/** Immutable transform track. Pose presets are scene state, not timeline keyframes. */
export class TimelineTrack {
    readonly id: string;
    readonly targetId: string;
    readonly kind: TimelineTrackKind;
    readonly keyframes: readonly TimelineKeyframe[];

    constructor(init: TimelineTrackInit) {
        this.id = init.id;
        this.targetId = init.targetId;
        this.kind = init.kind;
        const codec = keyframeCodecFor(init.kind);
        const keyframes: TimelineKeyframe[] = init.keyframes.map((keyframe) =>
            codec.owns(keyframe) ? keyframe : codec.fromInit(keyframe),
        );
        this.keyframes = Object.freeze(keyframes.sort((left, right) => left.time - right.time));
        Object.freeze(this);
    }

    keyframe(keyframeId: string): TimelineKeyframe | undefined {
        return this.keyframes.find((keyframe) => keyframe.id === keyframeId);
    }

    withKeyframe(keyframe: TimelineKeyframe): TimelineTrack {
        if (!keyframeCodecFor(this.kind).owns(keyframe)) {
            throw new Error("TimelineTrack: keyframe kind does not match track kind");
        }
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
