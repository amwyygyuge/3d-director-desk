import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import type { AnimationLibrary } from "@/assets/AnimationLibrary";
import type { TimelineViewport } from "@/authoring/TimelineViewport";
import { PROGRAM_SOURCE_KIND } from "@/camera/CameraProgramTrack";
import type { SceneManager } from "@/core/SceneManager";
import type { CameraMotionStore } from "@/store/CameraMotionStore";
import type { TimelineStore } from "@/store/TimelineStore";
import { TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";

export const TIMELINE_ROW_KIND = {
    MARKER: "marker",
    PROGRAM: "program",
    MOTION: "motion",
    ACTION: "action",
    TRANSFORM: "transform",
} as const;
export type TimelineRowKind = (typeof TIMELINE_ROW_KIND)[keyof typeof TIMELINE_ROW_KIND];

export const TIMELINE_BAR_KIND = {
    PROGRAM: "program",
    MOTION: "motion",
    ACTION: "action",
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
    /**
     * 段条所属者 id。动作段条的 id 是排期段 id,改时段/删除都要同时知道是哪个实体的段,
     * 故投影期一并带出;其余种类的段条自身即所属者。
     */
    readonly ownerId: string;
    readonly label: string;
    readonly startSeconds: number;
    readonly durationSeconds: number;
    readonly startRatio: number;
    readonly widthRatio: number;
    /**
     * 段条实际占用的结束时刻 = **演出末端**。
     *
     * 一次性动作在演出后还有 release 回收过渡,但它**可被下一段抢占**——播放裁决
     * 「倒序取最后一个已开始的段」,下一段一开始就赢(见 `SceneObject.actionPerformanceAt`)。
     * 因此占用只算到演出末端:吸附吸这里,重叠围栏也只报演出段交叠,
     * 「走完立刻倒地」这种紧贴排期才能真正贴上(按回收末端计价会让作者
     * 「明明贴上了却被拒」,且时间轴上留一段无法消除的缝)。
     */
    readonly occupancyEndSeconds: number;
    /**
     * 回收段时长(秒);0 = 无尾巴(循环动作,或作者把 release 设成 0)。
     *
     * 与 `occupancyEndSeconds` 分开表达:回收段**不占用**时间轴(可被下一段抢占),
     * 但要在段条右侧画出来——否则作者不知道这段过渡存在,也读不懂
     * 「紧贴之后前一段的收尾被截短」是预期行为。非动作段条恒为 0。
     */
    readonly releaseSeconds: number;
    /** Program 片段直接引用运镜 = 时段联动态,重定时时一并移动 */
    readonly linked: boolean;
    /** 运镜片段的跟拍主体;非运镜条恒为 null。 */
    readonly followSubjectId: string | null;
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
const ACTION_ROW_PREFIX = "动作 ";
const TRANSFORM_BAR_LABEL = "走位";
const MINIMUM_TRANSFORM_KEYS_FOR_BAR = 2;

const MINI_BAR_KIND: Record<TimelineBarKind, boolean> = {
    [TIMELINE_BAR_KIND.PROGRAM]: true,
    [TIMELINE_BAR_KIND.MOTION]: true,
    [TIMELINE_BAR_KIND.ACTION]: false,
    [TIMELINE_BAR_KIND.TRANSFORM]: false,
};

function isMiniBar(bar: TimelineBar): bar is TimelineMiniBar {
    return MINI_BAR_KIND[bar.kind];
}

/**
 * 时间轴视图模型(投影,应用层):Program 输出、运镜、动作排期与走位轨 → 统一行几何。
 *
 * 展开轨、迷你轨与未来的音频轨共用这一份投影;缩放平移退化为「换一个 TimelineViewport 值对象」,
 * 像素换算不再在两处各写一套。投影结果不入文档、不进撤销栈。
 */
export class TimelineLayout {
    constructor(
        private readonly motion: CameraMotionStore,
        private readonly timeline: TimelineStore,
        private readonly scene: SceneManager,
        private readonly animations: AnimationLibrary,
    ) {}

    project(viewport: TimelineViewport): readonly TimelineRow[] {
        return [
            this.markerRow(viewport),
            this.programRow(viewport),
            this.motionRow(viewport),
            ...this.actionRows(viewport),
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
            ownerId: clip.id,
            kind: TIMELINE_BAR_KIND.PROGRAM,
            label:
                clip.source.kind === PROGRAM_SOURCE_KIND.STATIC_SHOT
                    ? clip.source.shotId
                    : `${MOTION_LABEL_PREFIX}${clip.source.motionClipId}`,
            startSeconds: clip.startTimeSeconds,
            durationSeconds: clip.durationSeconds,
            startRatio: viewport.ratioAt(clip.startTimeSeconds),
            widthRatio: clip.durationSeconds / viewport.visibleSeconds,
            occupancyEndSeconds: clip.endTimeSeconds,
            releaseSeconds: 0,
            linked: clip.source.kind === PROGRAM_SOURCE_KIND.MOTION_CLIP,
            followSubjectId: null,
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
                ownerId: clip.id,
                kind: TIMELINE_BAR_KIND.MOTION,
                label: `${MOTION_LABEL_PREFIX}${clip.id}`,
                startSeconds: clip.startTimeSeconds,
                durationSeconds: clip.durationSeconds,
                startRatio: viewport.ratioAt(clip.startTimeSeconds),
                widthRatio: clip.durationSeconds / viewport.visibleSeconds,
                occupancyEndSeconds: clip.endTimeSeconds,
                releaseSeconds: 0,
                linked: this.motion.program.clips.some(
                    (programClip) =>
                        programClip.source.kind === PROGRAM_SOURCE_KIND.MOTION_CLIP &&
                        programClip.source.motionClipId === clip.id,
                ),
                followSubjectId: clip.follow?.objectId ?? null,
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

    /**
     * 动作排期按实体成行,行内**每一段排期各自成条**。
     *
     * 段条 id 用排期段 id(而非实体 id):一个实体可以依次表演多段动作
     * (被驱赶 → 调头 → 走路 → 倒地),按实体寻址只能表达第一段,
     * 拖拽与删除也会误伤其余段。
     */
    private actionRows(viewport: TimelineViewport): readonly TimelineRow[] {
        return this.scene.list().flatMap((entity) => {
            const bars = entity.actionPerformances.flatMap((performance) => {
                const action = this.animations.actions.find((candidate) => candidate.id === performance.actionId);
                if (!action) return [];
                return [
                    {
                        id: performance.id,
                        ownerId: entity.id,
                        kind: TIMELINE_BAR_KIND.ACTION,
                        label: action.name,
                        startSeconds: performance.startTimeSeconds,
                        durationSeconds: performance.durationSeconds,
                        startRatio: viewport.ratioAt(performance.startTimeSeconds),
                        widthRatio: performance.durationSeconds / viewport.visibleSeconds,
                        // 回收段可被抢占,不计入占用:吸附与围栏都只认演出末端
                        occupancyEndSeconds: performance.endTimeSeconds,
                        // 一次性动作才有回收过渡;循环动作直接接续,没有收尾
                        releaseSeconds: action.loopMode === ACTION_LOOP_MODE.ONCE ? performance.releaseSeconds : 0,
                        linked: performance.alignment !== null,
                        followSubjectId: null,
                    },
                ];
            });
            if (bars.length === 0) return [];
            return [
                {
                    kind: TIMELINE_ROW_KIND.ACTION,
                    id: `action:${entity.id}`,
                    label: `${ACTION_ROW_PREFIX}${entity.name}`,
                    bars,
                    marks: [],
                },
            ];
        });
    }

    /** 只投影走位轨:轨道种类将来会扩张,不按 kind 过滤会让别的轨凭空多出一条空走位行。 */
    private transformRows(viewport: TimelineViewport): readonly TimelineRow[] {
        return this.timeline.document.tracks
            .filter((track) => track.kind === TIMELINE_TRACK_KIND.TRANSFORM)
            .map((track) => {
                const firstKeyframe = track.keyframes[0];
                const lastKeyframe = track.keyframes.at(-1);
                const hasEditableRange = track.keyframes.length >= MINIMUM_TRANSFORM_KEYS_FOR_BAR;
                const bars =
                    hasEditableRange && firstKeyframe && lastKeyframe
                        ? [
                              {
                                  id: track.id,
                                  ownerId: track.id,
                                  kind: TIMELINE_BAR_KIND.TRANSFORM,
                                  label: TRANSFORM_BAR_LABEL,
                                  startSeconds: firstKeyframe.time,
                                  durationSeconds: lastKeyframe.time - firstKeyframe.time,
                                  startRatio: viewport.ratioAt(firstKeyframe.time),
                                  widthRatio: (lastKeyframe.time - firstKeyframe.time) / viewport.visibleSeconds,
                                  occupancyEndSeconds: lastKeyframe.time,
                                  releaseSeconds: 0,
                                  linked: false,
                                  followSubjectId: null,
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
