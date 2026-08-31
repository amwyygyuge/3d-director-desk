import type { TimelineKeyframe, TimelineTrackKind } from "./TimelineTrack";

/**
 * 关键帧种类编解码器(策略接口):轨道容器只面向本接口,不认识具体关键帧类。
 * 新增关键帧种类 = 实现本接口 + 在装配点注册(registerBuiltinKeyframeCodecs),
 * TimelineTrack/TimelineDoc 零改动。
 */
export interface KeyframeCodec {
    readonly kind: TimelineTrackKind;
    /** 是否本种类的运行时实例(构造幂等:已是实例则原样保留) */
    owns(keyframe: unknown): keyframe is TimelineKeyframe;
    /** 从可序列化 init 构造实例;形状合法性由生产方/命令层校验保证,kind 在此处已被鉴别 */
    fromInit(init: unknown): TimelineKeyframe;
}

/**
 * 代码级注册表:codec 是无状态行为(非实例数据),不占每实例纪律;
 * 唯一装配点在 command/commands.ts 的 registerBuiltinKeyframeCodecs。
 */
const KEYFRAME_CODECS: Partial<Record<TimelineTrackKind, KeyframeCodec>> = {};

/** 幂等注册:多实例导演台重复装配同 kind 时跳过(codec 无状态,重复注册语义相同) */
export function registerKeyframeCodec(codec: KeyframeCodec): void {
    KEYFRAME_CODECS[codec.kind] ??= codec;
}

export function keyframeCodecFor(kind: TimelineTrackKind): KeyframeCodec {
    const codec = KEYFRAME_CODECS[kind];
    if (!codec) throw new Error(`TimelineTrack: unregistered keyframe kind "${kind}"`);
    return codec;
}
