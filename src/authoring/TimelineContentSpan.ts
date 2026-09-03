import type { CameraMotionStore } from "@/store/CameraMotionStore";
import type { TimelineStore } from "@/store/TimelineStore";

export const TIMELINE_CONTENT_BLOCKER_KIND = {
    WALK_TRACK: "walk-track",
    MOTION_CLIP: "motion-clip",
    PROGRAM_CLIP: "program-clip",
} as const;
export type TimelineContentBlockerKind =
    (typeof TIMELINE_CONTENT_BLOCKER_KIND)[keyof typeof TIMELINE_CONTENT_BLOCKER_KIND];

export interface TimelineContentBlocker {
    readonly kind: TimelineContentBlockerKind;
    readonly id: string;
    readonly label: string;
    readonly endSeconds: number;
}

/**
 * 时长的内容下界只从可编排实体推导；不把工程 duration 自己当内容，空工程才能收紧。
 */
export class TimelineContentSpan {
    readonly endSeconds: number;
    readonly blockers: readonly TimelineContentBlocker[];

    private constructor(blockers: readonly TimelineContentBlocker[]) {
        this.blockers = Object.freeze([...blockers].sort((left, right) => right.endSeconds - left.endSeconds));
        this.endSeconds = this.blockers[0]?.endSeconds ?? 0;
        Object.freeze(this);
    }

    static fromDocument(timeline: TimelineStore, motion: CameraMotionStore): TimelineContentSpan {
        const walkTracks = timeline.document.tracks.flatMap((track) =>
            track.keyframes.length === 0
                ? []
                : [
                      {
                          kind: TIMELINE_CONTENT_BLOCKER_KIND.WALK_TRACK,
                          id: track.id,
                          label: `走位轨 ${track.targetId}`,
                          endSeconds: track.keyframes.reduce((end, keyframe) => Math.max(end, keyframe.time), 0),
                      },
                  ],
        );
        const motionClips = motion.clips.map((clip) => ({
            kind: TIMELINE_CONTENT_BLOCKER_KIND.MOTION_CLIP,
            id: clip.id,
            label: `运镜片段 ${clip.id}`,
            endSeconds: clip.endTimeSeconds,
        }));
        const programClips = motion.program.clips.map((clip) => ({
            kind: TIMELINE_CONTENT_BLOCKER_KIND.PROGRAM_CLIP,
            id: clip.id,
            label: `Program 片段 ${clip.id}`,
            endSeconds: clip.endTimeSeconds,
        }));
        return new TimelineContentSpan([...walkTracks, ...motionClips, ...programClips]);
    }
}
