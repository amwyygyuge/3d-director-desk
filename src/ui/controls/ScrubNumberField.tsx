import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import { INVALID_REASON, SCRUB_STEP } from "@/ui/controls/numberFieldConfig";
import type { InvalidReason, ScrubKind } from "@/ui/controls/numberFieldConfig";
import { MONO_FONT_STACK } from "@/ui/shell/theme";

/** 显示精度:尾随零经 Number() 剥掉,只兜浮点噪声 */
const DISPLAY_DECIMALS = 4;
/** 刮擦手感:每 4px 一个步长 */
const PIXELS_PER_STEP = 4;
/** 按下位移小于该值视为点击(聚焦输入框)而非刮擦 */
const CLICK_SLOP_PX = 3;
/** 修饰键倍率:Shift 精调、Alt 粗调,查表替代平铺条件 */
const MODIFIER_RATIO = { fine: 0.1, normal: 1, coarse: 10 } as const;
type ScrubModifier = keyof typeof MODIFIER_RATIO;

export interface ScrubNumberFieldProps {
    /** 轴/单位标签,渲染为可拖拽刮擦的手柄 */
    readonly label: string;
    readonly ariaLabel: string;
    /** 当前值;配合 allowEmpty 可传 null。 */
    readonly value: number | null;
    readonly kind?: ScrubKind;
    readonly min?: number;
    readonly max?: number;
    readonly disabled?: boolean;
    /** 允许清空:草稿为空时提交走 onClear 而非 onCommit。 */
    readonly allowEmpty?: boolean;
    readonly placeholder?: string;
    readonly onCommit: (value: number) => void;
    readonly onClear?: () => void;
    /** 刮擦期实时预览:调用方写 three 运行时 + requestRender,松手才 dispatch(与 gizmo 同模式) */
    readonly onPreview?: (value: number) => void;
    readonly onInvalid?: (reason: InvalidReason) => void;
}

interface ScrubBounds {
    readonly min: number | undefined;
    readonly max: number | undefined;
}

function formatNumber(value: number): string {
    return String(Number(value.toFixed(DISPLAY_DECIMALS)));
}

function parseFinite(text: string): number | null {
    const parsed = Number(text);
    return text.trim() !== "" && Number.isFinite(parsed) ? parsed : null;
}

function clampTo(value: number, bounds: ScrubBounds): number {
    const floor = bounds.min ?? Number.NEGATIVE_INFINITY;
    const ceil = bounds.max ?? Number.POSITIVE_INFINITY;
    return Math.min(ceil, Math.max(floor, value));
}

function modifierOf(event: { shiftKey: boolean; altKey: boolean }): ScrubModifier {
    if (event.shiftKey) return "fine";
    return event.altKey ? "coarse" : "normal";
}

/**
 * 一次刮擦会话:指针捕获期间累计位移 → 值。
 * 状态收进类(取代散落 ref),组件只问 hasMoved/currentValue。
 */
class ScrubSession {
    private totalDeltaPx = 0;
    private lastClientX: number;
    private lastValue: number;

    constructor(
        private readonly startValue: number,
        firstClientX: number,
        private readonly step: number,
        private readonly bounds: ScrubBounds,
    ) {
        this.lastClientX = firstClientX;
        this.lastValue = startValue;
    }

    get hasMoved(): boolean {
        return Math.abs(this.totalDeltaPx) > CLICK_SLOP_PX;
    }

    get currentValue(): number {
        return this.lastValue;
    }

    applyMove(clientX: number, modifier: ScrubModifier): number {
        this.totalDeltaPx += clientX - this.lastClientX;
        this.lastClientX = clientX;
        const steps = (this.totalDeltaPx / PIXELS_PER_STEP) * MODIFIER_RATIO[modifier];
        const next = clampTo(this.startValue + steps * this.step, this.bounds);
        this.lastValue = Number(next.toFixed(DISPLAY_DECIMALS));
        return this.lastValue;
    }
}

/**
 * 检查器唯一数值叶子控件(白名单:无领域身份,收值型 props)。
 * 交互:轴标签拖拽刮擦(Shift/Alt 变速)、↑/↓ 步进、Enter 提交保焦、Escape 放弃草稿、
 * 非法/越界回退并报 onInvalid;非聚焦时显示值永远跟随外部 value,取代 key-remount。
 */
export function ScrubNumberField({
    label,
    ariaLabel,
    value,
    kind = "position",
    min,
    max,
    disabled = false,
    allowEmpty = false,
    placeholder,
    onCommit,
    onClear,
    onPreview,
    onInvalid,
}: ScrubNumberFieldProps) {
    const [draft, setDraft] = useState<string | null>(null);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const sessionRef = useRef<ScrubSession | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const step = SCRUB_STEP[kind];
    const bounds: ScrubBounds = { min, max };

    const commitDraft = () => {
        if (draft === null) return;
        setDraft(null);
        if (allowEmpty && draft.trim() === "") {
            onClear?.();
            return;
        }
        const parsed = parseFinite(draft);
        if (parsed === null) {
            onInvalid?.(INVALID_REASON.NOT_A_NUMBER);
            return;
        }
        if ((min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
            onInvalid?.(INVALID_REASON.OUT_OF_RANGE);
            return;
        }
        if (parsed !== value) onCommit(parsed);
    };

    const stepDraft = (direction: number, modifier: ScrubModifier) => {
        const base = parseFinite(draft ?? "") ?? value ?? 0;
        const next = clampTo(base + direction * step * MODIFIER_RATIO[modifier], bounds);
        setDraft(formatNumber(next));
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        switch (event.key) {
            case "Enter":
                event.preventDefault();
                commitDraft();
                break;
            case "Escape":
                event.preventDefault();
                if (draft === null) inputRef.current?.blur();
                else setDraft(null);
                break;
            case "ArrowUp":
                event.preventDefault();
                stepDraft(1, modifierOf(event));
                break;
            case "ArrowDown":
                event.preventDefault();
                stepDraft(-1, modifierOf(event));
                break;
        }
    };

    const beginScrub = (event: PointerEvent<HTMLElement>) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        sessionRef.current = new ScrubSession(value ?? 0, event.clientX, step, bounds);
        setIsScrubbing(true);
    };

    const moveScrub = (event: PointerEvent<HTMLElement>) => {
        const session = sessionRef.current;
        if (!session) return;
        const next = session.applyMove(event.clientX, modifierOf(event));
        setDraft(formatNumber(next));
        onPreview?.(next);
    };

    const endScrub = () => {
        const session = sessionRef.current;
        sessionRef.current = null;
        setIsScrubbing(false);
        if (!session) return;
        if (!session.hasMoved) {
            setDraft(null);
            inputRef.current?.focus();
            inputRef.current?.select();
            return;
        }
        setDraft(null);
        if (session.currentValue !== value) onCommit(session.currentValue);
    };

    const cancelScrub = () => {
        sessionRef.current = null;
        setIsScrubbing(false);
        setDraft(null);
        if (value !== null) onPreview?.(value);
    };

    return (
        <TextField
            size="small"
            fullWidth
            disabled={disabled}
            inputRef={inputRef}
            placeholder={placeholder}
            value={draft ?? (value === null ? "" : formatNumber(value))}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={handleKeyDown}
            onFocus={(event) => event.target.select()}
            slotProps={{
                input: {
                    startAdornment: (
                        <InputAdornment position="start" sx={{ mr: 0.25 }}>
                            <Box
                                component="span"
                                onPointerDown={beginScrub}
                                onPointerMove={moveScrub}
                                onPointerUp={endScrub}
                                onPointerCancel={cancelScrub}
                                sx={{
                                    cursor: disabled ? "default" : "ew-resize",
                                    touchAction: "none",
                                    userSelect: "none",
                                    fontFamily: MONO_FONT_STACK,
                                    fontSize: 10,
                                    lineHeight: 1,
                                    px: 0.25,
                                    py: 0.25,
                                    borderRadius: 0.5,
                                    color: isScrubbing ? "primary.main" : "text.secondary",
                                    bgcolor: isScrubbing ? "action.selected" : "transparent",
                                    "&:hover": { bgcolor: disabled ? "transparent" : "action.hover" },
                                }}
                            >
                                {label}
                            </Box>
                        </InputAdornment>
                    ),
                },
                htmlInput: { inputMode: "decimal", step, min, max, "aria-label": ariaLabel },
            }}
            sx={{
                "& .MuiInputBase-input": { fontFamily: MONO_FONT_STACK, px: 0.5 },
                "& .MuiInputBase-root": { pl: 0.75, pr: 0.5 },
            }}
        />
    );
}
