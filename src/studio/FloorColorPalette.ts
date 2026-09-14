import type { ColorSwatch } from "@/core/ColorSwatch";
import { FLOOR_COLOR_DEFAULT } from "@/studio/StudioEnvironment";

/**
 * 地板语义色板:按**影调**排布,不按装饰色。
 *
 * 地板是画面里面积最大的一块,它的明度直接决定人物反差与整体影调(见 `StudioEnvironment`
 * 的地板颜色合法域注释),所以这张表沿明度轴给点——从吸光的摄影棚黑纸,到反光的高调白台面,
 * 中间留出中性灰(测光基准)与两级过渡。
 *
 * 末三枚是带色偏的实拍地面(木地板、水泥、青苔),它们会把色偏反弹到人物暗部——
 * 那是有效的布光手段,不是贴图审美,故与影调档并列而非另开一栏。
 */
export const FLOOR_COLOR_PALETTE: readonly ColorSwatch[] = [
    { id: "seamless-black", labelZh: "吸光黑", hex: "#0d0d0f" },
    { id: "studio-dark", labelZh: "棚内深灰", hex: FLOOR_COLOR_DEFAULT },
    { id: "neutral-gray", labelZh: "中性灰", hex: "#808080" },
    { id: "light-gray", labelZh: "浅灰", hex: "#b8b8bc" },
    { id: "high-key-white", labelZh: "高调白", hex: "#ecece8" },
    { id: "warm-wood", labelZh: "木地板", hex: "#8a6a49" },
    { id: "concrete", labelZh: "水泥", hex: "#6f7073" },
    { id: "moss-floor", labelZh: "青苔", hex: "#4f5f4a" },
];
