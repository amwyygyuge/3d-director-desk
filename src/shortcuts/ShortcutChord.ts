/**
 * 快捷键和弦值对象:声明式 spec("mod+shift+k")→ 结构化修饰键 + 主键。
 * - mod 是跨平台抽象:Mac 映射 ⌘(metaKey),Windows/Linux 映射 Ctrl(ctrlKey);
 * - format() 平台感知:Mac 用符号无分隔(⌘W),其他平台用文字加号(Ctrl+W)。
 */

const IS_MAC: boolean = (() => {
    if (typeof navigator === "undefined") return false;
    // 注意:部分环境(无头/旧内核)userAgentData.platform 是空字符串而非 undefined,须用 || 回退
    const platform =
        (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";
    return /mac/i.test(platform);
})();

const MODIFIER_LABELS: Record<"mod" | "shift" | "alt", string> = IS_MAC
    ? { mod: "⌘", shift: "⇧", alt: "⌥" }
    : { mod: "Ctrl", shift: "Shift", alt: "Alt" };

/** 特殊主键的平台化显示;单字符键统一大写 */
const KEY_LABELS: Record<string, string> = IS_MAC
    ? { delete: "⌫", backspace: "⌫", escape: "Esc", space: "Space", enter: "↩" }
    : { delete: "Del", backspace: "⌫", escape: "Esc", space: "Space", enter: "Enter" };

/** Shift 上档符号 → 主键位(event.key 给的是上档字符,规范到底层键,让 spec 写 "shift+/") */
const SHIFT_SYMBOL_ALIASES: Record<string, string> = { "?": "/" };

/** KeyboardEvent.key → 规范化主键名(小写;空格归一为 space;上档符号归一到底层键) */
function normalizeKey(key: string): string {
    const lower = key.toLowerCase();
    if (lower === " ") return "space";
    return SHIFT_SYMBOL_ALIASES[lower] ?? lower;
}

export class ShortcutChord {
    private constructor(
        readonly key: string,
        readonly mod: boolean,
        readonly shift: boolean,
        readonly alt: boolean,
    ) {}

    static parse(spec: string): ShortcutChord {
        const parts = spec.toLowerCase().split("+");
        const key = normalizeKey(parts.at(-1) ?? spec.toLowerCase());
        const modifiers = new Set(parts.slice(0, -1));
        return new ShortcutChord(key, modifiers.has("mod"), modifiers.has("shift"), modifiers.has("alt"));
    }

    matches(event: KeyboardEvent): boolean {
        if (normalizeKey(event.key) !== this.key) return false;
        const modPressed = IS_MAC ? event.metaKey : event.ctrlKey;
        return modPressed === this.mod && event.shiftKey === this.shift && event.altKey === this.alt;
    }

    format(): string {
        const separator = IS_MAC ? "" : "+";
        return [
            ...(this.mod ? [MODIFIER_LABELS.mod] : []),
            ...(this.shift ? [MODIFIER_LABELS.shift] : []),
            ...(this.alt ? [MODIFIER_LABELS.alt] : []),
            KEY_LABELS[this.key] ?? this.key.toUpperCase(),
        ].join(separator);
    }
}
