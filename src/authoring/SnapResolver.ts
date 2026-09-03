/** 吸附阈值用像素而非秒:缩放后手感恒定(DCC 通行做法)。 */
export const SNAP_THRESHOLD_PX = 6;
const WHOLE_SECOND = 1;

export const SNAP_CANDIDATE_KIND = {
    PLAYHEAD: "playhead",
    EDGE: "edge",
    KEY: "key",
    MARKER: "marker",
    WHOLE_SECOND: "whole-second",
} as const;
export type SnapCandidateKind = (typeof SNAP_CANDIDATE_KIND)[keyof typeof SNAP_CANDIDATE_KIND];

export interface SnapCandidates {
    readonly playheadSeconds: number;
    /** 相邻片段边界(同轨或跨轨) */
    readonly edges: readonly number[];
    /** 其它关键帧时刻 */
    readonly keys: readonly number[];
    /** 全片标记时刻 */
    readonly markers: readonly number[];
}

export interface SnapRequest {
    readonly timeSeconds: number;
    readonly secondsPerPixel: number;
    readonly candidates: SnapCandidates;
    /** Alt 临时关闭吸附 */
    readonly enabled: boolean;
    readonly durationSeconds: number;
}

export interface SnapCandidate {
    readonly kind: SnapCandidateKind;
    readonly timeSeconds: number;
}

export interface SnapResolution {
    readonly timeSeconds: number;
    readonly candidate: SnapCandidate | null;
}

function clamp(timeSeconds: number, durationSeconds: number): number {
    return Math.min(Math.max(timeSeconds, 0), durationSeconds);
}

function nearestCandidate(timeSeconds: number, candidates: readonly SnapCandidate[]): SnapCandidate | null {
    return candidates.reduce<SnapCandidate | null>((best, candidate) => {
        const isCloser =
            best === null || Math.abs(candidate.timeSeconds - timeSeconds) < Math.abs(best.timeSeconds - timeSeconds);
        return isCloser ? candidate : best;
    }, null);
}

function candidatesFor(request: SnapRequest, clamped: number): readonly SnapCandidate[] {
    return [
        { kind: SNAP_CANDIDATE_KIND.PLAYHEAD, timeSeconds: request.candidates.playheadSeconds },
        { kind: SNAP_CANDIDATE_KIND.WHOLE_SECOND, timeSeconds: Math.round(clamped / WHOLE_SECOND) * WHOLE_SECOND },
        ...request.candidates.edges.map((timeSeconds) => ({ kind: SNAP_CANDIDATE_KIND.EDGE, timeSeconds })),
        ...request.candidates.keys.map((timeSeconds) => ({ kind: SNAP_CANDIDATE_KIND.KEY, timeSeconds })),
        ...request.candidates.markers.map((timeSeconds) => ({ kind: SNAP_CANDIDATE_KIND.MARKER, timeSeconds })),
    ];
}

/**
 * 吸附候选解析(策略,无状态):playhead / 片段边界 / 整秒 / 其它关键帧 / 标记。
 * 时间轴上的片段拖拽、拉伸与关键帧重定时共用它,不各写一套阈值判断。
 */
export class SnapResolver {
    resolve(request: SnapRequest): SnapResolution {
        const clamped = clamp(request.timeSeconds, request.durationSeconds);
        if (!request.enabled) return { timeSeconds: clamped, candidate: null };
        const candidate = nearestCandidate(clamped, candidatesFor(request, clamped));
        const threshold = SNAP_THRESHOLD_PX * request.secondsPerPixel;
        const isWithinThreshold = candidate !== null && Math.abs(candidate.timeSeconds - clamped) <= threshold;
        return isWithinThreshold
            ? { timeSeconds: clamp(candidate.timeSeconds, request.durationSeconds), candidate }
            : { timeSeconds: clamped, candidate: null };
    }
}
