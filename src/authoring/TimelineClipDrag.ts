import { SnapResolver } from "@/authoring/SnapResolver";
import type { SnapCandidates } from "@/authoring/SnapResolver";
import type { TimelineViewport } from "@/authoring/TimelineViewport";

const TIME_START_SECONDS = 0;
const PROGRESS_FULL = 1;
const MINIMUM_DURATION_SECONDS = 0.001;

export const TIMELINE_DRAG_KIND = {
    MOVE: "move",
    RESIZE_START: "resize-start",
    RESIZE_END: "resize-end",
} as const;
export type TimelineDragKind = (typeof TIMELINE_DRAG_KIND)[keyof typeof TIMELINE_DRAG_KIND];

export interface TimelineClipRange {
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
}

export interface TimelineClipDragResolveOptions {
    readonly kind: TimelineDragKind;
    readonly pointer: {
        readonly originTimeSeconds: number;
        readonly currentTimeSeconds: number;
    };
    readonly originalRange: TimelineClipRange;
    readonly viewport: TimelineViewport;
    readonly trackWidthPx: number;
    readonly candidates: SnapCandidates;
    readonly isSnapEnabled: boolean;
    readonly durationSeconds: number;
}

export interface TimelineClipDragTransformOptions {
    readonly kind: TimelineDragKind;
    readonly originalRange: TimelineClipRange;
    readonly range: TimelineClipRange;
    readonly viewport: TimelineViewport;
    readonly trackWidthPx: number;
}

interface DragBounds {
    readonly minimum: number;
    readonly maximum: number;
}

interface DragResolution {
    readonly boundaryTimeSeconds: number;
    readonly bounds: DragBounds;
    readonly rangeForBoundary: (boundaryTimeSeconds: number) => TimelineClipRange;
}

function clamp(value: number, bounds: DragBounds): number {
    return Math.min(Math.max(value, bounds.minimum), bounds.maximum);
}

function translateTransform(translatePixels: number, scale: number): string {
    return `translateX(${translatePixels}px) scaleX(${scale})`;
}

/**
 * 片段重定时的纯领域服务:手势层只负责把 DOM 指针换成时间，三类轨道共享同一套边界、吸附与预览几何。
 * 产物仍是不可变值，拖拽过程不触碰文档状态或撤销历史。
 */
export class TimelineClipDragResolver {
    private readonly snapResolver = new SnapResolver();

    dragKindAt(options: {
        readonly pointerOffsetPx: number;
        readonly barWidthPx: number;
        readonly handleWidthPx: number;
    }): TimelineDragKind {
        const isNearStart = options.pointerOffsetPx <= options.handleWidthPx;
        const isNearEnd = options.barWidthPx - options.pointerOffsetPx <= options.handleWidthPx;
        const kinds: readonly [boolean, TimelineDragKind][] = [
            [isNearStart, TIMELINE_DRAG_KIND.RESIZE_START],
            [isNearEnd, TIMELINE_DRAG_KIND.RESIZE_END],
        ];
        return kinds.find(([matches]) => matches)?.[1] ?? TIMELINE_DRAG_KIND.MOVE;
    }

    resolve(options: TimelineClipDragResolveOptions): TimelineClipRange {
        const resolution = this.resolutionFor(options);
        const bounded = clamp(resolution.boundaryTimeSeconds, resolution.bounds);
        const snap = this.snapResolver.resolve({
            timeSeconds: bounded,
            secondsPerPixel: options.viewport.secondsPerPixel(options.trackWidthPx),
            candidates: options.candidates,
            enabled: options.isSnapEnabled,
            durationSeconds: options.durationSeconds,
        });
        return resolution.rangeForBoundary(clamp(snap.timeSeconds, resolution.bounds));
    }

    transformFor(options: TimelineClipDragTransformOptions): string {
        const secondsPerPixel = options.viewport.secondsPerPixel(options.trackWidthPx);
        const translateSeconds = options.range.startTimeSeconds - options.originalRange.startTimeSeconds;
        const scale = options.range.durationSeconds / options.originalRange.durationSeconds;
        const transforms: Record<TimelineDragKind, string> = {
            [TIMELINE_DRAG_KIND.MOVE]: translateTransform(translateSeconds / secondsPerPixel, PROGRESS_FULL),
            [TIMELINE_DRAG_KIND.RESIZE_START]: translateTransform(translateSeconds / secondsPerPixel, scale),
            [TIMELINE_DRAG_KIND.RESIZE_END]: translateTransform(TIME_START_SECONDS, scale),
        };
        return transforms[options.kind];
    }

    private resolutionFor(options: TimelineClipDragResolveOptions): DragResolution {
        const deltaSeconds = options.pointer.currentTimeSeconds - options.pointer.originTimeSeconds;
        const endTimeSeconds = options.originalRange.startTimeSeconds + options.originalRange.durationSeconds;
        const resolutions: Record<TimelineDragKind, DragResolution> = {
            [TIMELINE_DRAG_KIND.MOVE]: {
                boundaryTimeSeconds: options.originalRange.startTimeSeconds + deltaSeconds,
                bounds: {
                    minimum: TIME_START_SECONDS,
                    maximum: options.durationSeconds - options.originalRange.durationSeconds,
                },
                rangeForBoundary: (startTimeSeconds) => ({
                    startTimeSeconds,
                    durationSeconds: options.originalRange.durationSeconds,
                }),
            },
            [TIMELINE_DRAG_KIND.RESIZE_START]: {
                boundaryTimeSeconds: options.originalRange.startTimeSeconds + deltaSeconds,
                bounds: {
                    minimum: TIME_START_SECONDS,
                    maximum: endTimeSeconds - MINIMUM_DURATION_SECONDS,
                },
                rangeForBoundary: (startTimeSeconds) => ({
                    startTimeSeconds,
                    durationSeconds: endTimeSeconds - startTimeSeconds,
                }),
            },
            [TIMELINE_DRAG_KIND.RESIZE_END]: {
                boundaryTimeSeconds: endTimeSeconds + deltaSeconds,
                bounds: {
                    minimum: options.originalRange.startTimeSeconds + MINIMUM_DURATION_SECONDS,
                    maximum: options.durationSeconds,
                },
                rangeForBoundary: (endTime) => ({
                    startTimeSeconds: options.originalRange.startTimeSeconds,
                    durationSeconds: endTime - options.originalRange.startTimeSeconds,
                }),
            },
        };
        return resolutions[options.kind];
    }
}
