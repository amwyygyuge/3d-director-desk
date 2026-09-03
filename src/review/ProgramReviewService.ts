import { PROGRAM_SOURCE_KIND } from "@/camera/CameraProgramTrack";
import type { CameraProgramClip } from "@/camera/CameraProgramTrack";
import type { CameraMotionStore } from "@/store/CameraMotionStore";
import type { CameraStore } from "@/store/CameraStore";
import type { TimelineStore } from "@/store/TimelineStore";

export const PROGRAM_REVIEW_ISSUE_KIND = {
    EMPTY: "empty-program",
    GAP: "program-gap",
    MISSING_SOURCE: "missing-source",
} as const;
export type ProgramReviewIssueKind = (typeof PROGRAM_REVIEW_ISSUE_KIND)[keyof typeof PROGRAM_REVIEW_ISSUE_KIND];

export interface ProgramReviewShot {
    readonly id: string;
    readonly startSeconds: number;
    readonly endSeconds: number;
    readonly sourceId: string;
    readonly sourceLabel: string;
    readonly isSourceAvailable: boolean;
}

export interface ProgramReviewIssue {
    readonly kind: ProgramReviewIssueKind;
    readonly startSeconds: number;
    readonly endSeconds: number;
    readonly message: string;
}

export interface ProgramReviewReport {
    readonly range: { readonly inSeconds: number; readonly outSeconds: number };
    readonly shots: readonly ProgramReviewShot[];
    readonly issues: readonly ProgramReviewIssue[];
}

interface ProgramReviewSource {
    readonly camera: CameraStore;
    readonly motion: CameraMotionStore;
    readonly timeline: TimelineStore;
}

function reviewShotFor(clip: CameraProgramClip, source: ProgramReviewSource): ProgramReviewShot {
    const staticShot =
        clip.source.kind === PROGRAM_SOURCE_KIND.STATIC_SHOT ? source.camera.director.getShot(clip.source.shotId) : null;
    const motionClip = clip.source.kind === PROGRAM_SOURCE_KIND.MOTION_CLIP ? source.motion.clip(clip.source.motionClipId) : null;
    const sourceId = clip.source.kind === PROGRAM_SOURCE_KIND.STATIC_SHOT ? clip.source.shotId : clip.source.motionClipId;
    const isSourceAvailable = staticShot !== undefined || motionClip !== undefined;
    const sourceLabel = staticShot ? `机位 ${sourceId}` : motionClip ? `运镜 ${motionClip.id}` : `缺失来源 ${sourceId}`;
    return {
        id: clip.id,
        startSeconds: clip.startTimeSeconds,
        endSeconds: clip.endTimeSeconds,
        sourceId,
        sourceLabel,
        isSourceAvailable,
    };
}

function sourceIssuesFor(shots: readonly ProgramReviewShot[]): readonly ProgramReviewIssue[] {
    return shots.flatMap((shot) =>
        shot.isSourceAvailable
            ? []
            : [
                  {
                      kind: PROGRAM_REVIEW_ISSUE_KIND.MISSING_SOURCE,
                      startSeconds: shot.startSeconds,
                      endSeconds: shot.endSeconds,
                      message: `Program 片段缺少来源: ${shot.sourceId}`,
                  },
              ],
    );
}

function gapIssuesFor(
    shots: readonly ProgramReviewShot[],
    range: ProgramReviewReport["range"],
): readonly ProgramReviewIssue[] {
    const firstShot = shots.at(0);
    if (!firstShot) {
        return [
            {
                kind: PROGRAM_REVIEW_ISSUE_KIND.EMPTY,
                startSeconds: range.inSeconds,
                endSeconds: range.outSeconds,
                message: "Program 输出轨为空",
            },
        ];
    }
    const lastShot = shots.at(-1) ?? firstShot;
    const leadingGap = firstShot.startSeconds > range.inSeconds ? [gapIssue(range.inSeconds, firstShot.startSeconds)] : [];
    const internalGaps = shots.flatMap((shot, index) => {
        const previousShot = shots[index - 1];
        return previousShot && previousShot.endSeconds < shot.startSeconds ? [gapIssue(previousShot.endSeconds, shot.startSeconds)] : [];
    });
    const trailingGap = lastShot.endSeconds < range.outSeconds ? [gapIssue(lastShot.endSeconds, range.outSeconds)] : [];
    return [...leadingGap, ...internalGaps, ...trailingGap];
}

function gapIssue(startSeconds: number, endSeconds: number): ProgramReviewIssue {
    return {
        kind: PROGRAM_REVIEW_ISSUE_KIND.GAP,
        startSeconds,
        endSeconds,
        message: "Program 输出存在空档",
    };
}

/** 成片巡检领域服务：从 Program、机位与运镜聚合生成只读镜头单和可定位问题，不持有运行时状态。 */
export class ProgramReviewService {
    review(source: ProgramReviewSource): ProgramReviewReport {
        const playbackRange = source.timeline.document.playbackRange;
        const range = { inSeconds: playbackRange.inSeconds, outSeconds: playbackRange.outSeconds };
        const shots = source.motion.program.clips
            .filter((clip) => clip.endTimeSeconds > range.inSeconds && clip.startTimeSeconds < range.outSeconds)
            .map((clip) => reviewShotFor(clip, source));
        return { range, shots, issues: [...gapIssuesFor(shots, range), ...sourceIssuesFor(shots)] };
    }
}
