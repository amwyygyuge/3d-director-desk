import type { PoseKeyframe } from "../pose/PoseKeyframe";
import type { PoseKeyframeInit } from "../pose/PoseKeyframe";
import type { TransformKeyframe } from "./TransformKeyframe";
import type { TransformKeyframeInit } from "./TransformKeyframe";
import { keyframeCodecFor } from "./keyframeCodecs";

export const TIMELINE_TRACK_KIND = {
    TRANSFORM: "transform",
    POSE: "pose",
} as const;

export type TimelineTrackKind = (typeof TIMELINE_TRACK_KIND)[keyof typeof TIMELINE_TRACK_KIND];

/**
 * 关键帧联合:类型层面的种类清单。新增种类只需扩展本联合 + 注册 codec(见 keyframeCodecs),
 * 轨道行为零改动;运行时无 instanceof 分支,构造/归属校验全部委托注册表。
 */
export type TimelineKeyframe = TransformKeyframe | PoseKeyframe;

/** 精确种类 init:保留给生产方(命令/文档装配)做编译期校验 */
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

/** 轨道容器视角的通用 init:kind 鉴别种类,keyframes 由注册 codec 解释 */
export interface TimelineTrackInit {
    readonly id: string;
    readonly targetId: string;
    readonly kind: TimelineTrackKind;
    readonly keyframes: readonly (TimelineKeyframe | TransformKeyframeInit | PoseKeyframeInit)[];
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
