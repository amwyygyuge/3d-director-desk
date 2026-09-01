import { DEFAULT_ACTOR_COLOR_HEX } from "@/actor/ActorAppearance";

export interface ActorPaletteSwatch {
    readonly id: string;
    readonly labelZh: string;
    readonly hex: string;
}

/**
 * 人偶语义色板:UI 色块与 AI 色名共读同一张表——用户看到的标签就是能对模型说的词。
 * 自定义取色器仍可给任意 #RRGGBB,色板只保证常用色一击到底。
 */
export const ACTOR_PALETTE: readonly ActorPaletteSwatch[] = [
    { id: "plaster", labelZh: "石膏白", hex: DEFAULT_ACTOR_COLOR_HEX },
    { id: "clay", labelZh: "黏土", hex: "#c8a48a" },
    { id: "charcoal", labelZh: "炭灰", hex: "#4a4a4f" },
    { id: "coral", labelZh: "珊瑚", hex: "#e2725b" },
    { id: "indigo", labelZh: "靛蓝", hex: "#4a6fa5" },
    { id: "moss", labelZh: "苔绿", hex: "#6f8f5f" },
    { id: "ochre", labelZh: "赭石", hex: "#b0703c" },
    { id: "haze", labelZh: "雾紫", hex: "#8f7fa8" },
    { id: "brick", labelZh: "砖红", hex: "#a5453a" },
    { id: "moon", labelZh: "月白", hex: "#cfd6dd" },
];

const HEX_BY_ID = new Map(ACTOR_PALETTE.map((swatch) => [swatch.id, swatch.hex]));

export function paletteHexFor(swatchId: string): string | null {
    return HEX_BY_ID.get(swatchId) ?? null;
}
