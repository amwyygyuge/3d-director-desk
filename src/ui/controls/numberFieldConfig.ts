/** 数值语义档位:步长随字段语义走,禁止调用方散落魔术数字 */
export const SCRUB_STEP = {
    position: 0.1,
    rotationDeg: 1,
    scale: 0.1,
    timeSeconds: 0.1,
    angleDeg: 1,
    intensity: 0.1,
    distanceMeters: 0.1,
    decay: 0.1,
    ratio: 0.05,
    /** 焦距(毫米):1mm 是摄影上可辨识的最小档,0.1 只会让刮擦变钝 */
    focalLengthMm: 1,
    /** 光圈 f 值:0.1 约等于三分之一档,比整档细、够作者试深浅 */
    apertureFStop: 0.1,
} as const;
export type ScrubKind = keyof typeof SCRUB_STEP;

/** 草稿提交失败原因:调用方据此给文案,控件本身不碰 stores(叶子控件纪律) */
export const INVALID_REASON = {
    NOT_A_NUMBER: "not-a-number",
    OUT_OF_RANGE: "out-of-range",
} as const;
export type InvalidReason = (typeof INVALID_REASON)[keyof typeof INVALID_REASON];
