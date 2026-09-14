import type { LightParams } from "@/core/LightParams";
import type { Vec3 } from "@/core/SceneObject";

/**
 * 打光情绪:语义 → 灯组的命名点。
 *
 * 与 `MotionPresetCompiler` / `BuildPresetCompiler` 同构——LLM 只给情绪名,数值由本表产出,
 * 越界仍由 `light.adjust` 的围栏兜底。它解决的是「LLM 不擅长数值、擅长语义」这件事:
 * 「低调」「逆光剪影」「黄金时刻」是导演语言,而 `intensity: 3.2 / color: "#ffd9a0"` 不是。
 */
export const LIGHTING_MOOD = {
    /** 明亮均匀,阴影浅——说明性画面、产品展示 */
    NEUTRAL: "neutral",
    /** 强主光 + 极弱补光,大面积暗部——悬疑、审讯、夜戏 */
    LOW_KEY: "low-key",
    /** 主光压到极低、背光极强,主体近乎全黑——剪影、悬念登场 */
    SILHOUETTE: "silhouette",
    /** 低角度暖光 + 长影——日出日落时分 */
    GOLDEN_HOUR: "golden-hour",
    /** 冷调高对比 + 硬边——夜间外景、霓虹、科技感 */
    NIGHT: "night",
} as const;
export type LightingMood = (typeof LIGHTING_MOOD)[keyof typeof LIGHTING_MOOD];

export function isLightingMood(value: unknown): value is LightingMood {
    return typeof value === "string" && Object.values(LIGHTING_MOOD).includes(value as LightingMood);
}

/**
 * 灯位声明:相对被摄体的**方位倍率**,不是世界坐标。
 *
 * 用倍率而非绝对坐标,是为了让同一套情绪适配任意尺度的被摄体——
 * 人偶与建筑的合理灯距差一个量级,写死坐标会让其中一方的灯落在体内或远到无效。
 * 编译期乘以被摄体包围球半径得到世界位置(与 `ShotSizePresets` 按半径定距同一思路)。
 */
export interface MoodLightPlacement {
    /** 灯位相对被摄体中心的方向与距离倍率(单位:包围球半径) */
    readonly offsetRadii: Vec3;
    readonly light: LightParams;
    /** 角色标签(key/fill/rim/practical),供 UI 与 AI 理解该灯的职能 */
    readonly role: string;
}

export interface LightingMoodPreset {
    readonly id: LightingMood;
    readonly labelZh: string;
    /** 该情绪建议的曝光倍率;与灯组一起交付才能得到预期影调 */
    readonly exposure: number;
    /** 该情绪是否需要接地投影(硬光情绪需要,柔和高调可不要) */
    readonly shadowsEnabled: boolean;
    readonly lights: readonly MoodLightPlacement[];
}

/**
 * 情绪 → 灯组配方表。
 *
 * 每条配方都是「主光 + 补光 + 背光」的三点布光变体,差异在强度比、色温与方位:
 * 影调是由**比例**决定的,不是由绝对亮度决定——低调的关键是主光/补光比大(此处约 12:1),
 * 而不是把所有灯调暗(那只会得到一张欠曝的平光图)。
 */
export const LIGHTING_MOOD_PRESETS: readonly LightingMoodPreset[] = [
    {
        id: LIGHTING_MOOD.NEUTRAL,
        labelZh: "中性均匀",
        exposure: 1,
        shadowsEnabled: true,
        lights: [
            { role: "key", offsetRadii: [2.2, 2.6, 2.2], light: { type: "directional", color: "#ffffff", intensity: 2.2 } },
            { role: "fill", offsetRadii: [-2.4, 1.2, 2.0], light: { type: "directional", color: "#dce8ff", intensity: 1.1 } },
            { role: "rim", offsetRadii: [0, 2.2, -2.8], light: { type: "directional", color: "#fff2e0", intensity: 1.2 } },
        ],
    },
    {
        id: LIGHTING_MOOD.LOW_KEY,
        labelZh: "低调(暗部为主)",
        exposure: 1.15,
        shadowsEnabled: true,
        lights: [
            { role: "key", offsetRadii: [2.0, 2.4, 1.4], light: { type: "spot", color: "#fff4e2", intensity: 42, distance: 0, decay: 1.4, angleDegrees: 34, penumbra: 0.5 } },
            { role: "fill", offsetRadii: [-2.6, 0.9, 1.8], light: { type: "directional", color: "#8ea6c8", intensity: 0.18 } },
            { role: "rim", offsetRadii: [-1.2, 2.0, -2.6], light: { type: "directional", color: "#cfe0ff", intensity: 0.9 } },
        ],
    },
    {
        id: LIGHTING_MOOD.SILHOUETTE,
        labelZh: "逆光剪影",
        exposure: 1,
        shadowsEnabled: false,
        lights: [
            { role: "key", offsetRadii: [1.6, 1.4, 2.4], light: { type: "directional", color: "#ffffff", intensity: 0.12 } },
            { role: "rim", offsetRadii: [0, 1.6, -3.0], light: { type: "spot", color: "#ffffff", intensity: 90, distance: 0, decay: 1, angleDegrees: 48, penumbra: 0.25 } },
            { role: "fill", offsetRadii: [-1.8, 1.0, 1.6], light: { type: "directional", color: "#7f90a8", intensity: 0.1 } },
        ],
    },
    {
        id: LIGHTING_MOOD.GOLDEN_HOUR,
        labelZh: "黄金时刻",
        exposure: 1.2,
        shadowsEnabled: true,
        lights: [
            { role: "key", offsetRadii: [3.0, 0.7, 1.6], light: { type: "directional", color: "#ffb35c", intensity: 2.6 } },
            { role: "fill", offsetRadii: [-2.2, 1.4, 1.8], light: { type: "directional", color: "#9dc4ff", intensity: 0.5 } },
            { role: "rim", offsetRadii: [-1.0, 1.2, -2.6], light: { type: "directional", color: "#ffd9a0", intensity: 1.4 } },
        ],
    },
    {
        id: LIGHTING_MOOD.NIGHT,
        labelZh: "夜景冷调",
        exposure: 1.25,
        shadowsEnabled: true,
        lights: [
            { role: "key", offsetRadii: [2.0, 2.8, 1.2], light: { type: "directional", color: "#9fc6ff", intensity: 1.6 } },
            { role: "fill", offsetRadii: [-2.4, 1.0, 1.6], light: { type: "directional", color: "#5c7196", intensity: 0.22 } },
            { role: "practical", offsetRadii: [-1.6, 1.1, -1.8], light: { type: "point", color: "#ff8f5a", intensity: 26, distance: 0, decay: 1.6 } },
        ],
    },
];

const PRESET_BY_ID = new Map(LIGHTING_MOOD_PRESETS.map((preset) => [preset.id, preset]));

/** 编译后的单盏灯:世界位置已定,可直接交给 `object.place`。 */
export interface CompiledMoodLight {
    readonly id: string;
    readonly role: string;
    readonly position: Vec3;
    readonly light: LightParams;
}

export interface CompiledLightingMood {
    readonly mood: LightingMood;
    readonly exposure: number;
    readonly shadowsEnabled: boolean;
    readonly lights: readonly CompiledMoodLight[];
}

/**
 * 情绪 → 具体灯组(纯函数,不碰 store/Three)。
 *
 * `idPrefix` 让同一情绪可重复应用而不撞 id;半径下限兜住「包围球半径为 0」的退化情形
 * (模型未装载时 `subjectBoundsFor` 会返回半径 0,此时仍应产出可用灯位而不是把灯全堆在中心)。
 */
export class LightingMoodCompiler {
    compile(input: {
        readonly mood: LightingMood;
        readonly center: Vec3;
        readonly radius: number;
        readonly idPrefix: string;
    }): CompiledLightingMood | null {
        const preset = PRESET_BY_ID.get(input.mood);
        if (!preset) return null;
        const radius = Math.max(input.radius, MIN_SUBJECT_RADIUS_METERS);
        return {
            mood: preset.id,
            exposure: preset.exposure,
            shadowsEnabled: preset.shadowsEnabled,
            lights: preset.lights.map((placement) => ({
                id: `${input.idPrefix}-${placement.role}`,
                role: placement.role,
                position: [
                    input.center[0] + placement.offsetRadii[0] * radius,
                    input.center[1] + placement.offsetRadii[1] * radius,
                    input.center[2] + placement.offsetRadii[2] * radius,
                ],
                light: placement.light,
            })),
        };
    }
}

/**
 * 被摄体半径下限(米)。
 * 模型未装载时包围球半径为 0,直接乘倍率会把整组灯堆在被摄体中心——
 * 灯在体内既不照亮也无投影。取人形量级兜底,保证退化情形仍产出可用灯位。
 */
const MIN_SUBJECT_RADIUS_METERS = 0.9;
