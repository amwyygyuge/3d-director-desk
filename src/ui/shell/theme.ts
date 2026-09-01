import { createTheme } from "@mui/material/styles";

/**
 * 悬浮壳层材质规格(方案 D 视觉语言的单一真相源)。
 * 药丸与面板只差圆角,颜色与描边共用一套,避免两处表面各自漂移。
 *
 * **不用 backdrop-filter(性能决策,不是审美取舍)。**
 * 壳层压在活动的 WebGL 画布上,毛玻璃要求合成器在画布每一帧重绘后
 * 重新读回并模糊背景;播放/飞行期画布是 60fps 重绘,四块壳层就是每秒
 * 240 次全尺寸模糊。改用不透明底色后这项开销归零,画布重绘不再牵动壳层合成。
 * 阴影也压到贴边的小半径——大半径 box-shadow 同样按层重绘计价。
 */
/** 面板圆角对外可见:通栏停靠壳层(时间线控制台)只保留上侧两角时需要引用同一半径 */
export const SURFACE_PANEL_RADIUS_PX = 14;
const SURFACE = {
    pill: { background: "#1e1f22", radius: 9999 },
    panel: { background: "#161719", radius: SURFACE_PANEL_RADIUS_PX },
    shadow: "0 2px 8px rgba(0,0,0,.55)",
} as const;
/** 描边宽度对外可见:壳层做像素级对齐(如左栏图标列宽)时必须把它算进去 */
export const SURFACE_BORDER_PX = 1;
const SURFACE_BORDER = `${SURFACE_BORDER_PX}px solid rgba(255,255,255,0.10)`;
/** 壳层与画布互不影响布局/绘制,声明出来把脏区限制在面板自身 */
const SURFACE_CONTAIN = "layout paint";

/** 视口底色:Canvas 清屏色与 MUI 背景同源,避免壳层与画布之间出现色差缝 */
export const VIEWPORT_BACKGROUND = "#1a1a1c";

/** 随时间/拖拽变化的数字一律等宽,防止位数跳动导致布局抖 */
export const MONO_FONT_STACK = '"SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

/**
 * 悬浮壳层的安全区边距与关键尺寸(壳层组件共用,禁各自硬编码)。
 * 不提供过渡时长 token:壳层的展开/收起改的是 width/height/padding,
 * 这些属性无法交给合成器,过渡期每帧都要重排——画布同时在渲染时代价直接叠加。
 * 需要动画时只允许 opacity(见 TimelineConsole 展开区的淡入)。
 */
export const CHROME = {
    pillHeightPx: 48,
    edgeGapPx: 16,
    railCollapsedPx: 56,
    railExpandedPx: 240,
    flyoutWidthPx: 288,
    inspectorWidthPx: 288,
    timelineMiniPx: 56,
    timelineExpandedPx: 264,
    /** 提示条压在一切壳层之上:它可能在时间线展开或检查器打开时出现 */
    toastZIndex: 40,
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
        background: { default: VIEWPORT_BACKGROUND, paper: SURFACE.panel.background },
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
                        background: SURFACE.pill.background,
                        border: SURFACE_BORDER,
                        borderRadius: SURFACE.pill.radius,
                        boxShadow: SURFACE.shadow,
                        backgroundImage: "none",
                        contain: SURFACE_CONTAIN,
                    },
                },
                {
                    props: { variant: "panel" },
                    style: {
                        background: SURFACE.panel.background,
                        border: SURFACE_BORDER,
                        borderRadius: SURFACE.panel.radius,
                        boxShadow: SURFACE.shadow,
                        backgroundImage: "none",
                        contain: SURFACE_CONTAIN,
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
