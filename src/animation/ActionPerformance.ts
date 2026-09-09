import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import type { ActionLoopMode } from "@/assets/ActionAsset";
import { ActionAlignment } from "@/animation/ActionAlignment";
import type { ActionAlignmentInit } from "@/animation/ActionAlignment";

export const MINIMUM_ACTION_DURATION_SECONDS = 1 / 240;
export const DEFAULT_ACTION_ATTACK_SECONDS = 0.2;
export const DEFAULT_ACTION_RELEASE_SECONDS = 0.25;

export interface ActionPerformanceInit {
    /**
     * 排期段的稳定身份。同一实体可对同一动作有多段排期(走→停→走),
     * 因此 actionId 不能定位「哪一段」;时间轴段条、选中态、binder 的 clip 与
     * 文档 mountedOn 全部按本 id 对齐,重定时改了起点也不会指错段。
     */
    readonly id: string;
    readonly actionId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    /** 动作开始时从常驻姿势进入动作的过渡时长;0 = 直接切换。 */
    readonly attackSeconds?: number;
    /** once 结束后回到常驻姿势的回收时长;0 = 直接切换。 */
    readonly releaseSeconds?: number;
    /**
     * 可选的走位轨对齐:非空时 startTime/duration 由它派生,轨道重定时后自动跟随。
     * 落账的 startTime/duration 仍是解析后的具体值——采样期不再查表,且解析失败可回退。
     */
    readonly alignment?: ActionAlignmentInit | ActionAlignment | null;
}

/**
 * 动作演出(值对象):同一动作资产挂到某实体后的时间轴排期。
 * durationSeconds 是动作本身的演出时长;attack/release 是它与常驻姿势之间的确定性过渡。
 */
export class ActionPerformance {
    /** 段身份:命令层、binder、时间轴投影与文档共用的唯一定位键。 */
    readonly id: string;
    readonly actionId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly attackSeconds: number;
    readonly releaseSeconds: number;
    /** 非空 = 时段由走位轨区间派生;命令层在轨道变动后据此重解算。 */
    readonly alignment: ActionAlignment | null;

    constructor(init: ActionPerformanceInit) {
        const attackSeconds = init.attackSeconds ?? DEFAULT_ACTION_ATTACK_SECONDS;
        const releaseSeconds = init.releaseSeconds ?? DEFAULT_ACTION_RELEASE_SECONDS;
        if (typeof init.id !== "string" || init.id.length === 0) {
            throw new Error("ActionPerformance: id 必须是非空字符串");
        }
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
        this.id = init.id;
        this.actionId = init.actionId;
        this.startTimeSeconds = init.startTimeSeconds;
        this.durationSeconds = init.durationSeconds;
        this.attackSeconds = attackSeconds;
        this.releaseSeconds = releaseSeconds;
        this.alignment =
            init.alignment instanceof ActionAlignment
                ? init.alignment
                : init.alignment
                  ? new ActionAlignment(init.alignment)
                  : null;
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

    /** 手动重定时:显式给时段即解除对齐(作者的直接操作胜过声明式派生)。 */
    withRange(startTimeSeconds: number, durationSeconds: number): ActionPerformance {
        return this.replicate({ startTimeSeconds, durationSeconds, alignment: null });
    }

    /** 对齐重解算:轨道区间变了,时段跟着走,对齐声明保留。 */
    withAlignedRange(startTimeSeconds: number, durationSeconds: number): ActionPerformance {
        return this.replicate({ startTimeSeconds, durationSeconds });
    }

    withTransitionSeconds(attackSeconds: number, releaseSeconds: number): ActionPerformance {
        return this.replicate({ attackSeconds, releaseSeconds });
    }

    toJSON(): Required<ActionPerformanceInit> {
        return {
            id: this.id,
            actionId: this.actionId,
            startTimeSeconds: this.startTimeSeconds,
            durationSeconds: this.durationSeconds,
            attackSeconds: this.attackSeconds,
            releaseSeconds: this.releaseSeconds,
            alignment: this.alignment?.toJSON() ?? null,
        };
    }

    private replicate(overrides: Partial<ActionPerformanceInit>): ActionPerformance {
        return new ActionPerformance({
            id: this.id,
            actionId: this.actionId,
            startTimeSeconds: this.startTimeSeconds,
            durationSeconds: this.durationSeconds,
            attackSeconds: this.attackSeconds,
            releaseSeconds: this.releaseSeconds,
            alignment: this.alignment,
            ...overrides,
        });
    }
}
