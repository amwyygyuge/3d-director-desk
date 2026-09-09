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
    /** 左右侧栏同宽:几何镜像,禁单侧硬编码 */
    sidePanelWidthPx: 288,
    /** review 左栏只留 tab 图标,宽度与常规点击靶同源。 */
    navigatorIconRailWidthPx: 48,
    /** review 右下浮条只容纳预览、缓动和删除三条高频入口。 */
    reviewInspectorWidthPx: 248,
    reviewInspectorHeightPx: 48,
    /** 侧栏上缘:给顶部药丸让位 */
    sidePanelTopPx: 80,
    timelineMiniPx: 56,
    timelineExpandedPx: 264,
    /** 提示条压在一切壳层之上:它可能在时间线展开或检查器打开时出现 */
    toastZIndex: 40,
} as const;

/**
 * 时间线可调高度的合法域:下限保证「刻度尺 + 两条轨」仍可读,上限给画面留出足够视野。
 * 作者拖拽与未来的宿主/AI 写入共用这一道围栏。
 */
export const TIMELINE_HEIGHT = { MIN_PX: 160, MAX_PX: 640, DEFAULT_PX: CHROME.timelineExpandedPx } as const;

export function isTimelineHeightValid(value: number): boolean {
    return Number.isFinite(value) && value >= TIMELINE_HEIGHT.MIN_PX && value <= TIMELINE_HEIGHT.MAX_PX;
}

/**
 * 时间线当前高度的 CSS 变量:拖拽期直接写在导演台根节点上,壳层各处读同一个值。
 *
 * 用变量而不是 React 状态,是因为拖拽每帧都会改高度——若走 store,整条时间轴(轨道、片段、
 * 关键帧)每帧重渲一次,与画布渲染叠加。变量只触发合成器读值,拖完才落一次 store。
 */
export const TIMELINE_HEIGHT_VAR = "--desk-timeline-height";

/** 侧栏下缘让位量:骑在时间线控制台上方,随其高度联动;左右侧栏与产物停靠层共用同一表达式 */
export function sidePanelBottomOffset(): string {
    return `calc(var(${TIMELINE_HEIGHT_VAR}, ${CHROME.timelineMiniPx}px) + ${CHROME.edgeGapPx}px)`;
}

/** review 右下浮条骑在迷你时间线之上,沿用全局边距而非组件内拼裸数。 */
export function reviewInspectorBottomOffsetPx(): number {
    return CHROME.timelineMiniPx + CHROME.edgeGapPx;
}

/** 右下产物停靠层右缘让位量:检查器(右侧栏)在场时让开整栏宽度,与侧栏几何共用同一真相源 */
export function captureDockRightOffsetPx(inspectorVisible: boolean): number {
    return CHROME.edgeGapPx + (inspectorVisible ? CHROME.sidePanelWidthPx + CHROME.edgeGapPx : 0);
}

const SCROLLBAR_SIZE_PX = 8;
const SCROLLBAR_THUMB_COLOR = "rgba(255,255,255,0.24)";
const SCROLLBAR_THUMB_HOVER_COLOR = "rgba(255,255,255,0.38)";

/**
 * 滚动条材质:Mac 叠加式细轨与 Windows 占位式粗轨在两平台渲染一致的暗色细滚动条。
 * WebKit 伪元素覆盖 Windows/Chrome 经典滚动条;scrollbar-width/color 覆盖 Firefox。
 * 经 ScopedCssBaseline 的 sx 作用域注入,选择器限定在导演台根节点内,不外泄宿主页面。
 */
export const SCROLLBAR_SX = {
    "& *": {
        scrollbarColor: `${SCROLLBAR_THUMB_COLOR} transparent`,
        scrollbarWidth: "thin",
    },
    "& *::-webkit-scrollbar": { height: SCROLLBAR_SIZE_PX, width: SCROLLBAR_SIZE_PX },
    "& *::-webkit-scrollbar-corner, & *::-webkit-scrollbar-track": { background: "transparent" },
    "& *::-webkit-scrollbar-thumb": {
        background: SCROLLBAR_THUMB_COLOR,
        // 必须 px 字符串:sx 对数值 borderRadius 按 theme.shape.borderRadius 倍率换算
        borderRadius: `${SCROLLBAR_SIZE_PX / 2}px`,
    },
    "& *::-webkit-scrollbar-thumb:hover": { background: SCROLLBAR_THUMB_HOVER_COLOR },
} as const;

/** 可选中/可编辑区的白名单:整体禁选后靠它还原。标记属性对外可见,业务组件按需贴。 */
export const SELECTABLE_ATTRIBUTE = "data-desk-selectable";
/** 需要浏览器原生右键菜单的区域(如宿主嵌入的富文本):标了它 NativeChromeGuard 放行 */
export const NATIVE_MENU_ATTRIBUTE = "data-desk-native-menu";

/**
 * 「去 web 味」的壳层材质:桌面工具的默认态是不可选、不可拖、不橡皮筋。
 *
 * 为什么默认全禁而非逐个禁:导演台的绝大多数表面是操作面(轨道、药丸、图标、读数),
 * 拖拽期选出一片蓝色高亮是纯粹的干扰;正文性文本是少数,交给白名单还原成本更低,
 * 也不会随新面板增加而漏掉。可选区一律贴 SELECTABLE_ATTRIBUTE,别在组件里写裸 userSelect。
 *
 * 按钮光标保留 pointer(已决策):手型是可点性最直白的提示,牺牲它换来的工具味不值得。
 * 经 ScopedCssBaseline 的 sx 注入,选择器限定在导演台根节点内,不外泄宿主页面。
 */
export const TOOL_CHROME_SX = {
    userSelect: "none",
    WebkitUserSelect: "none",
    // 长按不弹 iOS/macOS 的原生气泡菜单
    WebkitTouchCallout: "none",
    // 面板滚到底不再把滚动链传给宿主页面(橡皮筋/连带滚动)
    overscrollBehavior: "none",
    // 缩略图/画像按住会拖出半透明图片幽灵,原生拖拽在导演台没有任何用途
    "& img, & svg, & canvas": { WebkitUserDrag: "none", userDrag: "none" },
    [`& input, & textarea, & [contenteditable='true'], & [${SELECTABLE_ATTRIBUTE}]`]: {
        userSelect: "text",
        WebkitUserSelect: "text",
    },
    // 白名单里仍可选的文本用品牌色高亮,不落回系统蓝
    "& ::selection": { background: "rgba(99,102,241,0.40)" },
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
        // 工程里的名字大量是中文与专业术语,浏览器拼写检查一律画红波浪线——最露馅的一条 web 味。
        // autoCorrect/autoCapitalize 不放这里:defaultProps 的 inputProps 会被组件自带的
        // inputProps 整体覆盖(时间码与时长输入都传),改为在导演台根节点上声明由 DOM 继承。
        MuiInputBase: { defaultProps: { spellCheck: false, autoComplete: "off" } },
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
        MuiTabs: {
            styleOverrides: {
                // indicator 默认对 left/width 做过渡:无法合成器化,过渡期间每帧重排与画布渲染叠加;瞬时到位
                indicator: { transition: "none" },
            },
        },
        MuiTab: {
            styleOverrides: {
                // 288px 侧栏放 4 个 tab:默认 90px min-width 会把末位挤出面板;
                // 默认横向 16px padding 把图标+文字挤成竖排,收窄后一行放下;
                // 图标+文字并存时 v9 把 min-height 抬到 72px,压回标准 48 与顶部药丸同高
                root: { minWidth: 0, minHeight: 48, padding: "6px 4px", whiteSpace: "nowrap" },
            },
        },
    },
});
