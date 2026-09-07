import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import type { ActionLoopMode } from "@/assets/ActionAsset";

export const MINIMUM_ACTION_DURATION_SECONDS = 1 / 240;
export const DEFAULT_ACTION_ATTACK_SECONDS = 0.2;
export const DEFAULT_ACTION_RELEASE_SECONDS = 0.25;

export interface ActionPerformanceInit {
    readonly actionId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    /** 动作开始时从常驻姿势进入动作的过渡时长;0 = 直接切换。 */
    readonly attackSeconds?: number;
    /** once 结束后回到常驻姿势的回收时长;0 = 直接切换。 */
    readonly releaseSeconds?: number;
}

/**
 * 动作演出(值对象):同一动作资产挂到某实体后的时间轴排期。
 * durationSeconds 是动作本身的演出时长;attack/release 是它与常驻姿势之间的确定性过渡。
 */
export class ActionPerformance {
    readonly actionId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly attackSeconds: number;
    readonly releaseSeconds: number;

    constructor(init: ActionPerformanceInit) {
        const attackSeconds = init.attackSeconds ?? DEFAULT_ACTION_ATTACK_SECONDS;
        const releaseSeconds = init.releaseSeconds ?? DEFAULT_ACTION_RELEASE_SECONDS;
        if (!Number.isFinite(init.startTimeSeconds) || init.startTimeSeconds < 0) {
            throw new Error("ActionPerformance: startTimeSeconds 必须是 ≥0 的有限数");
        }
        if (!Number.isFinite(init.durationSeconds) || init.durationSeconds < MINIMUM_ACTION_DURATION_SECONDS) {
            throw new Error("ActionPerformance: durationSeconds 必须大于 0");
        }
        if (!Number.isFinite(attackSeconds) || attackSeconds < 0) {
            throw new Error("ActionPerformance: attackSeconds 必须是 ≥0 的有限数");
        }
        if (!Number.isFinite(releaseSeconds) || releaseSeconds < 0) {
            throw new Error("ActionPerformance: releaseSeconds 必须是 ≥0 的有限数");
        }
        this.actionId = init.actionId;
        this.startTimeSeconds = init.startTimeSeconds;
        this.durationSeconds = init.durationSeconds;
        this.attackSeconds = attackSeconds;
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

    /** null = 不在进入段;0..1 = 常驻姿势让位给动作的进度。 */
    attackProgressAt(timeSeconds: number): number | null {
        if (this.attackSeconds === 0) return null;
        if (timeSeconds < this.startTimeSeconds || timeSeconds > this.startTimeSeconds + this.attackSeconds) {
            return null;
        }
        return (timeSeconds - this.startTimeSeconds) / this.attackSeconds;
    }

    /** null = 不在回收段;0..1 = 从动作末帧回收至常驻姿势的进度。循环动作由 binder 忽略。 */
    releaseProgressAt(timeSeconds: number): number | null {
        if (this.releaseSeconds === 0) return null;
        if (timeSeconds < this.endTimeSeconds || timeSeconds > this.releaseEndTimeSeconds) return null;
        return (timeSeconds - this.endTimeSeconds) / this.releaseSeconds;
    }

    withRange(startTimeSeconds: number, durationSeconds: number): ActionPerformance {
        return this.replicate({ startTimeSeconds, durationSeconds });
    }

    withTransitionSeconds(attackSeconds: number, releaseSeconds: number): ActionPerformance {
        return this.replicate({ attackSeconds, releaseSeconds });
    }

    toJSON(): Required<ActionPerformanceInit> {
        return {
            actionId: this.actionId,
            startTimeSeconds: this.startTimeSeconds,
            durationSeconds: this.durationSeconds,
            attackSeconds: this.attackSeconds,
            releaseSeconds: this.releaseSeconds,
        };
    }

    private replicate(overrides: Partial<ActionPerformanceInit>): ActionPerformance {
        return new ActionPerformance({
            actionId: this.actionId,
            startTimeSeconds: this.startTimeSeconds,
            durationSeconds: this.durationSeconds,
            attackSeconds: this.attackSeconds,
            releaseSeconds: this.releaseSeconds,
            ...overrides,
        });
    }
}
