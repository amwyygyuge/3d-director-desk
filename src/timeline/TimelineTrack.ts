import type { MotionTrajectory } from "@/motion/MotionTrajectory";
import { TrackPolicies } from "@/timeline/TrackPolicies";
import type { TrackPoliciesInit } from "@/timeline/TrackPolicies";
import type { TransformKeyframe } from "@/timeline/TransformKeyframe";
import type { TransformKeyframeInit } from "@/timeline/TransformKeyframe";
import { keyframeCodecFor } from "@/timeline/keyframeCodecs";

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
    /** 走位策略(朝向/贴地/步频);缺省即取默认策略,不是"关闭" */
    readonly policies?: TrackPolicies | TrackPoliciesInit | undefined;
}

/**
 * Immutable transform track. Pose presets are scene state, not timeline keyframes.
 *
 * 轨迹是关键帧序列的派生物(构造期解算一次,随不可变轨道一起冻结):位置通道按它求值,
 * 视口辅助物按它绘制,两处共用同一条曲线,不各自推断形状。
 * 策略回答关键帧回答不了的三件事——面朝哪、脚踩在哪、腿迈多快。
 */
export class TimelineTrack {
    readonly id: string;
    readonly targetId: string;
    readonly kind: TimelineTrackKind;
    readonly keyframes: readonly TimelineKeyframe[];
    /** null = 关键帧不足两枚或时间跨度为零,采样端退回逐段直线。 */
    readonly trajectory: MotionTrajectory | null;
    readonly policies: TrackPolicies;

    constructor(init: TimelineTrackInit) {
        this.id = init.id;
        this.targetId = init.targetId;
        this.kind = init.kind;
        const codec = keyframeCodecFor(init.kind);
        const keyframes: TimelineKeyframe[] = init.keyframes.map((keyframe) =>
            codec.owns(keyframe) ? keyframe : codec.fromInit(keyframe),
        );
        this.keyframes = Object.freeze(keyframes.sort((left, right) => left.time - right.time));
        this.trajectory = codec.trajectory(this.keyframes);
        this.policies = init.policies instanceof TrackPolicies ? init.policies : new TrackPolicies(init.policies ?? {});
        Object.freeze(this);
    }

    keyframe(keyframeId: string): TimelineKeyframe | undefined {
        return this.keyframes.find((keyframe) => keyframe.id === keyframeId);
    }

    withKeyframe(keyframe: TimelineKeyframe): TimelineTrack {
        if (!keyframeCodecFor(this.kind).owns(keyframe)) {
            throw new Error("TimelineTrack: keyframe kind does not match track kind");
        }
        return this.replicate([...this.keyframes.filter((current) => current.id !== keyframe.id), keyframe]);
    }

    withoutKeyframe(keyframeId: string): TimelineTrack {
        return this.replicate(this.keyframes.filter((keyframe) => keyframe.id !== keyframeId));
    }

    withPolicies(policies: TrackPolicies): TimelineTrack {
        return this.replicate(this.keyframes, policies);
    }

    private replicate(keyframes: readonly TimelineKeyframe[], policies = this.policies): TimelineTrack {
        return new TimelineTrack({
            id: this.id,
            targetId: this.targetId,
            kind: this.kind,
            keyframes,
            policies,
        });
    }

    toJSON(): TimelineTrackInit {
        return {
            id: this.id,
            targetId: this.targetId,
            kind: this.kind,
            keyframes: this.keyframes.map((keyframe) => keyframe.toJSON()),
            policies: this.policies.toJSON(),
        };
    }
}
