import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import type { ActionLoopMode } from "@/assets/ActionAsset";

export const MINIMUM_ACTION_DURATION_SECONDS = 1 / 240;
export const DEFAULT_ACTION_RELEASE_SECONDS = 0.25;

export interface ActionPerformanceInit {
    readonly actionId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    /** once 结束后回到常驻姿势的回收时长;0 = 直接切换。 */
    readonly releaseSeconds?: number;
}

/**
 * 动作演出(值对象):同一动作资产挂到某实体后的时间轴排期。
 * durationSeconds 是动作本身的演出时长;releaseSeconds 是 once 结束后回到常驻姿势的回收段。
 */
export class ActionPerformance {
    readonly actionId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly releaseSeconds: number;

    constructor(init: ActionPerformanceInit) {
        const releaseSeconds = init.releaseSeconds ?? DEFAULT_ACTION_RELEASE_SECONDS;
        if (!Number.isFinite(init.startTimeSeconds) || init.startTimeSeconds < 0) {
            throw new Error("ActionPerformance: startTimeSeconds 必须是 ≥0 的有限数");
        }
        if (!Number.isFinite(init.durationSeconds) || init.durationSeconds < MINIMUM_ACTION_DURATION_SECONDS) {
            throw new Error("ActionPerformance: durationSeconds 必须大于 0");
        }
        if (!Number.isFinite(releaseSeconds) || releaseSeconds < 0) {
            throw new Error("ActionPerformance: releaseSeconds 必须是 ≥0 的有限数");
        }
        this.actionId = init.actionId;
        this.startTimeSeconds = init.startTimeSeconds;
        this.durationSeconds = init.durationSeconds;
        this.releaseSeconds = releaseSeconds;
        Object.freeze(this);
    }

    get endTimeSeconds(): number {
        return this.startTimeSeconds + this.durationSeconds;
    }

    get releaseEndTimeSeconds(): number {
        return this.endTimeSeconds + this.releaseSeconds;
    }

    /** null = 排期尚未开始或 once 已完全回收,骨骼应由常驻姿势接管。 */
    clipTimeAt(timeSeconds: number, clipDurationSeconds: number, loopMode: ActionLoopMode): number | null {
        const offsetSeconds = timeSeconds - this.startTimeSeconds;
        if (offsetSeconds < 0) return null;
        const progress = offsetSeconds / this.durationSeconds;
        if (loopMode === ACTION_LOOP_MODE.LOOP) return (progress % 1) * clipDurationSeconds;
        if (timeSeconds > this.releaseEndTimeSeconds) return null;
        return Math.min(progress, 1) * clipDurationSeconds;
    }

    /** null = 不在回收段;0..1 = 从动作末帧回收至常驻姿势的进度。循环动作由 binder 忽略。 */
    releaseProgressAt(timeSeconds: number): number | null {
        if (this.releaseSeconds === 0) return null;
        if (timeSeconds < this.endTimeSeconds || timeSeconds > this.releaseEndTimeSeconds) return null;
        return (timeSeconds - this.endTimeSeconds) / this.releaseSeconds;
    }

    withRange(startTimeSeconds: number, durationSeconds: number): ActionPerformance {
        return new ActionPerformance({
            actionId: this.actionId,
            startTimeSeconds,
            durationSeconds,
            releaseSeconds: this.releaseSeconds,
        });
    }

    withReleaseSeconds(releaseSeconds: number): ActionPerformance {
        return new ActionPerformance({
            actionId: this.actionId,
            startTimeSeconds: this.startTimeSeconds,
            durationSeconds: this.durationSeconds,
            releaseSeconds,
        });
    }

    toJSON(): Required<ActionPerformanceInit> {
        return {
            actionId: this.actionId,
            startTimeSeconds: this.startTimeSeconds,
            durationSeconds: this.durationSeconds,
            releaseSeconds: this.releaseSeconds,
        };
    }
}
