/** 吸附阈值用像素而非秒:缩放后手感恒定(DCC 通行做法)。 */
export const SNAP_THRESHOLD_PX = 6;
const WHOLE_SECOND = 1;

export interface SnapCandidates {
    readonly playheadSeconds: number;
    /** 相邻片段边界(同轨或跨轨) */
    readonly edges: readonly number[];
    /** 其它关键帧时刻 */
    readonly keys: readonly number[];
}

export interface SnapRequest {
    readonly timeSeconds: number;
    readonly secondsPerPixel: number;
    readonly candidates: SnapCandidates;
    /** Alt 临时关闭吸附 */
    readonly enabled: boolean;
    readonly durationSeconds: number;
}

function nearestCandidate(timeSeconds: number, candidates: readonly number[]): number | null {
    return candidates.reduce<number | null>((best, candidate) => {
        const isCloser = best === null || Math.abs(candidate - timeSeconds) < Math.abs(best - timeSeconds);
        return isCloser ? candidate : best;
    }, null);
}

/**
 * 吸附候选解析(策略,无状态):playhead / 片段边界 / 整秒 / 其它关键帧。
 * 时间轴上的片段拖拽、拉伸与关键帧重定时共用它,不各写一套阈值判断。
 */
export class SnapResolver {
    resolve(request: SnapRequest): number {
        const clamped = Math.min(Math.max(request.timeSeconds, 0), request.durationSeconds);
        if (!request.enabled) return clamped;
        const wholeSecond = Math.round(clamped / WHOLE_SECOND) * WHOLE_SECOND;
        const candidates = [request.candidates.playheadSeconds, wholeSecond, ...request.candidates.edges, ...request.candidates.keys];
        const nearest = nearestCandidate(clamped, candidates);
        const threshold = SNAP_THRESHOLD_PX * request.secondsPerPixel;
        const isWithinThreshold = nearest !== null && Math.abs(nearest - clamped) <= threshold;
        return isWithinThreshold ? Math.min(Math.max(nearest, 0), request.durationSeconds) : clamped;
    }
}
