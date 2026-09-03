import type { TimelineViewport } from "@/authoring/TimelineViewport";
import { PROGRAM_SOURCE_KIND } from "@/camera/CameraProgramTrack";
import type { CameraMotionStore } from "@/store/CameraMotionStore";
import type { TimelineStore } from "@/store/TimelineStore";

export const TIMELINE_ROW_KIND = {
    MARKER: "marker",
    PROGRAM: "program",
    MOTION: "motion",
    TRANSFORM: "transform",
} as const;
export type TimelineRowKind = (typeof TIMELINE_ROW_KIND)[keyof typeof TIMELINE_ROW_KIND];

export const TIMELINE_BAR_KIND = {
    PROGRAM: "program",
    MOTION: "motion",
    TRANSFORM: "transform",
} as const;
export type TimelineBarKind = (typeof TIMELINE_BAR_KIND)[keyof typeof TIMELINE_BAR_KIND];
export type TimelineMiniBar = TimelineBar & {
    readonly kind: typeof TIMELINE_BAR_KIND.PROGRAM | typeof TIMELINE_BAR_KIND.MOTION;
};

export const TIMELINE_MARK_KIND = {
    MARKER: "marker",
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

const MARKER_ROW_ID = "markers";
const MARKER_ROW_LABEL = "标记";
const PROGRAM_ROW_ID = "program";
const PROGRAM_ROW_LABEL = "Program 输出";
const MOTION_ROW_ID = "motion";
const MOTION_ROW_LABEL = "运镜";
const MOTION_LABEL_PREFIX = "运镜 ";
const TRANSFORM_BAR_LABEL = "走位";
const MINIMUM_TRANSFORM_KEYS_FOR_BAR = 2;

const MINI_BAR_KIND: Record<TimelineBarKind, boolean> = {
    [TIMELINE_BAR_KIND.PROGRAM]: true,
    [TIMELINE_BAR_KIND.MOTION]: true,
    [TIMELINE_BAR_KIND.TRANSFORM]: false,
};

function isMiniBar(bar: TimelineBar): bar is TimelineMiniBar {
    return MINI_BAR_KIND[bar.kind];
}

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
        return [
            this.markerRow(viewport),
            this.programRow(viewport),
            this.motionRow(viewport),
            ...this.transformRows(viewport),
        ];
    }

    /** 迷你轨只画成片与运镜:走位仍以关键帧表达,避免与迷你轨已有菱形重叠。 */
    bars(viewport: TimelineViewport): readonly TimelineMiniBar[] {
        return this.project(viewport)
            .flatMap((row) => row.bars)
            .filter(isMiniBar);
    }

    private markerRow(viewport: TimelineViewport): TimelineRow {
        return {
            kind: TIMELINE_ROW_KIND.MARKER,
            id: MARKER_ROW_ID,
            label: MARKER_ROW_LABEL,
            bars: [],
            marks: this.timeline.document.markers.map((marker) => ({
                id: marker.id,
                kind: TIMELINE_MARK_KIND.MARKER,
                ownerId: marker.id,
                timeSeconds: marker.timeSeconds,
                ratio: viewport.ratioAt(marker.timeSeconds),
            })),
        };
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
        return this.timeline.document.tracks.map((track) => {
            const firstKeyframe = track.keyframes[0];
            const lastKeyframe = track.keyframes.at(-1);
            const hasEditableRange = track.keyframes.length >= MINIMUM_TRANSFORM_KEYS_FOR_BAR;
            const bars =
                hasEditableRange && firstKeyframe && lastKeyframe
                    ? [
                          {
                              id: track.id,
                              kind: TIMELINE_BAR_KIND.TRANSFORM,
                              label: TRANSFORM_BAR_LABEL,
                              startSeconds: firstKeyframe.time,
                              durationSeconds: lastKeyframe.time - firstKeyframe.time,
                              startRatio: viewport.ratioAt(firstKeyframe.time),
                              widthRatio: (lastKeyframe.time - firstKeyframe.time) / viewport.visibleSeconds,
                              linked: false,
                          },
                      ]
                    : [];
            return {
                kind: TIMELINE_ROW_KIND.TRANSFORM,
                id: track.id,
                label: track.targetId,
                bars,
                marks: track.keyframes.map((keyframe) => ({
                    id: keyframe.id,
                    kind: TIMELINE_MARK_KIND.TRANSFORM_KEY,
                    ownerId: track.id,
                    timeSeconds: keyframe.time,
                    ratio: viewport.ratioAt(keyframe.time),
                })),
            };
        });
    }
}
