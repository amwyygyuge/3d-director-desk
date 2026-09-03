import { finiteVec3 } from "@/core/SceneObject";
import type { Vec3 } from "@/core/SceneObject";
import { isFollowFrame } from "@/motion/SubjectFrameResolver";
import type { FollowFrame, SubjectFrameRequest } from "@/motion/SubjectFrameResolver";

/** 数值围栏(空间幻觉围栏):UI 滑杆与命令校验共用同一组常量,禁两处各写 */
export const FOLLOW_LAG_MIN_SECONDS = -0.5;
export const FOLLOW_LAG_MAX_SECONDS = 2;
export const FOLLOW_SMOOTHING_MIN_SECONDS = 0;
export const FOLLOW_SMOOTHING_MAX_SECONDS = 2;
/** 锚点是主体身上的一个点,不是另一个位置 */
export const FOLLOW_ANCHOR_LIMIT_METERS = 10;

/**
 * 跟拍站位语汇(AI 面):LLM 说「站他身后」,不发世界坐标。
 *
 * 两条几何前提必须一起读:
 * 1) 主体正面 = −Z(PATH 朝向 atan2(-tx,-tz) 的反解),由 forward=(0,0,−1)、up=(0,1,0) 叉乘得右手侧 = +X;
 * 2) 方位角沿用 ShotSizePresets.resolve 的约定:position = center + (cos a, ·, sin a) × 水平距离。
 */
export const FOLLOW_APPROACH = {
    BACK: "back",
    FRONT: "front",
    LEFT: "left",
    RIGHT: "right",
} as const;
export type FollowApproach = (typeof FOLLOW_APPROACH)[keyof typeof FOLLOW_APPROACH];

export const FOLLOW_APPROACH_AZIMUTH: Record<FollowApproach, number> = {
    [FOLLOW_APPROACH.BACK]: Math.PI / 2,
    [FOLLOW_APPROACH.FRONT]: -Math.PI / 2,
    [FOLLOW_APPROACH.LEFT]: Math.PI,
    [FOLLOW_APPROACH.RIGHT]: 0,
};

export function isFollowApproach(value: unknown): value is FollowApproach {
    return typeof value === "string" && Object.hasOwn(FOLLOW_APPROACH_AZIMUTH, value);
}

export interface CameraFollowTrackJSON {
    readonly objectId: string;
    /** 跟随系内的锚点偏移(随主体转身);默认取主体包围盒中心的高度 */
    readonly anchorOffset: Vec3;
    readonly frame: FollowFrame;
    /** 正数=镜头慢半拍,负数=预判先行 */
    readonly lagSeconds: number;
    /** 平滑窗口宽度;抑制脚步抖动与转身闪跳 */
    readonly smoothingSeconds: number;
}

function isWithinAnchorLimit(anchorOffset: Vec3): boolean {
    return (
        Math.abs(anchorOffset[0]) <= FOLLOW_ANCHOR_LIMIT_METERS &&
        Math.abs(anchorOffset[1]) <= FOLLOW_ANCHOR_LIMIT_METERS &&
        Math.abs(anchorOffset[2]) <= FOLLOW_ANCHOR_LIMIT_METERS
    );
}

/**
 * 跟拍覆盖层(值对象,不可变):与注视覆盖层 CameraFocusTrack 并列。
 *
 * 非空时,该片段的**全部关键帧改在主体跟随系里解释**——主体在原点、正面 −Z。
 * 注视决定「看哪」,跟拍决定「站哪」;两者互不吞并。
 *
 * 关键帧不带空间标志位:片段级 follow 是否为空,唯一决定整段关键帧的坐标空间。
 */
export class CameraFollowTrack implements SubjectFrameRequest {
    readonly objectId: string;
    readonly anchorOffset: Vec3;
    readonly frame: FollowFrame;
    readonly lagSeconds: number;
    readonly smoothingSeconds: number;

    constructor(init: CameraFollowTrackJSON) {
        if (
            init.objectId.length === 0 ||
            !finiteVec3(init.anchorOffset) ||
            !isWithinAnchorLimit(init.anchorOffset) ||
            !isFollowFrame(init.frame) ||
            !Number.isFinite(init.lagSeconds) ||
            init.lagSeconds < FOLLOW_LAG_MIN_SECONDS ||
            init.lagSeconds > FOLLOW_LAG_MAX_SECONDS ||
            !Number.isFinite(init.smoothingSeconds) ||
            init.smoothingSeconds < FOLLOW_SMOOTHING_MIN_SECONDS ||
            init.smoothingSeconds > FOLLOW_SMOOTHING_MAX_SECONDS
        ) {
            throw new Error("CameraFollowTrack requires an existing subject, a known frame and in-range timing");
        }
        this.objectId = init.objectId;
        this.anchorOffset = [init.anchorOffset[0], init.anchorOffset[1], init.anchorOffset[2]];
        this.frame = init.frame;
        this.lagSeconds = init.lagSeconds;
        this.smoothingSeconds = init.smoothingSeconds;
        Object.freeze(this);
    }

    toJSON(): CameraFollowTrackJSON {
        return {
            objectId: this.objectId,
            anchorOffset: [this.anchorOffset[0], this.anchorOffset[1], this.anchorOffset[2]],
            frame: this.frame,
            lagSeconds: this.lagSeconds,
            smoothingSeconds: this.smoothingSeconds,
        };
    }
}

export function cameraFollowTrackFrom(value: CameraFollowTrack | CameraFollowTrackJSON): CameraFollowTrack {
    return value instanceof CameraFollowTrack ? value : new CameraFollowTrack(value);
}
