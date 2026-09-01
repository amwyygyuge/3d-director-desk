import { createTheme } from "@mui/material/styles";

/**
 * 液态玻璃材质规格(方案 D 视觉语言的单一真相源)。
 * 药丸与面板只差半径/模糊量级,颜色与描边共用一套,避免两处玻璃各自漂移。
 */
const GLASS = {
    pill: { background: "rgba(30, 31, 34, 0.55)", blur: "blur(20px)", radius: 9999, shadow: "0 8px 30px rgba(0,0,0,.45)" },
    panel: { background: "rgba(22, 23, 26, 0.72)", blur: "blur(28px)", radius: 16, shadow: "0 10px 50px rgba(0,0,0,.5)" },
} as const;
const GLASS_BORDER = "1px solid rgba(255,255,255,0.09)";

/** 视口底色:Canvas 清屏色与 MUI 背景同源,避免壳层与画布之间出现色差缝 */
export const VIEWPORT_BACKGROUND = "#1a1a1c";

/** 随时间/拖拽变化的数字一律等宽,防止位数跳动导致布局抖 */
export const MONO_FONT_STACK = '"SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

/** 悬浮壳层的安全区边距与关键尺寸(壳层组件共用,禁各自硬编码) */
export const CHROME = {
    edgeGapPx: 16,
    railCollapsedPx: 56,
    railExpandedPx: 240,
    flyoutWidthPx: 288,
    inspectorWidthPx: 288,
    timelineMiniPx: 56,
    timelineExpandedPx: 264,
    transition: "300ms cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

declare module "@mui/material/Paper" {
    interface PaperPropsVariantOverrides {
        pill: true;
        panel: true;
    }
}

/**
 * 导演台默认主题:暗色专业工具向 + 方案 D 的亚克力毛玻璃。
 * 不对外暴露换装契约——Monet 视觉一致性非目标(已决策);
 * 宿主如需调整,经 DirectorDesk 的 theme prop 传入 MUI theme 覆盖。
 */
export const directorDeskTheme = createTheme({
    palette: {
        mode: "dark",
        // Indigo 是运镜/关键帧等空间信息的品牌色;Blue 留给动作片段;Red 只给播放中轴
        primary: { main: "#6366f1" },
        secondary: { main: "#3b82f6" },
        error: { main: "#ef4444" },
        background: { default: VIEWPORT_BACKGROUND, paper: "rgba(22, 23, 26, 0.72)" },
        divider: "rgba(255,255,255,0.09)",
    },
    shape: { borderRadius: 10 },
    typography: {
        fontSize: 13,
        // 属性板小标题:10px 全大写宽字距极灰,贴近专业创作软件的信息密度
        overline: { fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", lineHeight: 1.6, color: "#71717a" },
    },
    components: {
        MuiButton: { defaultProps: { size: "small", disableElevation: true } },
        MuiSlider: { defaultProps: { size: "small" } },
        MuiTooltip: { defaultProps: { enterDelay: 400 } },
        MuiPaper: {
            variants: [
                {
                    props: { variant: "pill" },
                    style: {
                        background: GLASS.pill.background,
                        backdropFilter: GLASS.pill.blur,
                        WebkitBackdropFilter: GLASS.pill.blur,
                        border: GLASS_BORDER,
                        borderRadius: GLASS.pill.radius,
                        boxShadow: GLASS.pill.shadow,
                        backgroundImage: "none",
                    },
                },
                {
                    props: { variant: "panel" },
                    style: {
                        background: GLASS.panel.background,
                        backdropFilter: GLASS.panel.blur,
                        WebkitBackdropFilter: GLASS.panel.blur,
                        border: GLASS_BORDER,
                        borderRadius: GLASS.panel.radius,
                        boxShadow: GLASS.panel.shadow,
                        backgroundImage: "none",
                    },
                },
            ],
        },
        MuiIconButton: {
            styleOverrides: {
                root: { color: "#a1a1aa", "&:hover": { background: "rgba(255,255,255,0.10)", color: "#fff" } },
            },
        },
        MuiListItemButton: {
            styleOverrides: { root: { borderRadius: 10 } },
        },
    },
});
