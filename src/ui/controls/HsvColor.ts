/**
 * 取色面板的颜色模型:HSV 不可变值对象。
 *
 * 面板的两个控件(饱和度/明度平面、色相条)是 HSV 的直接投影,而领域侧一律只认 `#rrggbb`。
 * 中间必须有一个持有色相的载体:hex 在 s=0(纯灰)与 v=0(纯黑)时**丢掉色相**,
 * 若每帧都往 hex 折返再解析,拖到灰或黑的一刻色相会被重置成红,色相条随之跳回起点。
 * 因此一次取色会话期间以 HsvColor 为真相源,只在提交与着色时求值成 hex。
 */

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;
const HUE_TURN = 360;
const HUE_SECTOR = 60;
const RGB_MAX = 255;
const HEX_RADIX = 16;
const HEX_PAIR_WIDTH = 2;

function clampUnit(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

/** 色相是角度:越界回卷而非截断,拖过 360° 从 0° 接着走 */
function wrapHue(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return ((value % HUE_TURN) + HUE_TURN) % HUE_TURN;
}

function channelToHex(channel: number): string {
    return Math.round(clampUnit(channel) * RGB_MAX)
        .toString(HEX_RADIX)
        .padStart(HEX_PAIR_WIDTH, "0");
}

/** 值对象:不可变、可与 `#rrggbb` 双向求值;非法 hex 在 `fromHex` 处终止(回退黑色而非抛错,面板不因手输半截 hex 崩) */
export class HsvColor {
    static isHex(value: unknown): value is string {
        return typeof value === "string" && HEX_PATTERN.test(value);
    }

    static of(hue: number, saturation: number, value: number): HsvColor {
        return new HsvColor(wrapHue(hue), clampUnit(saturation), clampUnit(value));
    }

    static fromHex(hex: string): HsvColor {
        if (!HsvColor.isHex(hex)) return HsvColor.of(0, 0, 0);
        const int = Number.parseInt(hex.slice(1), HEX_RADIX);
        const red = ((int >> 16) & RGB_MAX) / RGB_MAX;
        const green = ((int >> 8) & RGB_MAX) / RGB_MAX;
        const blue = (int & RGB_MAX) / RGB_MAX;
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);
        const span = max - min;
        const hue =
            span === 0
                ? 0
                : max === red
                  ? HUE_SECTOR * (((green - blue) / span) % 6)
                  : max === green
                    ? HUE_SECTOR * ((blue - red) / span + 2)
                    : HUE_SECTOR * ((red - green) / span + 4);
        return HsvColor.of(hue, max === 0 ? 0 : span / max, max);
    }

    private constructor(
        readonly hue: number,
        readonly saturation: number,
        readonly value: number,
    ) {
        Object.freeze(this);
    }

    withHue(hue: number): HsvColor {
        return HsvColor.of(hue, this.saturation, this.value);
    }

    withSaturationValue(saturation: number, value: number): HsvColor {
        return HsvColor.of(this.hue, saturation, value);
    }

    get hex(): string {
        const sector = this.hue / HUE_SECTOR;
        const chroma = this.value * this.saturation;
        const second = chroma * (1 - Math.abs((sector % 2) - 1));
        const base = this.value - chroma;
        const [red, green, blue] =
            sector < 1
                ? [chroma, second, 0]
                : sector < 2
                  ? [second, chroma, 0]
                  : sector < 3
                    ? [0, chroma, second]
                    : sector < 4
                      ? [0, second, chroma]
                      : sector < 5
                        ? [second, 0, chroma]
                        : [chroma, 0, second];
        return `#${channelToHex(red + base)}${channelToHex(green + base)}${channelToHex(blue + base)}`;
    }

    /** 当前色相的满饱和满明度色:饱和度/明度平面的底色,与两道渐变叠出整块色域 */
    get hueHex(): string {
        return HsvColor.of(this.hue, 1, 1).hex;
    }

    equalsHex(hex: string): boolean {
        return HsvColor.isHex(hex) && this.hex === hex.toLowerCase();
    }
}
