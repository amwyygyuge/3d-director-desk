import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";

import type { ColorSwatch } from "@/core/ColorSwatch";
import { HsvColor } from "@/ui/controls/HsvColor";
import { MONO_FONT_STACK } from "@/ui/shell/theme";

const TRIGGER_HEIGHT_PX = 26;
const TRIGGER_MIN_WIDTH_PX = 44;
const TRIGGER_RADIUS = 1;
const TRIGGER_BORDER = "1px solid rgba(255,255,255,0.24)";
const PANEL_WIDTH_PX = 200;
const PANEL_GAP = 1;
const PANEL_PADDING = 1.25;
const PLANE_HEIGHT_PX = 132;
const HUE_HEIGHT_PX = 12;
const HANDLE_SIZE_PX = 12;
const HANDLE_OFFSET_PX = `${-HANDLE_SIZE_PX / 2}px`;
const HANDLE_BORDER = "2px solid #fff";
/** 画布之上禁大半径阴影(红线 14):手柄只用描边级投影,保证在浅色区仍可见 */
const HANDLE_SHADOW = "0 0 0 1px rgba(0,0,0,0.55)";
const HUE_GRADIENT = "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)";
/** 饱和度/明度平面 = 当前色相底色 + 向右去白 + 向下压黑,两道渐变叠出整块色域 */
const PLANE_GRADIENT =
    "linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0))";
const HUE_TURN = 360;
const PERCENT = 100;
/** 方向键步长:平面按 1%、色相按 2°,Shift 十倍(与 ScrubNumberField 的修饰键语义同向) */
const PLANE_KEY_STEP = 0.01;
const HUE_KEY_STEP = 2;
const COARSE_RATIO = 10;
const HEX_INPUT_WIDTH = "9ch";
const SWATCH_GRID_COLUMNS = "repeat(5, minmax(0, 1fr))";
const SWATCH_HEIGHT_PX = 20;
const SWATCH_GAP = 0.5;
const SWATCH_SELECTED_BORDER = "2px solid #fff";
const SWATCH_IDLE_BORDER = "2px solid rgba(255,255,255,0.14)";

export interface ColorFieldProps {
    /** 已提交色(`#rrggbb`);面板关闭期间显示值始终跟随它 */
    readonly value: string;
    readonly ariaLabel: string;
    readonly disabled?: boolean;
    /**
     * 拖拽期实时预览:调用方直写运行时(材质 uniform 等)+ requestRender,不落命令。
     * 省略则拖拽期画面不动,提交时才见效——写口只有命令层的状态(灯光、地板)必须省略它。
     */
    readonly onPreview?: (hex: string) => void;
    /**
     * 该场景的内置色(语义色块)。表由领域侧提供——人偶外观、灯光色温、地板影调各一张,
     * 标签同时是 AI 可说的词。点一枚 = 一次完整调节:即刻提交并把面板对到该色。
     */
    readonly swatches?: readonly ColorSwatch[];
    /** 提交口:一次连续调节只调用一次(松手、Esc/点面板外关闭、hex 回车、方向键每步、点色块) */
    readonly onCommit: (hex: string) => void;
}

interface PointerSurface {
    readonly rect: DOMRect;
    readonly clientX: number;
    readonly clientY: number;
}

/** 指针 → 归一化坐标:y 轴翻转成「上=明度高」,越界截断在边界(拖出面板不跳值) */
function ratiosOf({ rect, clientX, clientY }: PointerSurface): { readonly x: number; readonly y: number } {
    const x = rect.width === 0 ? 0 : (clientX - rect.left) / rect.width;
    const y = rect.height === 0 ? 0 : 1 - (clientY - rect.top) / rect.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

function surfaceOf(event: PointerEvent<HTMLElement>): PointerSurface {
    return { rect: event.currentTarget.getBoundingClientRect(), clientX: event.clientX, clientY: event.clientY };
}

/**
 * 应用内取色面板(无领域身份的叶子控件,按 props 边界纪律的白名单收值型 props)。
 *
 * **为什么不用 `<input type="color">`**:原生控件弹的是操作系统色板窗口,它的 Esc 由系统消费,
 * 页面收不到 keydown——「Esc 应用当前颜色并关闭」在原生入口上无法实现。自绘面板把这条交互收回
 * 页面内:Esc 与点击面板外走同一条 `onClose`(先提交当前色再关闭),面板里不存在丢弃当前色的出口。
 *
 * 提交纪律:一次连续拖拽在撤销栈里是**一条**记录(与滑杆/gizmo 同模式)——拖拽期只走本地 HSV
 * 草稿与可选的 `onPreview`,松手与关闭时才 `onCommit`,且同一颜色不重复提交(命令被拒时也不会
 * 因关闭再补一条重复失败)。
 *
 * 会话期以 `HsvColor` 为真相源而非每帧往 hex 折返:hex 在纯灰/纯黑处丢色相,折返会让色相条跳回红端。
 */
export function ColorField({ value, ariaLabel, disabled = false, swatches, onPreview, onCommit }: ColorFieldProps) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [session, setSession] = useState<HsvColor | null>(null);
    const [hexDraft, setHexDraft] = useState<string | null>(null);
    const draggingRef = useRef(false);
    /** 本会话最后一次提交过的色:与 `value` 一起当去重基准,命令被拒时 `value` 不动也不会重复发 */
    const committedRef = useRef<string | null>(null);

    const current = session ?? HsvColor.fromHex(value);
    const displayHex = session ? current.hex : value;

    const previewTo = (next: HsvColor) => {
        setSession(next);
        setHexDraft(null);
        onPreview?.(next.hex);
    };

    const commit = (hex: string) => {
        if (hex === value.toLowerCase() || hex === committedRef.current) return;
        committedRef.current = hex;
        onCommit(hex);
    };

    /** 方向键是离散步进,没有「松手」时机:每步既预览也提交(相邻步同色则被 commit 去重吃掉) */
    const stepTo = (next: HsvColor) => {
        previewTo(next);
        commit(next.hex);
    };

    const openPanel = (event: MouseEvent<HTMLElement>) => {
        committedRef.current = null;
        setSession(HsvColor.fromHex(value));
        setAnchor(event.currentTarget);
    };

    const closePanel = () => {
        if (session) commit(session.hex);
        draggingRef.current = false;
        setSession(null);
        setHexDraft(null);
        setAnchor(null);
    };

    const beginDrag = (event: PointerEvent<HTMLElement>, colorAt: (surface: PointerSurface) => HsvColor) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
        draggingRef.current = true;
        previewTo(colorAt(surfaceOf(event)));
    };

    const moveDrag = (event: PointerEvent<HTMLElement>, colorAt: (surface: PointerSurface) => HsvColor) => {
        if (!draggingRef.current) return;
        previewTo(colorAt(surfaceOf(event)));
    };

    const endDrag = () => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        if (session) commit(session.hex);
    };

    const planeColorAt = (surface: PointerSurface) => {
        const { x, y } = ratiosOf(surface);
        return current.withSaturationValue(x, y);
    };
    const hueColorAt = (surface: PointerSurface) => current.withHue(ratiosOf(surface).x * HUE_TURN);

    const handlePlaneKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        const step = PLANE_KEY_STEP * (event.shiftKey ? COARSE_RATIO : 1);
        const deltaSaturation = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
        const deltaValue = event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0;
        if (deltaSaturation === 0 && deltaValue === 0) return;
        event.preventDefault();
        stepTo(current.withSaturationValue(current.saturation + deltaSaturation, current.value + deltaValue));
    };

    const handleHueKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        const step = HUE_KEY_STEP * (event.shiftKey ? COARSE_RATIO : 1);
        const delta = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
        if (delta === 0) return;
        event.preventDefault();
        stepTo(current.withHue(current.hue + delta));
    };

    /** hex 输入是显式提交动作:非法草稿静默回退到当前色(与 ScrubNumberField 的越界回退同口径) */
    const commitHexDraft = () => {
        if (hexDraft === null) return;
        const candidate = hexDraft.startsWith("#") ? hexDraft : `#${hexDraft}`;
        setHexDraft(null);
        if (!HsvColor.isHex(candidate)) return;
        stepTo(HsvColor.fromHex(candidate));
    };

    return (
        <>
            <ButtonBase
                aria-label={ariaLabel}
                aria-haspopup="dialog"
                disabled={disabled}
                onClick={openPanel}
                sx={{
                    bgcolor: displayHex,
                    border: TRIGGER_BORDER,
                    borderRadius: TRIGGER_RADIUS,
                    height: TRIGGER_HEIGHT_PX,
                    minWidth: TRIGGER_MIN_WIDTH_PX,
                    opacity: disabled ? 0.4 : 1,
                }}
            />
            {/* Esc 与点击面板外都经 onClose:提交当前色再关闭(MUI 的 Modal 已吞掉这枚 Esc,不会外泄给全局快捷键) */}
            <Popover
                open={anchor !== null}
                anchorEl={anchor}
                onClose={closePanel}
                anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                slotProps={{ paper: { variant: "panel", sx: { p: PANEL_PADDING, width: PANEL_WIDTH_PX } } }}
            >
                <Stack spacing={PANEL_GAP}>
                    <Box
                        role="slider"
                        tabIndex={0}
                        aria-label={`${ariaLabel} 饱和度与明度`}
                        aria-valuetext={`饱和度 ${Math.round(current.saturation * PERCENT)}%,明度 ${Math.round(
                            current.value * PERCENT,
                        )}%`}
                        onPointerDown={(event) => beginDrag(event, planeColorAt)}
                        onPointerMove={(event) => moveDrag(event, planeColorAt)}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onKeyDown={handlePlaneKeyDown}
                        sx={{
                            position: "relative",
                            height: PLANE_HEIGHT_PX,
                            borderRadius: TRIGGER_RADIUS,
                            cursor: "crosshair",
                            touchAction: "none",
                            bgcolor: current.hueHex,
                            backgroundImage: PLANE_GRADIENT,
                        }}
                    >
                        <Box
                            sx={{
                                position: "absolute",
                                left: `${current.saturation * PERCENT}%`,
                                top: `${(1 - current.value) * PERCENT}%`,
                                width: HANDLE_SIZE_PX,
                                height: HANDLE_SIZE_PX,
                                ml: HANDLE_OFFSET_PX,
                                mt: HANDLE_OFFSET_PX,
                                borderRadius: "50%",
                                border: HANDLE_BORDER,
                                boxShadow: HANDLE_SHADOW,
                                pointerEvents: "none",
                            }}
                        />
                    </Box>
                    <Box
                        role="slider"
                        tabIndex={0}
                        aria-label={`${ariaLabel} 色相`}
                        aria-valuemin={0}
                        aria-valuemax={HUE_TURN}
                        aria-valuenow={Math.round(current.hue)}
                        onPointerDown={(event) => beginDrag(event, hueColorAt)}
                        onPointerMove={(event) => moveDrag(event, hueColorAt)}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onKeyDown={handleHueKeyDown}
                        sx={{
                            position: "relative",
                            height: HUE_HEIGHT_PX,
                            borderRadius: TRIGGER_RADIUS,
                            cursor: "ew-resize",
                            touchAction: "none",
                            backgroundImage: HUE_GRADIENT,
                        }}
                    >
                        <Box
                            sx={{
                                position: "absolute",
                                left: `${(current.hue / HUE_TURN) * PERCENT}%`,
                                top: "50%",
                                width: HANDLE_SIZE_PX,
                                height: HANDLE_SIZE_PX,
                                ml: HANDLE_OFFSET_PX,
                                mt: HANDLE_OFFSET_PX,
                                borderRadius: "50%",
                                border: HANDLE_BORDER,
                                boxShadow: HANDLE_SHADOW,
                                pointerEvents: "none",
                            }}
                        />
                    </Box>
                    <TextField
                        size="small"
                        value={hexDraft ?? displayHex}
                        onChange={(event) => setHexDraft(event.target.value)}
                        onBlur={commitHexDraft}
                        onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            commitHexDraft();
                        }}
                        slotProps={{ htmlInput: { "aria-label": `${ariaLabel} 十六进制值` } }}
                        sx={{
                            width: HEX_INPUT_WIDTH,
                            "& .MuiInputBase-input": { fontFamily: MONO_FONT_STACK, px: 0.75 },
                        }}
                    />
                    {/* 内置色在最后一栏:一击到底的快路径,与上方连续调节互不干扰(点一枚即提交并把面板对到该色) */}
                    {swatches && swatches.length > 0 && (
                        <Box sx={{ display: "grid", gap: SWATCH_GAP, gridTemplateColumns: SWATCH_GRID_COLUMNS }}>
                            {swatches.map((swatch) => (
                                <Tooltip key={swatch.id} title={swatch.labelZh}>
                                    <ButtonBase
                                        aria-label={`${ariaLabel} ${swatch.labelZh}`}
                                        onClick={() => stepTo(HsvColor.fromHex(swatch.hex))}
                                        sx={{
                                            bgcolor: swatch.hex,
                                            border: current.equalsHex(swatch.hex)
                                                ? SWATCH_SELECTED_BORDER
                                                : SWATCH_IDLE_BORDER,
                                            borderRadius: TRIGGER_RADIUS,
                                            height: SWATCH_HEIGHT_PX,
                                        }}
                                    />
                                </Tooltip>
                            ))}
                        </Box>
                    )}
                </Stack>
            </Popover>
        </>
    );
}
