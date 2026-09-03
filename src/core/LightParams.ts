/**
 * 灯光值对象：只承载可序列化编辑参数，永不保存 Three 运行时引用。
 * 每种灯型只暴露其物理含义明确的参数；构造时归一和冻结以保护实体不变量。
 */
export const LIGHT_TYPES = ["directional", "point", "spot"] as const;
export type LightType = (typeof LIGHT_TYPES)[number];

interface BaseLightParams {
    readonly color: string;
    readonly intensity: number;
}

export interface DirectionalLightParams extends BaseLightParams {
    readonly type: "directional";
}

export interface PointLightParams extends BaseLightParams {
    readonly type: "point";
    /** 作用距离(米);0 表示不截断。 */
    readonly distance: number;
    /** 距离衰减指数。 */
    readonly decay: number;
}

export interface SpotLightParams extends BaseLightParams {
    readonly type: "spot";
    /** 作用距离(米);0 表示不截断。 */
    readonly distance: number;
    /** 距离衰减指数。 */
    readonly decay: number;
    /** 光锥半角(度)。 */
    readonly angleDegrees: number;
    /** 边缘软化比例。 */
    readonly penumbra: number;
}

export type LightParams = DirectionalLightParams | PointLightParams | SpotLightParams;

export const LIGHT_INTENSITY_MIN = 0;
export const LIGHT_INTENSITY_MAX = 100;
export const LIGHT_DISTANCE_MIN_METERS = 0;
export const LIGHT_DISTANCE_MAX_METERS = 100;
export const LIGHT_DECAY_MIN = 0;
export const LIGHT_DECAY_MAX = 4;
export const LIGHT_SPOT_ANGLE_MIN_DEGREES = 1;
export const LIGHT_SPOT_ANGLE_MAX_DEGREES = 90;
export const LIGHT_PENUMBRA_MIN = 0;
export const LIGHT_PENUMBRA_MAX = 1;

const DEFAULT_LIGHT_COLOR = "#ffffff";
const DEFAULT_DIRECTIONAL_INTENSITY = 1.5;
const DEFAULT_LOCAL_LIGHT_INTENSITY = 30;
const DEFAULT_LOCAL_LIGHT_DISTANCE_METERS = 10;
const DEFAULT_LIGHT_DECAY = 2;
const DEFAULT_SPOT_ANGLE_DEGREES = 30;
const DEFAULT_SPOT_PENUMBRA = 0.35;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isLightType(value: unknown): value is LightType {
    return typeof value === "string" && (LIGHT_TYPES as readonly string[]).includes(value);
}

export function isLightColor(value: unknown): value is string {
    return typeof value === "string" && HEX_COLOR.test(value);
}

export function isLightIntensity(value: unknown): value is number {
    return isFiniteInRange(value, LIGHT_INTENSITY_MIN, LIGHT_INTENSITY_MAX);
}

export function isLightDistance(value: unknown): value is number {
    return isFiniteInRange(value, LIGHT_DISTANCE_MIN_METERS, LIGHT_DISTANCE_MAX_METERS);
}

export function isLightDecay(value: unknown): value is number {
    return isFiniteInRange(value, LIGHT_DECAY_MIN, LIGHT_DECAY_MAX);
}

export function isSpotAngleDegrees(value: unknown): value is number {
    return isFiniteInRange(value, LIGHT_SPOT_ANGLE_MIN_DEGREES, LIGHT_SPOT_ANGLE_MAX_DEGREES);
}

export function isLightPenumbra(value: unknown): value is number {
    return isFiniteInRange(value, LIGHT_PENUMBRA_MIN, LIGHT_PENUMBRA_MAX);
}

export function isLightParams(value: unknown): value is LightParams {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value as {
        readonly type?: unknown;
        readonly color?: unknown;
        readonly intensity?: unknown;
        readonly distance?: unknown;
        readonly decay?: unknown;
        readonly angleDegrees?: unknown;
        readonly penumbra?: unknown;
    };
    if (!isLightType(candidate.type) || !isLightColor(candidate.color) || !isLightIntensity(candidate.intensity)) {
        return false;
    }
    switch (candidate.type) {
        case "directional":
            return true;
        case "point":
            return isLightDistance(candidate.distance) && isLightDecay(candidate.decay);
        case "spot":
            return (
                isLightDistance(candidate.distance) &&
                isLightDecay(candidate.decay) &&
                isSpotAngleDegrees(candidate.angleDegrees) &&
                isLightPenumbra(candidate.penumbra)
            );
    }
}

/** 建构时复制并冻结，防止调用方保留可变 payload 破坏实体不变量。 */
export function normalizeLightParams(value: LightParams): LightParams {
    if (!isLightParams(value)) throw new Error("LightParams invalid");
    const base = { color: value.color.toLowerCase(), intensity: value.intensity };
    switch (value.type) {
        case "directional":
            return Object.freeze({ type: value.type, ...base });
        case "point":
            return Object.freeze({ type: value.type, ...base, distance: value.distance, decay: value.decay });
        case "spot":
            return Object.freeze({
                type: value.type,
                ...base,
                distance: value.distance,
                decay: value.decay,
                angleDegrees: value.angleDegrees,
                penumbra: value.penumbra,
            });
    }
}

export function createDefaultLightParams(type: LightType): LightParams {
    switch (type) {
        case "directional":
            return normalizeLightParams({ type, color: DEFAULT_LIGHT_COLOR, intensity: DEFAULT_DIRECTIONAL_INTENSITY });
        case "point":
            return normalizeLightParams({
                type,
                color: DEFAULT_LIGHT_COLOR,
                intensity: DEFAULT_LOCAL_LIGHT_INTENSITY,
                distance: DEFAULT_LOCAL_LIGHT_DISTANCE_METERS,
                decay: DEFAULT_LIGHT_DECAY,
            });
        case "spot":
            return normalizeLightParams({
                type,
                color: DEFAULT_LIGHT_COLOR,
                intensity: DEFAULT_LOCAL_LIGHT_INTENSITY,
                distance: DEFAULT_LOCAL_LIGHT_DISTANCE_METERS,
                decay: DEFAULT_LIGHT_DECAY,
                angleDegrees: DEFAULT_SPOT_ANGLE_DEGREES,
                penumbra: DEFAULT_SPOT_PENUMBRA,
            });
    }
}

/** 切换灯型时只保留跨灯型语义一致的颜色和强度，专属参数回到新灯型默认值。 */
export function retypeLightParams(light: LightParams, type: LightType): LightParams {
    const defaults = createDefaultLightParams(type);
    return normalizeLightParams({ ...defaults, color: light.color, intensity: light.intensity });
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}
