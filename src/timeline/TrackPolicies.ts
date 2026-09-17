/**
 * 走位轨的三条策略(纯数据值对象,可 JSON 往返)。
 *
 * 它们回答的是同一个问题的三个侧面:关键帧只定义「经过哪些点」,而一个可信的走位
 * 还需要「面朝哪」「脚踩在哪」「腿迈多快」——这三件事各自可替换,故落成独立策略而非
 * 塞进关键帧;它们属于整条轨(作者对这段走位的意图),不属于单帧。
 */

export const ORIENTATION_MODE = {
    /** 朝向由关键帧的 rotation 插值(作者逐帧摆) */
    KEYED: "keyed",
    /** 朝向跟随轨迹切线(走路天然面朝前进方向) */
    PATH: "path",
} as const;
export type OrientationMode = (typeof ORIENTATION_MODE)[keyof typeof ORIENTATION_MODE];

export const GROUNDING_MODE = {
    /** 高度由关键帧决定(飞行物/升降) */
    NONE: "none",
    /** 高度锁到地面(走位默认:画线时不必管 Y) */
    GROUND: "ground",
} as const;
export type GroundingMode = (typeof GROUNDING_MODE)[keyof typeof GROUNDING_MODE];

export const LOCOMOTION_MODE = {
    /** 动作按墙钟走,与位移无关(默认,兼容无步幅信息的动作) */
    FREE: "free",
    /** 动作相位由已走弧长驱动:走得快步频快,scrub 也精确复现 */
    SYNC: "sync",
} as const;
export type LocomotionMode = (typeof LOCOMOTION_MODE)[keyof typeof LOCOMOTION_MODE];

export const EXTRAPOLATION_MODE = {
    /** 跨度之外钳到首/末关键帧:走完停在终点,开演前站在起点(默认,符合 DCC 常量外插惯例) */
    HOLD: "hold",
    /** 跨度之外交还实体权威变换:对象可在轨道时段外被 gizmo 自由摆放 */
    REST: "rest",
} as const;
export type ExtrapolationMode = (typeof EXTRAPOLATION_MODE)[keyof typeof EXTRAPOLATION_MODE];

/** 缺省步幅(米/循环):成年人行走一个动作循环大致推进的距离,作者可按动作改。 */
export const DEFAULT_STRIDE_METERS = 1.6;
/** 步幅下限:防止除零把相位炸到无穷。 */
const MINIMUM_STRIDE_METERS = 0.01;

export interface TrackPoliciesInit {
    readonly orientation?: OrientationMode;
    readonly grounding?: GroundingMode;
    readonly locomotion?: LocomotionMode;
    readonly strideMeters?: number;
    /** 轨道时间跨度之外如何取值;缺省 hold(走完停在终点)。 */
    readonly extrapolation?: ExtrapolationMode;
}

export function isOrientationMode(value: unknown): value is OrientationMode {
    return value === ORIENTATION_MODE.KEYED || value === ORIENTATION_MODE.PATH;
}

export function isGroundingMode(value: unknown): value is GroundingMode {
    return value === GROUNDING_MODE.NONE || value === GROUNDING_MODE.GROUND;
}

export function isLocomotionMode(value: unknown): value is LocomotionMode {
    return value === LOCOMOTION_MODE.FREE || value === LOCOMOTION_MODE.SYNC;
}

export function isExtrapolationMode(value: unknown): value is ExtrapolationMode {
    return value === EXTRAPOLATION_MODE.HOLD || value === EXTRAPOLATION_MODE.REST;
}

export function isStrideMeters(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= MINIMUM_STRIDE_METERS;
}

/**
 * 走位策略集合(不可变值对象)。
 * 默认取「面朝前进方向 + 贴地 + 动作自由 + 跨度外保持」:画一条线就能得到一段站得住的走位,
 * 步频同步需要作者提供步幅,故不做默认。
 */
export class TrackPolicies {
    readonly orientation: OrientationMode;
    readonly grounding: GroundingMode;
    readonly locomotion: LocomotionMode;
    readonly strideMeters: number;
    readonly extrapolation: ExtrapolationMode;

    constructor(init: TrackPoliciesInit = {}) {
        this.orientation = isOrientationMode(init.orientation) ? init.orientation : ORIENTATION_MODE.PATH;
        this.grounding = isGroundingMode(init.grounding) ? init.grounding : GROUNDING_MODE.GROUND;
        this.locomotion = isLocomotionMode(init.locomotion) ? init.locomotion : LOCOMOTION_MODE.FREE;
        this.strideMeters = isStrideMeters(init.strideMeters) ? init.strideMeters : DEFAULT_STRIDE_METERS;
        this.extrapolation = isExtrapolationMode(init.extrapolation) ? init.extrapolation : EXTRAPOLATION_MODE.HOLD;
        Object.freeze(this);
    }

    get isPathOriented(): boolean {
        return this.orientation === ORIENTATION_MODE.PATH;
    }

    get isGrounded(): boolean {
        return this.grounding === GROUNDING_MODE.GROUND;
    }

    get isLocomotionSynced(): boolean {
        return this.locomotion === LOCOMOTION_MODE.SYNC;
    }

    /**
     * 跨度之外是否钳到首/末帧。
     * false(rest)= 交还实体权威变换,对象在轨道时段外可被 gizmo 自由摆放。
     */
    get holdsOutsideSpan(): boolean {
        return this.extrapolation === EXTRAPOLATION_MODE.HOLD;
    }

    /** 已走弧长 → 动作循环相位(走了几个步幅);纯函数,scrub/倒放同样成立。 */
    stridePhaseAt(arcLengthMeters: number): number {
        return arcLengthMeters / this.strideMeters;
    }

    with(init: TrackPoliciesInit): TrackPolicies {
        return new TrackPolicies({ ...this.toJSON(), ...init });
    }

    toJSON(): Required<TrackPoliciesInit> {
        return {
            orientation: this.orientation,
            grounding: this.grounding,
            locomotion: this.locomotion,
            strideMeters: this.strideMeters,
            extrapolation: this.extrapolation,
        };
    }
}
