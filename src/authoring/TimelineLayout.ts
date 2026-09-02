import type { TimelineViewport } from "@/authoring/TimelineViewport";
import { PROGRAM_SOURCE_KIND } from "@/camera/CameraProgramTrack";
import type { CameraMotionStore } from "@/store/CameraMotionStore";
import type { TimelineStore } from "@/store/TimelineStore";

export const TIMELINE_ROW_KIND = {
    PROGRAM: "program",
    MOTION: "motion",
    TRANSFORM: "transform",
} as const;
export type TimelineRowKind = (typeof TIMELINE_ROW_KIND)[keyof typeof TIMELINE_ROW_KIND];

export const TIMELINE_BAR_KIND = {
    PROGRAM: "program",
    MOTION: "motion",
} as const;
export type TimelineBarKind = (typeof TIMELINE_BAR_KIND)[keyof typeof TIMELINE_BAR_KIND];

export const TIMELINE_MARK_KIND = {
    CAMERA_KEY: "camera-key",
    TRANSFORM_KEY: "transform-key",
} as const;
export type TimelineMarkKind = (typeof TIMELINE_MARK_KIND)[keyof typeof TIMELINE_MARK_KIND];

export interface TimelineBar {
    readonly id: string;
    readonly kind: TimelineBarKind;
    readonly label: string;
    readonly startSeconds: number;
    readonly durationSeconds: number;
    readonly startRatio: number;
    readonly widthRatio: number;
    /** Program 片段直接引用运镜 = 跟随态,重定时时一并移动 */
    readonly linked: boolean;
}

export interface TimelineMark {
    readonly id: string;
    readonly kind: TimelineMarkKind;
    /** 所属片段/轨道 id:回写命令按它定位 */
    readonly ownerId: string;
    readonly timeSeconds: number;
    readonly ratio: number;
}

export interface TimelineRow {
    readonly kind: TimelineRowKind;
    readonly id: string;
    readonly label: string;
    readonly bars: readonly TimelineBar[];
    readonly marks: readonly TimelineMark[];
}

const PROGRAM_ROW_ID = "program";
const PROGRAM_ROW_LABEL = "Program 输出";
const MOTION_ROW_ID = "motion";
const MOTION_ROW_LABEL = "运镜";
const MOTION_LABEL_PREFIX = "运镜 ";

/**
 * 时间轴视图模型(投影,应用层):Program 输出、独立运镜片段与走位轨三个数据源 → 统一行几何。
 *
 * 展开轨、迷你轨与未来的音频轨共用这一份投影;缩放平移退化为「换一个 TimelineViewport 值对象」,
 * 像素换算不再在两处各写一套。投影结果不入文档、不进撤销栈。
 */
export class TimelineLayout {
    constructor(
        private readonly motion: CameraMotionStore,
        private readonly timeline: TimelineStore,
    ) {}

    project(viewport: TimelineViewport): readonly TimelineRow[] {
        return [this.programRow(viewport), this.motionRow(viewport), ...this.transformRows(viewport)];
    }

    /** 迷你轨只要片段几何,不需要行分组:收起态也得看得见运镜的时间位置。 */
    bars(viewport: TimelineViewport): readonly TimelineBar[] {
        return this.project(viewport).flatMap((row) => row.bars);
    }

    private programRow(viewport: TimelineViewport): TimelineRow {
        const bars = this.motion.program.clips.map((clip) => ({
            id: clip.id,
            kind: TIMELINE_BAR_KIND.PROGRAM,
            label:
                clip.source.kind === PROGRAM_SOURCE_KIND.STATIC_SHOT
                    ? clip.source.shotId
                    : `${MOTION_LABEL_PREFIX}${clip.source.motionClipId}`,
            startSeconds: clip.startTimeSeconds,
            durationSeconds: clip.durationSeconds,
            startRatio: viewport.ratioAt(clip.startTimeSeconds),
            widthRatio: clip.durationSeconds / viewport.visibleSeconds,
            linked: clip.source.kind === PROGRAM_SOURCE_KIND.MOTION_CLIP,
        }));
        return { kind: TIMELINE_ROW_KIND.PROGRAM, id: PROGRAM_ROW_ID, label: PROGRAM_ROW_LABEL, bars, marks: [] };
    }

    /** 运镜资产按时间轴独立成行,不再按静态机位分组。 */
    private motionRow(viewport: TimelineViewport): TimelineRow {
        const clips = this.motion.clips;
        return {
            kind: TIMELINE_ROW_KIND.MOTION,
            id: MOTION_ROW_ID,
            label: MOTION_ROW_LABEL,
            bars: clips.map((clip) => ({
                id: clip.id,
                kind: TIMELINE_BAR_KIND.MOTION,
                label: `${MOTION_LABEL_PREFIX}${clip.id}`,
                startSeconds: clip.startTimeSeconds,
                durationSeconds: clip.durationSeconds,
                startRatio: viewport.ratioAt(clip.startTimeSeconds),
                widthRatio: clip.durationSeconds / viewport.visibleSeconds,
                linked: this.motion.program.clips.some(
                    (programClip) =>
                        programClip.source.kind === PROGRAM_SOURCE_KIND.MOTION_CLIP &&
                        programClip.source.motionClipId === clip.id,
                ),
            })),
            marks: clips.flatMap((clip) =>
                clip.keys.map((key) => {
                    const timeSeconds = clip.timeAtProgress(key.progress);
                    return {
                        id: key.id,
                        kind: TIMELINE_MARK_KIND.CAMERA_KEY,
                        ownerId: clip.id,
                        timeSeconds,
                        ratio: viewport.ratioAt(timeSeconds),
                    };
                }),
            ),
        };
    }

    private transformRows(viewport: TimelineViewport): readonly TimelineRow[] {
        return this.timeline.document.tracks.map((track) => ({
            kind: TIMELINE_ROW_KIND.TRANSFORM,
            id: track.id,
            label: track.targetId,
            bars: [],
            marks: track.keyframes.map((keyframe) => ({
                id: keyframe.id,
                kind: TIMELINE_MARK_KIND.TRANSFORM_KEY,
                ownerId: track.id,
                timeSeconds: keyframe.time,
                ratio: viewport.ratioAt(keyframe.time),
            })),
        }));
    }
}
