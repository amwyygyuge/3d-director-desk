import type { ColorSwatch } from "@/core/ColorSwatch";

/**
 * 灯光语义色板:按**色温与光源身份**给点,不给彩虹。
 *
 * 灯不是涂料——作者要的是「日光/钨丝灯/月光」这类可名状的光源,而不是任意色相。
 * 因此这张表沿 3200K~7500K 的色温轴排布(暖 → 中性 → 冷),外加两枚戏剧化的实用光
 * (霓虹青/落日橙),那是布光里真会用到的强色相,不是色板凑数。
 *
 * 取值与 `LIGHTING_MOOD_PRESETS` 的灯色同源:情绪配方里出现过的色(#fff4e2 钨丝、
 * #ffb35c 落日、#9fc6ff 月光、#dce8ff 阴天补光)在这里各占一枚,
 * 作者手调单灯时能对上 AI 一步布光的结果,两条路径不给出互相陌生的颜色。
 */
export const LIGHT_COLOR_PALETTE: readonly ColorSwatch[] = [
    { id: "white", labelZh: "纯白", hex: "#ffffff" },
    { id: "tungsten", labelZh: "钨丝灯", hex: "#fff4e2" },
    { id: "candle", labelZh: "烛光", hex: "#ffd9a0" },
    { id: "sunset", labelZh: "落日", hex: "#ffb35c" },
    { id: "practical-warm", labelZh: "暖实用光", hex: "#ff8f5a" },
    { id: "daylight", labelZh: "日光", hex: "#f5f7ff" },
    { id: "overcast", labelZh: "阴天", hex: "#dce8ff" },
    { id: "moonlight", labelZh: "月光", hex: "#9fc6ff" },
    { id: "shade", labelZh: "冷阴影", hex: "#8ea6c8" },
    { id: "neon-cyan", labelZh: "霓虹青", hex: "#5ad7e0" },
];
