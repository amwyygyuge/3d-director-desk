import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import type { ActionLoopMode } from "@/assets/ActionAsset";

export const MINIMUM_ACTION_DURATION_SECONDS = 1 / 240;

export interface ActionPerformanceInit {
    readonly actionId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
}

/**
 * 动作演出(值对象):同一动作资产挂到某实体后的时间轴排期。
 * durationSeconds 是一次演出占用的时长;clip 采样按进度映射,重定时不复制轨道。
 */
export class ActionPerformance {
    readonly actionId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;

    constructor(init: ActionPerformanceInit) {
        if (!Number.isFinite(init.startTimeSeconds) || init.startTimeSeconds < 0) {
            throw new Error("ActionPerformance: startTimeSeconds 必须是 ≥0 的有限数");
        }
        if (!Number.isFinite(init.durationSeconds) || init.durationSeconds < MINIMUM_ACTION_DURATION_SECONDS) {
            throw new Error("ActionPerformance: durationSeconds 必须大于 0");
        }
        this.actionId = init.actionId;
        this.startTimeSeconds = init.startTimeSeconds;
        this.durationSeconds = init.durationSeconds;
        Object.freeze(this);
    }

    get endTimeSeconds(): number {
        return this.startTimeSeconds + this.durationSeconds;
    }

    /** null = 排期尚未开始,骨骼应回到基线;once 结束后返回 clip 末帧,避免循环缝瞬跳。 */
    clipTimeAt(timeSeconds: number, clipDurationSeconds: number, loopMode: ActionLoopMode): number | null {
        const offsetSeconds = timeSeconds - this.startTimeSeconds;
        if (offsetSeconds < 0) return null;
        const progress = offsetSeconds / this.durationSeconds;
        const clampedProgress = loopMode === ACTION_LOOP_MODE.LOOP ? progress % 1 : Math.min(progress, 1);
        return clampedProgress * clipDurationSeconds;
    }

    withRange(startTimeSeconds: number, durationSeconds: number): ActionPerformance {
        return new ActionPerformance({ actionId: this.actionId, startTimeSeconds, durationSeconds });
    }

    toJSON(): ActionPerformanceInit {
        return {
            actionId: this.actionId,
            startTimeSeconds: this.startTimeSeconds,
            durationSeconds: this.durationSeconds,
        };
    }
}
