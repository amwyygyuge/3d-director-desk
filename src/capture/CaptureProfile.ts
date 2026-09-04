/**
 * 采集呈现档(策略值对象):一次「布景交接」由编排(唯一真相)派生的多产物中,
 * 本档决定「取哪一帧/段、什么着色、是否带 prompt」。设计定位见 docs/ai-control:
 * 成片喂给视频模型,i2v 首帧与 v2v 参考各取导演台的不同侧面,同一编排按档出多产物。
 */

/** 采集范围:i2v 取单帧首图,v2v 取参考片段 */
export const CAPTURE_SCOPE = {
    HERO_FRAME: "hero-frame",
    REFERENCE_CLIP: "reference-clip",
} as const;
export type CaptureScope = (typeof CAPTURE_SCOPE)[keyof typeof CAPTURE_SCOPE];

/** 着色档:neutral 中性(压塑料感,让视频模型接管外观),as-is 保持编辑外观 */
export const CAPTURE_SHADING = {
    NEUTRAL: "neutral",
    AS_IS: "as-is",
} as const;
export type CaptureShading = (typeof CAPTURE_SHADING)[keyof typeof CAPTURE_SHADING];

export interface CaptureProfile {
    readonly id: CaptureProfileId;
    readonly scope: CaptureScope;
    readonly shading: CaptureShading;
    /** 是否把合成文本条件一并封进产物(i2v/v2v 都吃文本) */
    readonly includePrompt: boolean;
}

export const CAPTURE_PROFILE = {
    I2V_HERO: "i2v-hero",
    V2V_CLIP: "v2v-clip",
} as const;
export type CaptureProfileId = (typeof CAPTURE_PROFILE)[keyof typeof CAPTURE_PROFILE];

/** 内置呈现档注册表(静态查表,禁 if 链;宿主扩展档留待有动态注册需求再引入注册表类) */
const CAPTURE_PROFILES: Record<CaptureProfileId, CaptureProfile> = {
    [CAPTURE_PROFILE.I2V_HERO]: {
        id: CAPTURE_PROFILE.I2V_HERO,
        scope: CAPTURE_SCOPE.HERO_FRAME,
        shading: CAPTURE_SHADING.NEUTRAL,
        includePrompt: true,
    },
    [CAPTURE_PROFILE.V2V_CLIP]: {
        id: CAPTURE_PROFILE.V2V_CLIP,
        scope: CAPTURE_SCOPE.REFERENCE_CLIP,
        shading: CAPTURE_SHADING.NEUTRAL,
        includePrompt: true,
    },
};

export function isCaptureProfileId(value: unknown): value is CaptureProfileId {
    return typeof value === "string" && Object.hasOwn(CAPTURE_PROFILES, value);
}

/** 取呈现档;未知 id 由命令层 validate 先拦(幻觉围栏),此处调用点已保证合法 */
export function captureProfile(id: CaptureProfileId): CaptureProfile {
    return CAPTURE_PROFILES[id];
}

export const CAPTURE_PROFILE_IDS: readonly CaptureProfileId[] = Object.keys(CAPTURE_PROFILES) as CaptureProfileId[];
