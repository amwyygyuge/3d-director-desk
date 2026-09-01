/**
 * 人偶表面质感:二选一而非裸 PBR 数值。
 *
 * 内置人形的 glTF 材质是规范默认值(metallic=1.0 / roughness=1.0),而演播室灯组没有环境贴图——
 * 全金属工作流下 albedo 不参与漫反射,只改 color 在画面上几乎不动。质感档位负责把 metalness 压到
 * 非金属区间,颜色才可见;渲染细节不泄漏给用户,也不进 AI 词表。
 */
export const ACTOR_SURFACE = {
    MATTE: "matte",
    SHEEN: "sheen",
} as const;
export type ActorSurface = (typeof ACTOR_SURFACE)[keyof typeof ACTOR_SURFACE];

export interface ActorSurfaceParams {
    readonly metalness: number;
    readonly roughness: number;
}

export const ACTOR_SURFACE_PARAMS: Record<ActorSurface, ActorSurfaceParams> = {
    [ACTOR_SURFACE.MATTE]: { metalness: 0, roughness: 0.85 },
    [ACTOR_SURFACE.SHEEN]: { metalness: 0.15, roughness: 0.4 },
};

export const ACTOR_SURFACE_LABEL_ZH: Record<ActorSurface, string> = {
    [ACTOR_SURFACE.MATTE]: "哑光",
    [ACTOR_SURFACE.SHEEN]: "微光",
};

const SURFACES: readonly string[] = Object.values(ACTOR_SURFACE);

export function isActorSurface(value: unknown): value is ActorSurface {
    return typeof value === "string" && SURFACES.includes(value);
}

const COLOR_HEX_PATTERN = /^#[0-9a-f]{6}$/i;

export function isColorHex(value: unknown): value is string {
    return typeof value === "string" && COLOR_HEX_PATTERN.test(value);
}

export const DEFAULT_ACTOR_COLOR_HEX = "#d8d3ca";
export const DEFAULT_ACTOR_SURFACE: ActorSurface = ACTOR_SURFACE.MATTE;

export interface ActorAppearanceInit {
    readonly baseColorHex?: string;
    readonly surface?: ActorSurface;
}

/** 人偶外观值对象:颜色与质感,不可变、可 JSON 往返;非法输入在此终止(最后一道围栏)。 */
export class ActorAppearance {
    readonly baseColorHex: string;
    readonly surface: ActorSurface;

    constructor(init: ActorAppearanceInit = {}) {
        const hex = init.baseColorHex ?? DEFAULT_ACTOR_COLOR_HEX;
        if (!isColorHex(hex)) throw new Error(`ActorAppearance: 颜色必须是 #RRGGBB,收到 ${String(hex)}`);
        const surface = init.surface ?? DEFAULT_ACTOR_SURFACE;
        if (!isActorSurface(surface)) throw new Error(`ActorAppearance: 未知质感 ${String(surface)}`);
        this.baseColorHex = hex.toLowerCase();
        this.surface = surface;
        Object.freeze(this);
    }

    get surfaceParams(): ActorSurfaceParams {
        return ACTOR_SURFACE_PARAMS[this.surface];
    }

    withColor(baseColorHex: string): ActorAppearance {
        return new ActorAppearance({ baseColorHex, surface: this.surface });
    }

    withSurface(surface: ActorSurface): ActorAppearance {
        return new ActorAppearance({ baseColorHex: this.baseColorHex, surface });
    }

    equals(other: ActorAppearance): boolean {
        return this.baseColorHex === other.baseColorHex && this.surface === other.surface;
    }

    toJSON(): Required<ActorAppearanceInit> {
        return { baseColorHex: this.baseColorHex, surface: this.surface };
    }
}
