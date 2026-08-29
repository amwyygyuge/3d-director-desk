/**
 * 灯光值对象：只承载可序列化的编辑参数，永不保存 Three 运行时引用。
 * 颜色在边界归一为小写 #rrggbb；强度限制在可预测的编辑域内。
 */
export const LIGHT_TYPES = ["directional", "point", "spot"] as const;
export type LightType = (typeof LIGHT_TYPES)[number];

export interface LightParams {
    readonly type: LightType;
    readonly color: string;
    readonly intensity: number;
}

export const LIGHT_INTENSITY_MIN = 0;
export const LIGHT_INTENSITY_MAX = 100;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isLightType(value: unknown): value is LightType {
    return typeof value === "string" && (LIGHT_TYPES as readonly string[]).includes(value);
}

export function isLightColor(value: unknown): value is string {
    return typeof value === "string" && HEX_COLOR.test(value);
}

export function isLightIntensity(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= LIGHT_INTENSITY_MIN &&
        value <= LIGHT_INTENSITY_MAX
    );
}

/** 建构时复制并冻结，防止调用方保留可变 payload 破坏实体不变量。 */
export function normalizeLightParams(value: LightParams): LightParams {
    if (!isLightType(value.type) || !isLightColor(value.color) || !isLightIntensity(value.intensity)) {
        throw new Error("LightParams invalid");
    }
    return Object.freeze({ type: value.type, color: value.color.toLowerCase(), intensity: value.intensity });
}

export function createDefaultLightParams(type: LightType): LightParams {
    return normalizeLightParams({
        type,
        color: "#ffffff",
        intensity: type === "directional" ? 1.5 : 30,
    });
}
